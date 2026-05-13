import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { SessionState } from "./types";

export async function handleToolSpan(
  event: AgentEvent,
  state: SessionState,
  observabilityService:
    | import("../../services/ObservabilityService").ObservabilityService
    | undefined,
): Promise<void> {
  if (event.type === "tool_execution_start") {
    const parentContext =
      state.turnTraceId && state.turnSpanId
        ? { traceId: state.turnTraceId, spanId: state.turnSpanId }
        : undefined;
    state.activeToolSpan =
      (await observabilityService?.startObservation(`tool:${event.toolName ?? "unknown"}`, {
        asType: "tool",
        input: event.args,
        parentSpanContext: parentContext,
      })) ?? null;
  } else if (event.type === "tool_execution_end") {
    state.activeToolSpan?.update({
      output: event.result,
      metadata: { isError: event.isError ?? false },
      level: event.isError ? "ERROR" : "DEFAULT",
      statusMessage: event.isError ? String(event.result) : undefined,
    });
    state.activeToolSpan?.end();
    state.activeToolSpan = null;
  }
}
