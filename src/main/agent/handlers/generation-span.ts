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
    state.activeGenerationSpan =
      (await observabilityService?.startObservation("llm-generation", {
        asType: "generation",
        input: event.message?.content,
        metadata: { model: provider.model },
      })) ?? null;
  } else if (event.type === "message_end") {
    state.activeGenerationSpan?.update({
      output: event.message?.content,
    });
    state.activeGenerationSpan?.end();
    state.activeGenerationSpan = null;
  }
}
