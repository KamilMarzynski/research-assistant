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
    state.activeToolSpan =
      (await observabilityService?.startObservation(`tool:${event.toolName ?? "unknown"}`, {
        asType: "tool",
        input: event.args,
      })) ?? null;
  } else if (event.type === "tool_execution_end") {
    state.activeToolSpan?.update({
      output: event.result,
      metadata: { isError: event.isError ?? false },
    });
    state.activeToolSpan?.end();
    state.activeToolSpan = null;
  }
}
