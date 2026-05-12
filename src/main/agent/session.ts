import { join } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { Agent } from "@mariozechner/pi-agent-core";
import type { EventBus } from "../event-bus";
import { addPendingPathApproval } from "../ipc/command-handlers";
import type { AllowlistService } from "../services/AllowlistService";
import type { HomeService } from "../services/HomeService";
import type { MemoryFileService } from "../services/MemoryFileService";
import type { IMemoryManager, MemoryContext } from "../services/MemoryManager";
import type { MessageService } from "../services/MessageService";
import type { ResearchService } from "../services/ResearchService";
import { FIRST_RUN_SKILL } from "./builtin-skills";
import { CompressionService } from "./CompressionService";
import { buildSystemContext } from "./context";
import { createModel } from "./model-factory";
import type { ModelProvider } from "./model-provider";
import { createDefaultSkillRouter } from "./SkillRouter";
import { createAgentTools } from "./tools";
import { makeEvaluatorFn } from "./worker-agent";

const BASE_SYSTEM_PROMPT = `You are a helpful research assistant.

Your primary job is to delegate non-trivial tasks to background research workers. If a user asks something that would benefit from reading files, running commands, fetching web pages, or investigating multiple sources, call start_research instead of answering from your own knowledge.

When in doubt, research it. Do not guess. It is better to start a quick research task than to give an incomplete or wrong answer.

When the user explicitly asks you to create or write a skill, write it directly to ~/.scholar/skills/<name>/SKILL.md so it is available immediately. If you discover a reusable pattern during research that the user did not explicitly request, use the propose_skill tool to suggest it for their approval instead.`;

const RESERVED_TOKENS = 6000;
const CHARS_PER_TOKEN = 4;

function createTransformContext(modelId: string) {
  const contextWindow = getContextWindow(modelId);
  return async (messages: AgentMessage[]) => {
    const availableTokens = contextWindow - RESERVED_TOKENS;
    let estimatedTokens = 0;
    const pruned: AgentMessage[] = [];
    // Walk backwards, keep messages that fit
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const text = extractMessageText(msg);
      const msgTokens = Math.ceil(text.length / CHARS_PER_TOKEN);
      if (estimatedTokens + msgTokens > availableTokens) {
        if (msg.role === "user" && pruned.length === 0) pruned.unshift(msg);
        break;
      }
      estimatedTokens += msgTokens;
      pruned.unshift(msg);
    }
    return pruned;
  };
}

function getContextWindow(modelId: string): number {
  if (modelId.includes("claude-3-opus")) return 200_000;
  if (modelId.includes("claude-3-5-sonnet") || modelId.includes("claude-sonnet-4")) return 200_000;
  if (modelId.includes("claude-3-haiku") || modelId.includes("claude-haiku-4")) return 200_000;
  if (modelId.includes("gpt-4o")) return 128_000;
  if (modelId.includes("gpt-4-turbo")) return 128_000;
  if (modelId.includes("gpt-4")) return 8_192;
  if (modelId.includes("gpt-3.5")) return 16_384;
  return 128_000;
}

function extractMessageText(msg: { content: unknown }): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return (msg.content as Array<{ text?: string }>).map((c) => c?.text ?? "").join("");
  }
  return "";
}

export interface AgentSessionOptions {
  messageService: MessageService;
  homeService: HomeService;
  researchService: ResearchService;
  memoryManager: IMemoryManager;
  eventBus: EventBus;
  initialMemoryContext: MemoryContext;
  projectId: string;
  projectName: string;
  folderPath: string | null;
  provider: ModelProvider;
  isFirstRun: boolean;
  systemContext?: string;
  webAccessEnabled?: boolean;
  onFileWrite?: (absolutePath: string, relativePath: string, fileName: string) => void;
  memoryFileService?: MemoryFileService;
  allowlistService: AllowlistService;
  proposeSkillFn?: (name: string, skillContent: string, script?: string) => Promise<void>;
}

export class AgentSession {
  private readonly agent: Agent;
  private readonly eventBus: EventBus;
  private readonly messageService: MessageService;
  private readonly memoryManager: IMemoryManager;
  private readonly projectId: string;
  private readonly projectName: string;
  private assistantContent = "";
  private currentTurnId = 0;
  private savedForTurn = 0;
  private lastUserContent = "";
  private processing = false;
  private pendingFollowUp: string | null = null;
  private pendingSkillDeltas: Array<{ skillName: string; summary: string }> = [];
  private readonly skillRouter: ReturnType<typeof createDefaultSkillRouter>;
  private skillRouterReady = false;

  constructor({
    messageService,
    homeService,
    researchService,
    memoryManager,
    eventBus,
    initialMemoryContext,
    projectId,
    projectName,
    folderPath,
    provider,
    isFirstRun,
    systemContext = "",
    webAccessEnabled,
    onFileWrite,
    memoryFileService,
    allowlistService,
    proposeSkillFn,
  }: AgentSessionOptions) {
    this.eventBus = eventBus;
    this.messageService = messageService;
    this.memoryManager = memoryManager;
    this.projectId = projectId;
    this.projectName = projectName;

    this.skillRouter = createDefaultSkillRouter(projectName, (skillName, summary) => {
      this.pendingSkillDeltas.push({ skillName, summary });
    });

    const homePath = homeService.getHomePath();

    const systemPrompt = [
      isFirstRun ? FIRST_RUN_SKILL : BASE_SYSTEM_PROMPT,
      initialMemoryContext.summary,
      systemContext,
    ]
      .filter(Boolean)
      .join("\n\n");

    const initialMessages = initialMemoryContext.recentMessages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: Date.now(),
    })) as AgentMessage[];

    const compressionService = new CompressionService(
      join(homePath, "workspace", projectId, ".compressed"),
    );

    const tools = createAgentTools({
      projectId,
      projectName,
      folderPath,
      homePath,
      apiKey: provider.type === "ollama" ? "ollama" : provider.apiKey,
      model: provider.model,
      webAccessEnabled,
      onFileWrite,
      emitBlocked: (payload) => eventBus.emit({ type: "bash:blocked", payload }),
      emitApprovalRequired: (payload) => {
        addPendingPathApproval(payload);
        eventBus.emit({ type: "path:approval_required", payload });
      },
      startResearchFn: (query, deep) =>
        deep === true
          ? researchService.startOrchestratedResearch(projectId, projectName, query, folderPath)
          : researchService.startResearch(projectId, projectName, query, folderPath),
      requestEvaluationFn: makeEvaluatorFn({
        projectId,
        projectName,
        folderPath,
        homePath,
        provider,
        webAccessEnabled,
        allowlistService,
      }),
      saveMemoryFn: memoryFileService
        ? (category, title, content, scope) =>
            memoryFileService.saveMemory(
              projectId,
              category,
              title,
              content,
              scope,
              folderPath ?? undefined,
            )
        : undefined,
      readMemoryFn: memoryFileService
        ? (options) =>
            memoryFileService.readMemory({ ...options, projectFolderPath: folderPath ?? undefined })
        : undefined,
      compressionService,
      allowlistService,
      proposeSkillFn,
    });

    this.agent = new Agent({
      initialState: {
        systemPrompt,
        model: createModel({ provider }),
        tools,
        messages: initialMessages,
      },
      transformContext: createTransformContext(provider.model),
      getApiKey: async () => (provider.type === "ollama" ? "ollama" : provider.apiKey),
      beforeToolCall: async (ctx) => {
        const allowed = new Set(tools.map((t) => t.name));
        if (!allowed.has(ctx.toolCall.name)) {
          return { block: true, reason: `Tool "${ctx.toolCall.name}" is not registered.` };
        }
        return undefined;
      },
    });

    this.agent.subscribe(async (event) => {
      try {
        const e = event as {
          type: string;
          assistantMessageEvent?: { type: string; delta: string };
          messages?: unknown[];
        };

        if (e.type === "message_update") {
          const ae = e.assistantMessageEvent;
          if (ae?.type === "text_delta") {
            this.assistantContent += ae.delta;
            this.eventBus.emit({
              type: "agent:chunk",
              payload: { projectId: this.projectId, delta: ae.delta },
            });
          }
        } else if (e.type === "agent_end") {
          const content = this.assistantContent;
          const userContent = this.lastUserContent;
          this.assistantContent = "";
          this.lastUserContent = "";
          if (content && userContent && this.savedForTurn !== this.currentTurnId) {
            this.savedForTurn = this.currentTurnId;
            try {
              await this.messageService.addMessage({
                projectId: this.projectId,
                role: "assistant",
                content,
              });
              await this.memoryManager.save(this.projectId, [
                { role: "user", content: userContent },
                { role: "assistant", content },
              ]);
            } catch (err) {
              console.error("[AgentSession] save failed:", err);
            }
          }
          this.eventBus.emit({ type: "agent:done", payload: { projectId: this.projectId } });
        }
      } catch (err) {
        console.error("[AgentSession] subscriber error:", err);
      }
    });
  }

  async send(content: string): Promise<void> {
    if (this.processing) {
      throw new Error("Agent is already processing a message. Please wait for the response.");
    }
    this.processing = true;
    this.currentTurnId++;
    this.savedForTurn = 0;
    try {
      // Refresh system context before each prompt so AGENTS.md updates are picked up
      try {
        if (!this.skillRouterReady) {
          await this.skillRouter.buildIndex();
          this.skillRouter.startWatching();
          this.skillRouterReady = true;
        }

        const memoryContext = await this.memoryManager.buildContext(this.projectId);
        const systemContext = await buildSystemContext(this.projectName, this.skillRouter.toXml());

        const newSystemPrompt = [BASE_SYSTEM_PROMPT, memoryContext.summary, systemContext]
          .filter(Boolean)
          .join("\n\n");

        if (newSystemPrompt !== this.agent.state.systemPrompt) {
          this.agent.state.systemPrompt = newSystemPrompt;
        }
      } catch (err) {
        console.error("[AgentSession] Failed to refresh system context:", err);
      }

      // Inject pending skill deltas as user-visible messages
      if (this.pendingSkillDeltas.length > 0) {
        for (const delta of this.pendingSkillDeltas) {
          await this.agent.prompt(`Skill "${delta.skillName}" was updated. ${delta.summary}`);
        }
        this.pendingSkillDeltas = [];
      }

      // Manual crystallization trigger detection
      const lowerContent = content.toLowerCase();
      if (lowerContent.includes("/crystallize") || lowerContent.includes("always do it this way")) {
        this.eventBus.emit({
          type: "agent:chunk",
          payload: {
            projectId: this.projectId,
            delta:
              "Skill crystallization happens automatically after successful research tasks when the approach is novel and reusable. No manual action needed.",
          },
        });
        this.eventBus.emit({ type: "agent:done", payload: { projectId: this.projectId } });
        this.lastUserContent = "";
        return;
      }

      this.lastUserContent = content;
      await this.messageService.addMessage({
        projectId: this.projectId,
        role: "user",
        content,
      });
      await this.agent.prompt(content);
    } finally {
      this.processing = false;
      const pending = this.pendingFollowUp;
      this.pendingFollowUp = null;
      if (pending !== null) {
        await this.queueFollowUp(pending);
      }
    }
  }

  async queueFollowUp(content: string): Promise<void> {
    if (this.processing) {
      this.pendingFollowUp = content;
      return;
    }
    try {
      this.processing = true;
      await this.agent.followUp({ role: "user", content, timestamp: Date.now() });
    } catch (err) {
      console.error("[AgentSession] followUp failed:", err);
      throw err;
    } finally {
      this.processing = false;
      const pending = this.pendingFollowUp;
      this.pendingFollowUp = null;
      if (pending !== null) {
        await this.queueFollowUp(pending);
      }
    }
  }

  abort(): void {
    this.agent.abort();
  }
}
