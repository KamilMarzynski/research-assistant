import { Agent } from "@mariozechner/pi-agent-core";
import type { BrowserWindow } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { EventBus } from "../event-bus";
import type { HomeService } from "../services/HomeService";
import type { MemoryFileService } from "../services/MemoryFileService";
import type { IMemoryManager, MemoryContext } from "../services/MemoryManager";
import type { MessageService } from "../services/MessageService";
import type { ResearchService } from "../services/ResearchService";
import { FIRST_RUN_SKILL } from "./builtin-skills";
import { buildSystemContext } from "./context";
import { createModel } from "./model-factory";
import type { ModelProvider } from "./model-provider";
import { createAgentTools } from "./tools";
import { makeEvaluatorFn } from "./worker-agent";

const BASE_SYSTEM_PROMPT = "You are a helpful research assistant.";

function formatConversationHistory(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): string {
  if (messages.length === 0) return "";
  const lines = messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`);
  return `<conversation_history>\n${lines.join("\n\n")}\n</conversation_history>`;
}

export interface AgentSessionOptions {
  win: BrowserWindow;
  messageService: MessageService;
  homeService: HomeService;
  researchService: ResearchService;
  memoryManager: IMemoryManager;
  eventBus?: EventBus;
  initialMemoryContext: MemoryContext;
  projectId: string;
  projectName: string;
  folderPath: string | null;
  provider: ModelProvider;
  isFirstRun: boolean;
  systemContext?: string;
  langfuseEnabled: boolean;
  webAccessEnabled?: boolean;
  onFileWrite?: (absolutePath: string, relativePath: string, fileName: string) => void;
  memoryFileService?: MemoryFileService;
}

export class AgentSession {
  private readonly agent: Agent;
  private readonly win: BrowserWindow;
  private readonly messageService: MessageService;
  private readonly memoryManager: IMemoryManager;
  private readonly projectId: string;
  private readonly projectName: string;
  private readonly folderPath: string | null;
  private assistantContent = "";
  private currentTurnId = 0;
  private savedForTurn = 0;
  private lastUserContent = "";
  private processing = false;
  private pendingFollowUp: string | null = null;
  private pendingSkillDeltas: Array<{ skillName: string; summary: string }> = [];

  constructor({
    win,
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
    langfuseEnabled,
    webAccessEnabled,
    onFileWrite,
    memoryFileService,
  }: AgentSessionOptions) {
    this.win = win;
    this.messageService = messageService;
    this.memoryManager = memoryManager;
    this.projectId = projectId;
    this.projectName = projectName;
    this.folderPath = folderPath;

    if (eventBus) {
      eventBus.on("skill:changed", (payload) => {
        this.pendingSkillDeltas.push(payload);
      });
    }

    const homePath = homeService.getHomePath();
    const historyBlock = formatConversationHistory(initialMemoryContext.recentMessages);

    const systemPrompt = [
      isFirstRun ? FIRST_RUN_SKILL : BASE_SYSTEM_PROMPT,
      initialMemoryContext.summary,
      historyBlock,
      systemContext,
    ]
      .filter(Boolean)
      .join("\n\n");

    const tools = createAgentTools({
      projectId,
      projectName,
      folderPath,
      homePath,
      apiKey: provider.type === "ollama" ? "ollama" : provider.apiKey,
      model: provider.model,
      webAccessEnabled,
      onFileWrite,
      emitBlocked: eventBus
        ? (payload) => eventBus.emit({ type: "bash:blocked", payload })
        : undefined,
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
      }),
      saveMemoryFn: memoryFileService
        ? (category, title, content, scope) =>
            memoryFileService.saveMemory(category, title, content, scope, folderPath ?? undefined)
        : undefined,
      readMemoryFn: memoryFileService
        ? (options) =>
            memoryFileService.readMemory({ ...options, projectFolderPath: folderPath ?? undefined })
        : undefined,
    });

    this.agent = new Agent({
      initialState: {
        systemPrompt,
        model: createModel({ provider, langfuseEnabled }),
        tools,
      },
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
            this.win.webContents.send(IPC.MESSAGE_CHUNK, ae.delta);
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
          this.win.webContents.send(IPC.MESSAGE_DONE);
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
        const memoryContext = await this.memoryManager.buildContext(this.projectId, 20);
        const historyBlock = formatConversationHistory(memoryContext.recentMessages);
        const systemContext = await buildSystemContext(
          this.projectId,
          this.projectName,
          this.folderPath ?? undefined,
        );
        const systemPrompt = [
          BASE_SYSTEM_PROMPT,
          memoryContext.summary,
          historyBlock,
          systemContext,
        ]
          .filter(Boolean)
          .join("\n\n");
        this.agent.state.systemPrompt = systemPrompt;
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
