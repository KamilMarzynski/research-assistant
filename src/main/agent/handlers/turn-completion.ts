import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { HandlerContext } from "./types";

export async function handleTurnCompletion(event: AgentEvent, ctx: HandlerContext): Promise<void> {
  if (event.type !== "agent_end") return;

  // End turn span
  ctx.state.activeTurnSpan?.update({
    output: { role: "assistant", content: ctx.state.assistantContent },
  });
  ctx.state.activeTurnSpan?.end();
  ctx.state.activeTurnSpan = null;
  ctx.state.turnTraceId = null;
  ctx.state.turnSpanId = null;

  // End any lingering spans
  ctx.state.activeGenerationSpan?.end();
  ctx.state.activeGenerationSpan = null;
  ctx.state.activeToolSpan?.end();
  ctx.state.activeToolSpan = null;

  const content = ctx.state.assistantContent;
  const userContent = ctx.state.lastUserContent;
  ctx.state.assistantContent = "";
  ctx.state.lastUserContent = "";

  if (content && userContent && ctx.state.savedForTurn !== ctx.state.currentTurnId) {
    ctx.state.savedForTurn = ctx.state.currentTurnId;
    try {
      await ctx.messageService.addMessage({
        projectId: ctx.projectId,
        role: "assistant",
        content,
      });
      await ctx.memoryManager.save(ctx.projectId, [
        { role: "user", content: userContent },
        { role: "assistant", content },
      ]);
    } catch (err) {
      console.error("[AgentSession] save failed:", err);
    }
  }

  ctx.eventBus.emit({ type: "agent:done", payload: { projectId: ctx.projectId } });
}
