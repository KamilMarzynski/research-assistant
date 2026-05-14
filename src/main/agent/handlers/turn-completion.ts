import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { HandlerContext } from "./types";

export async function handleTurnCompletion(event: AgentEvent, ctx: HandlerContext): Promise<void> {
  if (event.type !== "agent_end") return;

  const content = ctx.state.assistantContent;
  const userContent = ctx.state.lastUserContent;
  ctx.state.assistantContent = "";
  ctx.state.lastUserContent = "";
  ctx.state.streamChunkCount = 0;

  if (content && userContent && ctx.state.savedForTurn !== ctx.state.currentTurnId) {
    ctx.state.savedForTurn = ctx.state.currentTurnId;
    try {
      if (ctx.state.streamingMessageId) {
        await ctx.messageService.updateMessage(ctx.state.streamingMessageId, content);
      } else {
        await ctx.messageService.addMessage({
          projectId: ctx.projectId,
          role: "assistant",
          content,
        });
      }
      await ctx.memoryManager.save(ctx.projectId, [
        { role: "user", content: userContent },
        { role: "assistant", content },
      ]);
    } catch (err) {
      console.error("[AgentSession] save failed:", err);
    }
  }

  ctx.state.streamingMessageId = null;
  ctx.eventBus.emit({ type: "agent:done", payload: { projectId: ctx.projectId } });
}
