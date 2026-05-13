import { join } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import type { EventBus } from "../event-bus";
import { addPendingPathApproval } from "../ipc/command-handlers";
import type { AllowlistService } from "../services/AllowlistService";
import type { HomeService } from "../services/HomeService";
import type { MemoryFileService } from "../services/MemoryFileService";
import type { IMemoryManager, MemoryContext } from "../services/MemoryManager";
import type { MessageService } from "../services/MessageService";
import type { ObservabilityService } from "../services/ObservabilityService";
import type { ResearchService } from "../services/ResearchService";
import { FIRST_RUN_SKILL } from "./builtin-skills";
import { CompressionService } from "./CompressionService";
import { buildSystemContext } from "./context";
import type { SessionState } from "./handlers/types";
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

function createTransformContext(modelId: string) {
  const contextWindow = getContextWindow(modelId);
  return async (messages: import("@mariozechner/pi-agent-core").AgentMessage[]) => {
    const availableTokens = contextWindow - RESERVED_TOKENS;
    let estimatedTokens = 0;
    const pruned: import("@mariozechner/pi-agent-core").AgentMessage[] = [];
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

export interface MessagePipelineOptions {
  projectId: string;
  projectName: string;
  folderPath: string | null;
  provider: ModelProvider;
  messageService: MessageService;
  memoryManager: IMemoryManager;
  eventBus: EventBus;
  observabilityService?: ObservabilityService;
  homeService: HomeService;
  researchService: ResearchService;
  memoryFileService?: MemoryFileService;
  allowlistService: AllowlistService;
  proposeSkillFn?: (name: string, skillContent: string, script?: string) => Promise<void>;
  onFileWrite?: (absolutePath: string, relativePath: string, fileName: string) => void;
  initialMemoryContext: MemoryContext;
  isFirstRun: boolean;
  systemContext?: string;
  webAccessEnabled?: boolean;
}

export class MessagePipeline {
  readonly agent: Agent;
  private readonly projectId: string;
  private readonly projectName: string;
  private readonly provider: ModelProvider;
  private readonly messageService: MessageService;
  private readonly memoryManager: IMemoryManager;
  private readonly eventBus: EventBus;
  private readonly observabilityService?: ObservabilityService;
  private readonly skillRouter: ReturnType<typeof createDefaultSkillRouter>;

  constructor(
    options: MessagePipelineOptions,
    private readonly state: SessionState,
  ) {
    this.projectId = options.projectId;
    this.projectName = options.projectName;
    this.provider = options.provider;
    this.messageService = options.messageService;
    this.memoryManager = options.memoryManager;
    this.eventBus = options.eventBus;
    this.observabilityService = options.observabilityService;

    this.skillRouter = createDefaultSkillRouter(options.projectName, (skillName, summary) => {
      this.state.pendingSkillDeltas.push({ skillName, summary });
    });

    const homePath = options.homeService.getHomePath();

    const systemPrompt = [
      options.isFirstRun ? FIRST_RUN_SKILL : BASE_SYSTEM_PROMPT,
      options.initialMemoryContext.summary,
      options.systemContext ?? "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const initialMessages = options.initialMemoryContext.recentMessages.map((m) => ({
      role: m.role,
      content: m.role === "assistant" ? [{ type: "text" as const, text: m.content }] : m.content,
      timestamp: Date.now(),
    })) as import("@mariozechner/pi-agent-core").AgentMessage[];

    const compressionService = new CompressionService(
      join(homePath, "workspace", options.projectId, ".compressed"),
    );

    const tools = createAgentTools({
      projectId: options.projectId,
      projectName: options.projectName,
      folderPath: options.folderPath,
      homePath,
      apiKey: options.provider.type === "ollama" ? "ollama" : options.provider.apiKey,
      model: options.provider.model,
      webAccessEnabled: options.webAccessEnabled,
      onFileWrite: options.onFileWrite,
      emitBlocked: (payload) => options.eventBus.emit({ type: "bash:blocked", payload }),
      emitApprovalRequired: (payload) => {
        addPendingPathApproval(payload);
        options.eventBus.emit({ type: "path:approval_required", payload });
      },
      startResearchFn: (query, deep) =>
        deep === true
          ? options.researchService.startOrchestratedResearch(
              options.projectId,
              options.projectName,
              query,
              options.folderPath,
            )
          : options.researchService.startResearch(
              options.projectId,
              options.projectName,
              query,
              options.folderPath,
            ),
      requestEvaluationFn: makeEvaluatorFn({
        projectId: options.projectId,
        projectName: options.projectName,
        folderPath: options.folderPath,
        homePath,
        provider: options.provider,
        webAccessEnabled: options.webAccessEnabled,
        allowlistService: options.allowlistService,
      }),
      saveMemoryFn: options.memoryFileService
        ? (category, title, content, scope) => {
            const svc = options.memoryFileService;
            if (!svc) return Promise.resolve({ path: "" });
            return svc.saveMemory(
              options.projectId,
              category,
              title,
              content,
              scope,
              options.folderPath ?? undefined,
            );
          }
        : undefined,
      readMemoryFn: options.memoryFileService
        ? (readOptions) => {
            const svc = options.memoryFileService;
            if (!svc) return Promise.resolve("");
            return svc.readMemory({
              ...readOptions,
              projectFolderPath: options.folderPath ?? undefined,
            });
          }
        : undefined,
      compressionService,
      allowlistService: options.allowlistService,
      proposeSkillFn: options.proposeSkillFn,
    });

    this.agent = new Agent({
      initialState: {
        systemPrompt,
        model: createModel({ provider: options.provider }),
        tools,
        messages: initialMessages,
      },
      transformContext: createTransformContext(options.provider.model),
      getApiKey: async () =>
        options.provider.type === "ollama" ? "ollama" : options.provider.apiKey,
      beforeToolCall: async (ctx) => {
        const allowed = new Set(tools.map((t) => t.name));
        if (!allowed.has(ctx.toolCall.name)) {
          return { block: true, reason: `Tool "${ctx.toolCall.name}" is not registered.` };
        }
        return undefined;
      },
    });
  }

  async send(content: string): Promise<void> {
    if (this.state.processing) {
      throw new Error("Agent is already processing a message. Please wait for the response.");
    }
    this.state.processing = true;
    this.state.currentTurnId++;
    this.state.savedForTurn = 0;

    try {
      this.state.activeTurnSpan =
        (await this.observabilityService?.startObservation("agent-turn", {
          asType: "agent",
          input: { role: "user", content },
          sessionId: this.state.sessionId,
          metadata: {
            turnNumber: this.state.currentTurnId,
            projectId: this.projectId,
            systemPrompt: this.agent.state.systemPrompt,
          },
        })) ?? null;

      if (this.state.activeTurnSpan) {
        this.state.turnTraceId = this.state.activeTurnSpan.traceId;
        this.state.turnSpanId = this.state.activeTurnSpan.spanId;
      }

      try {
        if (!this.state.skillRouterReady) {
          await this.skillRouter.buildIndex();
          this.skillRouter.startWatching();
          this.state.skillRouterReady = true;
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

      if (this.state.pendingSkillDeltas.length > 0) {
        for (const delta of this.state.pendingSkillDeltas) {
          await this.agent.prompt(`Skill "${delta.skillName}" was updated. ${delta.summary}`);
        }
        this.state.pendingSkillDeltas = [];
      }

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
        this.state.lastUserContent = "";
        return;
      }

      this.state.lastUserContent = content;
      await this.messageService.addMessage({
        projectId: this.projectId,
        role: "user",
        content,
      });
      await this.agent.prompt(content);
    } catch (err) {
      this.state.activeTurnSpan?.update({ metadata: { error: String(err) } });
      throw err;
    } finally {
      this.state.processing = false;
      const pending = this.state.pendingFollowUp;
      this.state.pendingFollowUp = null;
      if (pending !== null) {
        await this.queueFollowUp(pending);
      }
    }
  }

  async queueFollowUp(content: string): Promise<void> {
    if (this.state.processing) {
      this.state.pendingFollowUp = content;
      return;
    }
    try {
      this.state.processing = true;
      this.state.currentTurnId++;
      this.state.savedForTurn = 0;

      void this.observabilityService
        ?.startObservation("agent-turn", {
          asType: "agent",
          input: { role: "user", content },
          sessionId: this.state.sessionId,
          metadata: {
            turnNumber: this.state.currentTurnId,
            projectId: this.projectId,
            followUp: true,
            systemPrompt: this.agent.state.systemPrompt,
          },
        })
        .then((span) => {
          this.state.activeTurnSpan = span ?? null;
          if (span) {
            this.state.turnTraceId = span.traceId;
            this.state.turnSpanId = span.spanId;
          }
        });

      await this.agent.followUp({ role: "user", content, timestamp: Date.now() });
    } catch (err) {
      console.error("[AgentSession] followUp failed:", err);
      throw err;
    } finally {
      this.state.processing = false;
      const pending = this.state.pendingFollowUp;
      this.state.pendingFollowUp = null;
      if (pending !== null) {
        await this.queueFollowUp(pending);
      }
    }
  }
}
