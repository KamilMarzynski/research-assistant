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
import { AgentTracer } from "./AgentTracer";
import { FIRST_RUN_SKILL } from "./builtin-skills";
import { CompressionService } from "./CompressionService";
import { buildSystemContext } from "./context";
import type { SessionState } from "./handlers/types";
import { createModel } from "./model-factory";
import type { ModelProvider } from "./model-provider";
import { getContextWindow } from "./model-registry";
import { createDefaultSkillRouter } from "./SkillRouter";
import { createAgentTools } from "./tools";
import { makeEvaluatorFn } from "./worker-agent";

const BASE_SYSTEM_PROMPT = `You are a research coordinator. Answer directly for simple, certain, or conversational requests. Delegate to background research workers for anything involving files, external data, verification, or uncertainty.

## When to call start_research

- The user asks about files, documents, project structure, or research topics
- The request requires current data, web sources, or external verification
- The answer requires multiple steps or sources to be accurate
- You are not fully certain about the answer
- The topic might have changed since your training data

Do not guess. A quick research task is always better than a wrong answer.

## Tool usage

- read_file: Read files before answering questions about them. You can read any path the user references. Use userProjectDir when exploring the user's project.
- write_file: Create or edit artifacts. Write research outputs and artifacts to userProjectDir. Write project metadata (GOAL.md, FILES.md) to assistantDir. Use meaningful filenames — no task IDs, no UUIDs. Follow FILES.md conventions if they exist.
- safe_bash: Run project operations (git, package managers, tests). State your intent clearly.
- run_in_docker: Execute isolated or untrusted code (Python scripts, data processing). Prefer safe_bash for project-native operations.
- fetch_url / web_search: Get current information or verify claims.
- save_memory / read_memory: Persist important facts across conversations. Read memories when context from past turns would help.
- compress: Use when reading very large files that might exceed context limits.

## Skills

Skills are reusable technique guides in ~/.scholar/skills/ and <assistantDir>/skills/.
When a task matches a skill description, use read_file to load the full SKILL.md before applying it.

## Skill creation

If the user explicitly asks for a skill, write it directly to ~/.scholar/skills/<name>/SKILL.md.
If you discover a reusable pattern the user did not request, use propose_skill to suggest it.

## Output conventions

- Research outputs and artifacts go to userProjectDir by default
- Use descriptive, human-readable filenames
- If FILES.md defines output locations, follow them exactly

## Error handling

- If a tool returns "Approval required", explain what path was blocked and ask the user if they want to allow it.
- If a bash command is blocked, explain why and suggest an alternative.
- If research fails, report the error clearly and offer to retry or adjust.`;

const RESERVED_TOKENS = 6000;
const CHARS_PER_TOKEN = 4;

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
  slug: string;
  projectName: string;
  projectPath: string | null;
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
  readonly tracer: AgentTracer;
  private readonly projectId: string;
  private readonly projectName: string;
  private readonly slug: string;
  private readonly projectPath: string | null;
  private readonly folderPath: string | null;
  private readonly provider: ModelProvider;
  private readonly messageService: MessageService;
  private readonly memoryManager: IMemoryManager;
  private readonly eventBus: EventBus;
  private readonly observabilityService?: ObservabilityService;
  private readonly skillRouter: ReturnType<typeof createDefaultSkillRouter>;
  private readonly homePath: string;

  constructor(
    options: MessagePipelineOptions,
    private readonly state: SessionState,
  ) {
    this.projectId = options.projectId;
    this.slug = options.slug;
    this.projectName = options.projectName;
    this.projectPath = options.projectPath;
    this.folderPath = options.folderPath;
    this.provider = options.provider;
    this.messageService = options.messageService;
    this.memoryManager = options.memoryManager;
    this.eventBus = options.eventBus;
    this.observabilityService = options.observabilityService;

    this.tracer = new AgentTracer({
      observabilityService: options.observabilityService,
      provider: options.provider,
      sessionId: this.state.sessionId,
    });

    this.skillRouter = createDefaultSkillRouter(
      options.projectPath ?? undefined,
      (skillName, summary) => {
        this.state.pendingSkillDeltas.push({ skillName, summary });
      },
    );

    this.homePath = options.homeService.getHomePath();

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
      join(this.homePath, "projects", options.slug, "workspace", ".compressed"),
    );

    const tools = createAgentTools({
      projectId: options.projectId,
      slug: options.slug,
      projectName: options.projectName,
      projectPath: options.projectPath,
      folderPath: options.folderPath,
      homePath: this.homePath,
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
              options.projectPath,
            )
          : options.researchService.startResearch(
              options.projectId,
              options.projectName,
              query,
              options.folderPath,
              options.projectPath,
            ),
      requestEvaluationFn: makeEvaluatorFn({
        projectId: options.projectId,
        slug: options.slug,
        projectName: options.projectName,
        projectPath: options.projectPath,
        folderPath: options.folderPath,
        homePath: this.homePath,
        provider: options.provider,
        webAccessEnabled: options.webAccessEnabled,
        allowlistService: options.allowlistService,
      }),
      saveMemoryFn: options.memoryFileService
        ? (category, title, content, scope) => {
            const svc = options.memoryFileService;
            if (!svc) return Promise.resolve({ path: "" });
            const scholarProjectPath =
              options.projectPath ?? join(this.homePath, "projects", options.slug);
            return svc.saveMemory(
              options.projectId,
              category,
              title,
              content,
              scope,
              scholarProjectPath,
            );
          }
        : undefined,
      readMemoryFn: options.memoryFileService
        ? (readOptions) => {
            const svc = options.memoryFileService;
            if (!svc) return Promise.resolve("");
            const scholarProjectPath =
              options.projectPath ?? join(this.homePath, "projects", options.slug);
            return svc.readMemory({
              ...readOptions,
              scholarProjectPath,
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
        const args = ctx.args as Record<string, unknown> | undefined;
        const tool = tools.find((t) => t.name === ctx.toolCall.name);
        const description =
          typeof args?._description === "string" && args._description.trim()
            ? args._description.trim()
            : (tool?.label ?? ctx.toolCall.name);
        this.state.pendingToolDescriptions.set(ctx.toolCall.id, description);
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
      await this.tracer.startTurn(
        { role: "user", content },
        {
          turnNumber: this.state.currentTurnId,
          projectId: this.projectId,
          systemPrompt: this.agent.state.systemPrompt,
          messages: this.agent.state.messages,
        },
      );

      try {
        if (!this.state.skillRouterReady) {
          await this.skillRouter.buildIndex();
          this.skillRouter.startWatching();
          this.state.skillRouterReady = true;
        }

        const memoryContext = await this.memoryManager.buildContext(this.projectId);
        console.log(JSON.stringify(memoryContext.summary, null, 2));
        const systemContext = await buildSystemContext(
          this.projectPath ?? join(this.homePath, "projects", this.slug),
          this.folderPath,
          this.skillRouter.toXml(),
        );

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

      const streamingMsg = await this.messageService.addMessage({
        projectId: this.projectId,
        role: "assistant",
        content: "",
      });
      this.state.streamingMessageId = streamingMsg.id;

      await this.agent.prompt(content);
    } catch (err) {
      this.tracer.endTurn({ error: String(err) });
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
      this.state.lastUserContent = content;

      void this.tracer.startTurn(
        { role: "user", content },
        {
          turnNumber: this.state.currentTurnId,
          projectId: this.projectId,
          followUp: true,
        },
      );

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

  abort(): void {
    this.agent.abort();

    const content = this.state.assistantContent;
    const streamingId = this.state.streamingMessageId;

    if (streamingId) {
      if (content === "") {
        void this.messageService.deleteMessage(streamingId).catch((err) => {
          console.error("[AgentSession] failed to delete empty placeholder:", err);
        });
      } else {
        void this.messageService.updateMessage(streamingId, content).catch((err) => {
          console.error("[AgentSession] failed to finalize partial message:", err);
        });
      }
      this.state.streamingMessageId = null;
    }

    this.state.assistantContent = "";
    this.state.lastUserContent = "";
    this.state.streamChunkCount = 0;
    this.state.processing = false;

    this.eventBus.emit({ type: "agent:done", payload: { projectId: this.projectId } });
  }
}
