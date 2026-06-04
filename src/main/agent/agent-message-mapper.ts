import type { AgentMessage } from "@mariozechner/pi-agent-core";

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export function toAgentMessages(history: HistoryMessage[]): AgentMessage[] {
  return history.map((m) => ({
    role: m.role,
    content: m.role === "assistant" ? [{ type: "text" as const, text: m.content }] : m.content,
    timestamp: Date.now(),
  })) as AgentMessage[];
}
