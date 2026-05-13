import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { HandlerContext } from "./types";

export async function handleStreamChunk(event: AgentEvent, ctx: HandlerContext): Promise<void> {
  if (event.type !== "message_update") return;

  const ae = event.assistantMessageEvent;
  if (ae?.type === "text_delta") {
    ctx.state.assistantContent += ae.delta;
    ctx.eventBus.emit({
      type: "agent:chunk",
      payload: { projectId: ctx.projectId, delta: ae.delta },
    });
  }
}
