import type { AgentMessage } from "@mariozechner/pi-agent-core";

const RESERVED_TOKENS = 6000;
const CHARS_PER_TOKEN = 4;

function extractMessageText(msg: { content: unknown }): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return (msg.content as Array<{ text?: string }>).map((c) => c?.text ?? "").join("");
  }
  return "";
}

export function pruneMessages(messages: AgentMessage[], contextWindow: number): AgentMessage[] {
  const availableTokens = contextWindow - RESERVED_TOKENS;
  let estimatedTokens = 0;
  const pruned: AgentMessage[] = [];

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
}
