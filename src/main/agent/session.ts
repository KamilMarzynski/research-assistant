import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { BrowserWindow } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { MessageService } from "../services/MessageService";

interface AgentSessionOptions {
  win: BrowserWindow;
  messageService: MessageService;
  projectId: string;
  apiKey: string;
  model: string;
}

export class AgentSession {
  private readonly agent: Agent;
  private readonly win: BrowserWindow;
  private readonly messageService: MessageService;
  private readonly projectId: string;
  private assistantContent = "";

  constructor({ win, messageService, projectId, apiKey, model }: AgentSessionOptions) {
    this.win = win;
    this.messageService = messageService;
    this.projectId = projectId;

    this.agent = new Agent({
      initialState: {
        systemPrompt: "You are a helpful research assistant.",
        model: getModel("openrouter", model as never),
      },
      getApiKey: async () => apiKey,
      beforeToolCall: async () => ({ block: true, reason: "Tools not available until Run 6" }),
    });

    this.agent.subscribe(async (event: unknown) => {
      const e = event as { type: string; assistantMessageEvent?: { type: string; delta: string }; messages?: unknown[] };

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

  abort(): void {
    this.agent.abort();
  }
}
