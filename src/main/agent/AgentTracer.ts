import type { Agent, AgentEvent } from "@mariozechner/pi-agent-core";
import type { ObservabilityService, ObservationSpan } from "../services/ObservabilityService";
import type { ModelProvider } from "./model-provider";

export interface AgentTracerOptions {
  observabilityService?: ObservabilityService;
  provider: ModelProvider;
  sessionId?: string;
  parentSpanContext?: { traceId: string; spanId: string };
  metadata?: Record<string, unknown>;
}

function isAssistantMessage(message: unknown): message is { role: string; content: unknown } {
  return (
    typeof message === "object" &&
    message !== null &&
    "role" in message &&
    (message as Record<string, unknown>).role === "assistant"
  );
}

export class AgentTracer {
  private readonly observabilityService?: ObservabilityService;
  private readonly provider: ModelProvider;
  private readonly sessionId?: string;
  private readonly parentSpanContext?: { traceId: string; spanId: string };
  private readonly metadata?: Record<string, unknown>;

  private turnSpan: ObservationSpan | null = null;
  private activeGenerationSpan: ObservationSpan | null = null;
  private activeToolSpan: ObservationSpan | null = null;
  private turnTraceId: string | null = null;
  private turnSpanId: string | null = null;

  constructor(options: AgentTracerOptions) {
    this.observabilityService = options.observabilityService;
    this.provider = options.provider;
    this.sessionId = options.sessionId;
    this.parentSpanContext = options.parentSpanContext;
    this.metadata = options.metadata;
  }

  async startTurn(input: unknown, extraMetadata?: Record<string, unknown>): Promise<void> {
    if (!this.observabilityService) return;

    // End any lingering previous turn to prevent span leaks
    if (this.turnSpan) {
      await this.endTurn();
    }

    const span = await this.observabilityService.startObservation("agent-turn", {
      asType: "agent",
      input,
      parentSpanContext: this.parentSpanContext,
      sessionId: this.sessionId,
      metadata: {
        ...this.metadata,
        ...extraMetadata,
      },
    });

    if (span) {
      this.turnSpan = span;
      this.turnTraceId = span.traceId;
      this.turnSpanId = span.spanId;
    }
  }

  async endTurn(output?: unknown): Promise<void> {
    if (!this.observabilityService) return;

    if (this.activeGenerationSpan) {
      this.activeGenerationSpan.end();
      this.activeGenerationSpan = null;
    }

    if (this.activeToolSpan) {
      this.activeToolSpan.end();
      this.activeToolSpan = null;
    }

    if (this.turnSpan) {
      if (output !== undefined) {
        this.turnSpan.update({ output });
      }
      this.turnSpan.end();
      this.turnSpan = null;
      this.turnTraceId = null;
      this.turnSpanId = null;
    }
  }

  getSpanContext(): { traceId: string; spanId: string } | null {
    if (this.turnTraceId && this.turnSpanId) {
      return { traceId: this.turnTraceId, spanId: this.turnSpanId };
    }
    return null;
  }

  subscribeToAgent(agent: Agent): () => void {
    if (!this.observabilityService) {
      return () => {};
    }

    return agent.subscribe(async (event: AgentEvent) => {
      try {
        await this.handleGenerationSpan(event, agent);
        await this.handleToolSpan(event, agent);
      } catch (err) {
        console.error("[AgentTracer] event handler error:", err);
      }
    });
  }

  private async handleGenerationSpan(event: AgentEvent, agent: Agent): Promise<void> {
    const service = this.observabilityService;
    if (!service) return;

    if (event.type === "message_start") {
      if (!isAssistantMessage(event.message)) return;
      if (!this.turnTraceId || !this.turnSpanId) return;

      // End any lingering previous generation span to prevent leaks
      if (this.activeGenerationSpan) {
        this.activeGenerationSpan.end();
        this.activeGenerationSpan = null;
      }

      this.activeGenerationSpan =
        (await service.startObservation("llm-generation", {
          asType: "generation",
          input: {
            messages: agent.state.messages,
            systemPrompt: agent.state.systemPrompt,
          },
          metadata: { model: this.provider.model, provider: this.provider.type },
          parentSpanContext: { traceId: this.turnTraceId, spanId: this.turnSpanId },
        })) ?? null;
    } else if (event.type === "message_end") {
      if (!this.activeGenerationSpan) return;

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

      this.activeGenerationSpan.update({
        output: event.message?.content,
        metadata: {
          model: this.provider.model,
          provider: this.provider.type,
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
      this.activeGenerationSpan.end();
      this.activeGenerationSpan = null;
    }
  }

  private async handleToolSpan(event: AgentEvent, agent: Agent): Promise<void> {
    const service = this.observabilityService;
    if (!service) return;

    if (event.type === "tool_execution_start") {
      if (!this.turnTraceId || !this.turnSpanId) return;

      // End any lingering previous tool span to prevent leaks
      if (this.activeToolSpan) {
        this.activeToolSpan.end();
        this.activeToolSpan = null;
      }

      this.activeToolSpan =
        (await service.startObservation(`tool:${event.toolName ?? "unknown"}`, {
          asType: "tool",
          input: event.args,
          metadata: { messages: agent.state.messages },
          parentSpanContext: { traceId: this.turnTraceId, spanId: this.turnSpanId },
        })) ?? null;
    } else if (event.type === "tool_execution_end") {
      if (!this.activeToolSpan) return;

      this.activeToolSpan.update({
        output: event.result,
        metadata: { isError: event.isError ?? false },
        level: event.isError ? "ERROR" : "DEFAULT",
        statusMessage: event.isError && event.result != null ? String(event.result) : undefined,
      });
      this.activeToolSpan.end();
      this.activeToolSpan = null;
    }
  }
}
