import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { BrowserWindow } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { HomeService } from "../services/HomeService";
import type { MessageService } from "../services/MessageService";
import type { ResearchService } from "../services/ResearchService";
import { createAgentTools } from "./tools";

const FIRST_RUN_PROMPT = `You are setting up for first use. Ask the user these questions one at a time. Do not ask all at once.
1. How do you organise your projects? (e.g. folder per project, by topic, other)
2. Do you use a note-taking app or work with plain folders?
3. What file types do you mainly work with?
4. Any naming conventions or folder structures you always follow?
After receiving all answers, write a concise summary to ~/.research-assistant/config.md (plain Markdown, human-editable). Then confirm setup is complete.`;

const BASE_SYSTEM_PROMPT = "You are a helpful research assistant.";

export interface AgentSessionOptions {
  win: BrowserWindow;
  messageService: MessageService;
  homeService: HomeService;
  researchService: ResearchService;
  projectId: string;
  projectName: string;
  folderPath: string | null;
  apiKey: string;
  model: string;
  isFirstRun: boolean;
  systemContext?: string;
}

export class AgentSession {
  private readonly agent: Agent;
  private readonly win: BrowserWindow;
  private readonly messageService: MessageService;
  private readonly projectId: string;
  private assistantContent = "";

  constructor({
    win,
    messageService,
    homeService,
    researchService,
    projectId,
    projectName,
    folderPath,
    apiKey,
    model,
    isFirstRun,
    systemContext = "",
  }: AgentSessionOptions) {
    this.win = win;
    this.messageService = messageService;
    this.projectId = projectId;

    const homePath = homeService.getHomePath();

    const systemPrompt = [isFirstRun ? FIRST_RUN_PROMPT : BASE_SYSTEM_PROMPT, systemContext]
      .filter(Boolean)
      .join("\n\n");

    this.agent = new Agent({
      initialState: {
        systemPrompt,
        model: getModel("openrouter", model as never),
      },
      getApiKey: async () => apiKey,
      beforeToolCall: async (ctx) => {
        const allowed = new Set(this.agent.state.tools.map((t) => t.name));
        if (!allowed.has(ctx.toolCall.name)) {
          return { block: true, reason: `Tool "${ctx.toolCall.name}" is not registered.` };
        }
        return undefined;
      },
    });

    // Register tools — start_research calls ResearchService
    this.agent.state.tools = createAgentTools({
      projectId,
      projectName,
      folderPath,
      homePath,
      startResearchFn: async (query) => {
        const task = await researchService.startResearch(projectId, projectName, query, folderPath);
        return { taskId: task.id };
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
          if (this.assistantContent) {
            await this.messageService.addMessage({
              projectId: this.projectId,
              role: "assistant",
              content: this.assistantContent,
            });
            this.assistantContent = "";
          }
          this.win.webContents.send(IPC.MESSAGE_DONE);
        }
      } catch (err) {
        console.error("[AgentSession] subscriber error:", err);
        this.win.webContents.send(IPC.MESSAGE_DONE);
      }
    });
  }

  async send(content: string): Promise<void> {
    await this.messageService.addMessage({
      projectId: this.projectId,
      role: "user",
      content,
    });
    await this.agent.prompt(content);
  }

  queueFollowUp(content: string): void {
    this.agent.followUp({ role: "user", content, timestamp: Date.now() });
  }

  abort(): void {
    this.agent.abort();
  }
}
