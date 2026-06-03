import { join } from "node:path";
import { Agent, type AgentMessage, type AgentToolResult } from "@mariozechner/pi-agent-core";
import type { EventBus } from "../event-bus";
import { addPendingPathApproval } from "../ipc/command-handlers";
import type { AllowlistService } from "../services/AllowlistService";
import type { ApprovalPolicyService } from "../services/ApprovalPolicyService";
import type { HomeService } from "../services/HomeService";
import type { MemoryFileService } from "../services/MemoryFileService";
import type { IMemoryManager, MemoryContext } from "../services/MemoryManager";
import type { MessageService } from "../services/MessageService";
import type { ObservabilityService } from "../services/ObservabilityService";
import type { ResearchService } from "../services/ResearchService";
import { AgentTracer } from "./AgentTracer";
import { toAgentMessages } from "./agent-message-mapper";
import { CompressionService } from "./CompressionService";
import { buildSystemContext } from "./context";
import type { SessionState } from "./handlers/types";
import { pruneMessages } from "./message-context-pruner";
import { createModel } from "./model-factory";
import type { ModelProvider } from "./model-provider";
import { BASE_SYSTEM_PROMPT } from "./prompts";
import type { ProviderModelMetadata } from "./providers/provider-client.types";
import { getDefaultContextWindow } from "./providers/static-model-metadata";
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
  resolvedModelMetadata?: ProviderModelMetadata;
  messageService: MessageService;
  memoryManager: IMemoryManager;
  eventBus: EventBus;
  observabilityService?: ObservabilityService;
  homeService: HomeService;
  researchService: ResearchService;
  memoryFileService?: MemoryFileService;
  allowlistService: AllowlistService;
  approvalPolicyService?: ApprovalPolicyService;
  onFileWrite?: (absolutePath: string, relativePath: string, fileName: string) => void;
  initialMemoryContext: MemoryContext;
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
      memorySummary: options.initialMemoryContext.summary,
      systemContext: options.systemContext,
    });

    const initialMessages = toAgentMessages(options.initialMemoryContext.historyMessages);

    const compressionService = new CompressionService(
      join(this.homePath, "projects", options.slug, "workspace", ".compressed"),
    );

    const shouldBypassApproval = options.approvalPolicyService
      ? (projectId: string) =>
          options.approvalPolicyService?.shouldBypass(projectId) ?? Promise.resolve(false)
      : undefined;

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
      shouldBypassApproval,
      startResearchFn: (brief, deep) =>
        deep === true
          ? options.researchService.startOrchestratedResearch(
              options.projectId,
              options.projectName,
              brief,
              options.folderPath,
              options.projectPath,
            )
          : options.researchService.startResearch(
              options.projectId,
              options.projectName,
              brief,
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
        shouldBypassApproval,
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

    const effectiveContextWindow =
      options.resolvedModelMetadata?.effectiveContextWindow ??
      options.resolvedModelMetadata?.maxContextWindow ??
      getDefaultContextWindow();

    this.agent = new Agent({
      sessionId: this.state.sessionId,
      initialState: {
        systemPrompt,
        model: createModel({ provider: options.provider, metadata: options.resolvedModelMetadata }),
        tools,
        messages: initialMessages,
      },
      transformContext: async (messages) => pruneMessages(messages, effectiveContextWindow),
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
      afterToolCall: async (ctx) => {
        if (ctx.isError) return undefined;
        const THRESHOLD = 20_000;
        let changed = false;
        const compressed: AgentToolResult<unknown>["content"] = [];
        for (const block of ctx.result.content) {
          if (block.type === "text" && block.text && block.text.length > THRESHOLD) {
            try {
              const result = await compressionService.compress("after_tool_call", block.text, [
                { tool: "after_tool_call", thresholdChars: THRESHOLD, strategy: "truncate" },
              ]);
              compressed.push({ type: "text", text: result.content });
              changed = true;
            } catch {
              compressed.push(block);
            }
          } else {
            compressed.push(block);
          }
        }
        if (!changed) return undefined;
        return { content: compressed };
      },
    });
  }

  async send(content: string): Promise<void> {
    if (this.agent.state.isStreaming) {
      throw new Error("Agent is already processing a message. Please wait for the response.");
    }
    this.state.currentTurnId++;
    this.state.savedForTurn = 0;

    try {
      try {
        if (!this.state.skillRouterReady) {
          this.skillRouter.startWatching();
          this.state.skillRouterReady = true;
        }
        await this.skillRouter.buildIndex();

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

      await this.tracer.startTurn(
        { role: "user", content },
        {
          turnNumber: this.state.currentTurnId,
          projectId: this.projectId,
          systemPrompt: this.agent.state.systemPrompt,
          messages: this.agent.state.messages,
        },
      );

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
    }
  }

  async queueFollowUp(content: string): Promise<void> {
    this.agent.followUp({ role: "user", content, timestamp: Date.now() } as AgentMessage);
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
        void this.messageService
          .updateMessage(streamingId, content, undefined, [...this.state.segmentLog])
          .catch((err) => {
            console.error("[AgentSession] failed to finalize partial message:", err);
          });
      }
      this.state.streamingMessageId = null;
    }

    this.state.assistantContent = "";
    this.state.lastUserContent = "";
    this.state.streamChunkCount = 0;
    this.state.segmentLog = [];

    this.eventBus.emit({ type: "agent:done", payload: { projectId: this.projectId } });
  }

  injectAssistantMessage(content: string): void {
    this.agent.state.messages.push({
      role: "assistant",
      content: [{ type: "text", text: content }],
      timestamp: Date.now(),
    } as import("@mariozechner/pi-agent-core").AgentMessage);
  }

  isProcessing(): boolean {
    return this.agent.state.isStreaming;
  }
}
