import { Agent } from "@mariozechner/pi-agent-core";
import type { BrowserWindow } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { EventBus } from "../event-bus";
import type { HomeService } from "../services/HomeService";
import type { IMemoryManager, MemoryContext } from "../services/MemoryManager";
import type { MessageService } from "../services/MessageService";
import type { ResearchService } from "../services/ResearchService";
import { FIRST_RUN_SKILL } from "./builtin-skills";
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
}

export class AgentSession {
  private readonly agent: Agent;
  private readonly win: BrowserWindow;
  private readonly messageService: MessageService;
  private readonly memoryManager: IMemoryManager;
  private readonly projectId: string;
  private assistantContent = "";
  private lastUserContent = "";

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
  }: AgentSessionOptions) {
    this.win = win;
    this.messageService = messageService;
    this.memoryManager = memoryManager;
    this.projectId = projectId;

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

    this.agent = new Agent({
      initialState: {
        systemPrompt,
        model: createModel({ provider, langfuseEnabled }),
      },
      getApiKey: async () => (provider.type === "ollama" ? "ollama" : provider.apiKey),
      beforeToolCall: async (ctx) => {
        const allowed = new Set(this.agent.state.tools.map((t) => t.name));
        if (!allowed.has(ctx.toolCall.name)) {
          return { block: true, reason: `Tool "${ctx.toolCall.name}" is not registered.` };
        }
        return undefined;
      },
    });

    this.agent.state.tools = createAgentTools({
      projectId,
      projectName,
      folderPath,
      homePath,
      apiKey: provider.type === "ollama" ? "ollama" : provider.apiKey,
      model: provider.model,
      webAccessEnabled,
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
          try {
            if (this.assistantContent && this.lastUserContent) {
              await this.messageService.addMessage({
                projectId: this.projectId,
                role: "assistant",
                content: this.assistantContent,
              });
              await this.memoryManager.save(this.projectId, [
                { role: "user", content: this.lastUserContent },
                { role: "assistant", content: this.assistantContent },
              ]);
            }
          } finally {
            this.assistantContent = "";
            this.lastUserContent = "";
            this.win.webContents.send(IPC.MESSAGE_DONE);
          }
        }
      } catch (err) {
        console.error("[AgentSession] subscriber error:", err);
      }
    });
  }

  async send(content: string): Promise<void> {
    this.lastUserContent = content;
    await this.messageService.addMessage({
      projectId: this.projectId,
      role: "user",
      content,
    });
    await this.agent.prompt(content);
  }

  queueFollowUp(content: string): void {
    void (async () => {
      try {
        await this.agent.followUp({ role: "user", content, timestamp: Date.now() });
      } catch (err) {
        console.error("[AgentSession] followUp failed:", err);
      }
    })();
  }

  abort(): void {
    this.agent.abort();
  }
}
