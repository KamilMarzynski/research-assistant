import type { Agent, AgentEvent } from "@mariozechner/pi-agent-core";
import type { ModelProvider } from "../model-provider";
import type { SessionState } from "./types";

function isAssistantMessage(message: unknown): message is { role: string; content: unknown } {
  return (
    typeof message === "object" &&
    message !== null &&
    "role" in message &&
    (message as Record<string, unknown>).role === "assistant"
  );
}

export async function handleGenerationSpan(
  event: AgentEvent,
  state: SessionState,
  observabilityService:
    | import("../../services/ObservabilityService").ObservabilityService
    | undefined,
  provider: ModelProvider,
  agent: Agent,
): Promise<void> {
  if (event.type === "message_start") {
    // Only track real LLM generations (assistant role). Skip passthroughs:
    // - user prompts, steering messages (role: "user")
    // - tool results injected back into context (role: "toolResult")
    if (!isAssistantMessage(event.message)) return;

    const parentContext =
      state.turnTraceId && state.turnSpanId
        ? { traceId: state.turnTraceId, spanId: state.turnSpanId }
        : undefined;
    state.activeGenerationSpan =
      (await observabilityService?.startObservation("llm-generation", {
        asType: "generation",
        input: {
          messages: agent.state.messages,
          systemPrompt: agent.state.systemPrompt,
        },
        metadata: { model: provider.model, provider: provider.type },
        parentSpanContext: parentContext,
      })) ?? null;
  } else if (event.type === "message_end") {
    if (!state.activeGenerationSpan) return;

    const msg = event.message as unknown as {
      usage?: {
        input: number;
        output: number;
        totalTokens: number;
        cacheRead: number;
        cacheWrite: number;
        cost: {
          input: number;
          output: number;
          total: number;
          cacheRead: number;
          cacheWrite: number;
        };
      };
    };
    const usage = msg.usage;

    state.activeGenerationSpan.update({
      output: event.message?.content,
      metadata: {
        model: provider.model,
        provider: provider.type,
        ...(usage
          ? {
              usageDetails: {
                promptTokens: usage.input,
                completionTokens: usage.output,
                totalTokens: usage.totalTokens,
                cacheReadTokens: usage.cacheRead,
                cacheWriteTokens: usage.cacheWrite,
              },
              costDetails: {
                input: usage.cost.input,
                output: usage.cost.output,
                total: usage.cost.total,
                cacheRead: usage.cost.cacheRead,
                cacheWrite: usage.cost.cacheWrite,
              },
            }
          : {}),
      },
    });
    state.activeGenerationSpan.end();
    state.activeGenerationSpan = null;
  }
}
