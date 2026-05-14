import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { HandlerContext } from "./types";

export async function handleStreamChunk(event: AgentEvent, ctx: HandlerContext): Promise<void> {
  if (event.type === "message_update") {
    const ae = event.assistantMessageEvent;
    if (ae?.type === "text_delta") {
      ctx.state.assistantContent += ae.delta;
      ctx.state.streamChunkCount++;
      ctx.eventBus.emit({
        type: "agent:chunk",
        payload: { projectId: ctx.projectId, delta: ae.delta },
      });

      if (ctx.state.streamingMessageId && ctx.state.streamChunkCount % 5 === 0) {
        try {
          await ctx.messageService.updateMessage(
            ctx.state.streamingMessageId,
            ctx.state.assistantContent,
          );
        } catch (err) {
          console.error("[AgentSession] failed to update streaming message:", err);
        }
      }
    }
    return;
  }

  if (event.type === "tool_execution_start") {
    const description = ctx.state.pendingToolDescriptions.get(event.toolCallId) ?? event.toolName;
    ctx.state.pendingToolDescriptions.delete(event.toolCallId);
    ctx.eventBus.emit({
      type: "agent:tool_start",
      payload: {
        projectId: ctx.projectId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        description,
      },
    });
    return;
  }

  if (event.type === "tool_execution_end") {
    ctx.eventBus.emit({
      type: "agent:tool_end",
      payload: {
        projectId: ctx.projectId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
      },
    });
  }
}
