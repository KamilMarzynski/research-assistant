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
import { pruneMessages } from "./message-context-pruner";
import { createModel } from "./model-factory";
import type { ModelProvider } from "./model-provider";
import { getContextWindow } from "./model-registry";
import { BASE_SYSTEM_PROMPT } from "./prompts";
import { createDefaultSkillRouter } from "./SkillRouter";
import { buildSystemPrompt } from "./system-prompt-builder";
import { createAgentTools } from "./tools";
import { makeEvaluatorFn } from "./worker-agent";

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
  private readonly slug: string;
  private readonly projectPath: string | null;
  private readonly folderPath: string | null;
  private readonly messageService: MessageService;
  private readonly memoryManager: IMemoryManager;
  private readonly eventBus: EventBus;
  private readonly skillRouter: ReturnType<typeof createDefaultSkillRouter>;
  private readonly homePath: string;

  constructor(
    options: MessagePipelineOptions,
    private readonly state: SessionState,
  ) {
    this.projectId = options.projectId;
    this.slug = options.slug;
    this.projectPath = options.projectPath;
    this.folderPath = options.folderPath;
    this.messageService = options.messageService;
    this.memoryManager = options.memoryManager;
    this.eventBus = options.eventBus;

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

    const systemPrompt = buildSystemPrompt({
      basePrompt: BASE_SYSTEM_PROMPT,
      firstRunPrompt: FIRST_RUN_SKILL,
      memorySummary: options.initialMemoryContext.summary,
      systemContext: options.systemContext,
      isFirstRun: options.isFirstRun,
    });

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
      emitExecuteCodeApprovalRequired: (payload) => {
        options.eventBus.emit({ type: "execute_code:approval_required", payload });
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
    });

    this.agent = new Agent({
      initialState: {
        systemPrompt,
        model: createModel({ provider: options.provider }),
        tools,
        messages: initialMessages,
      },
      transformContext: async (messages) =>
        pruneMessages(messages, getContextWindow(options.provider.model)),
      getApiKey: async () =>
        options.provider.type === "ollama" ? "ollama" : options.provider.apiKey,
      beforeToolCall: async (ctx) => {
        const allowed = new Set(tools.map((t) => t.name));
        if (!allowed.has(ctx.toolCall.name)) {
          return { block: true, reason: `Tool "${ctx.toolCall.name}" is not registered.` };
        }
        const tool = tools.find((t) => t.name === ctx.toolCall.name);
        const description = tool?.label ?? ctx.toolCall.name;
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
        const systemContext = await buildSystemContext(
          this.projectPath ?? join(this.homePath, "projects", this.slug),
          this.folderPath,
          this.skillRouter.toXml(),
        );

        const newSystemPrompt = buildSystemPrompt({
          basePrompt: BASE_SYSTEM_PROMPT,
          memorySummary: memoryContext.summary,
          systemContext,
        });

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
