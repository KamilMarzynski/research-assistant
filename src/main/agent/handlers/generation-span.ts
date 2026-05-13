import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { ModelProvider } from "../model-provider";
import type { SessionState } from "./types";

export async function handleGenerationSpan(
  event: AgentEvent,
  state: SessionState,
  observabilityService:
    | import("../../services/ObservabilityService").ObservabilityService
    | undefined,
  provider: ModelProvider,
): Promise<void> {
  if (event.type === "message_start") {
    const parentContext =
      state.turnTraceId && state.turnSpanId
        ? { traceId: state.turnTraceId, spanId: state.turnSpanId }
        : undefined;
    state.activeGenerationSpan =
      (await observabilityService?.startObservation("llm-generation", {
        asType: "generation",
        input: event.message?.content,
        metadata: { model: provider.model, provider: provider.type },
        parentSpanContext: parentContext,
      })) ?? null;
  } else if (event.type === "message_end") {
    // TODO: add token usage when pi-agent exposes it on the event
    state.activeGenerationSpan?.update({
      output: event.message?.content,
      metadata: { model: provider.model, provider: provider.type },
    });
    state.activeGenerationSpan?.end();
    state.activeGenerationSpan = null;
  }
}
