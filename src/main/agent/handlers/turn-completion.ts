import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { MessageSegment, ToolCallRecord } from "../../../shared/types";
import type { HandlerContext, PendingToolCall } from "./types";

function isFinished(tc: PendingToolCall): tc is ToolCallRecord {
  return tc.status !== "running";
}

export async function handleTurnCompletion(event: AgentEvent, ctx: HandlerContext): Promise<void> {
  if (event.type !== "agent_end") return;

  const content = ctx.state.assistantContent;
  const userContent = ctx.state.lastUserContent;
  const segments: MessageSegment[] = [...ctx.state.segmentLog];
  ctx.state.assistantContent = "";
  ctx.state.lastUserContent = "";
  ctx.state.streamChunkCount = 0;
  ctx.state.segmentLog = [];

  if (content && userContent && ctx.state.savedForTurn !== ctx.state.currentTurnId) {
    ctx.state.savedForTurn = ctx.state.currentTurnId;
    const finishedToolCalls = ctx.state.pendingToolCalls.filter(isFinished);
    ctx.state.pendingToolCalls = [];
    const toolCallsArg = finishedToolCalls.length > 0 ? finishedToolCalls : undefined;
    const segmentsArg = segments.length > 0 ? segments : undefined;
    try {
      if (ctx.state.streamingMessageId) {
        await ctx.messageService.updateMessage(
          ctx.state.streamingMessageId,
          content,
          toolCallsArg,
          segmentsArg,
        );
      } else {
        await ctx.messageService.addMessage({
          projectId: ctx.projectId,
          role: "assistant",
          content,
          ...(toolCallsArg ? { toolCalls: toolCallsArg } : {}),
          ...(segmentsArg ? { segments: segmentsArg } : {}),
        });
      }
      await ctx.memoryManager.save(ctx.projectId, [
        { role: "user", content: userContent },
        { role: "assistant", content },
      ]);
    } catch (err) {
      console.error("[AgentSession] save failed:", err);
    }
  } else {
    ctx.state.pendingToolCalls = [];
  }

  ctx.state.streamingMessageId = null;
  ctx.eventBus.emit({ type: "agent:done", payload: { projectId: ctx.projectId } });
}
