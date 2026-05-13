import type { Agent, AgentEvent } from "@mariozechner/pi-agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ObservabilityService, ObservationSpan } from "../services/ObservabilityService";
import { AgentTracer } from "./AgentTracer";

const DEFAULT_PROVIDER = { type: "openrouter" as const, apiKey: "key", model: "gpt-4" };

function createMockSpan(overrides: Partial<ObservationSpan> = {}): ObservationSpan {
  return {
    update: vi.fn(),
    end: vi.fn(),
    traceId: "trace-1",
    spanId: "span-1",
    ...overrides,
  };
}

function createMockObservabilityService(): ObservabilityService {
  return {
    isEnabled: vi.fn().mockResolvedValue(true),
    observe: vi.fn(),
    startObservation: vi.fn().mockResolvedValue(null),
  } as unknown as ObservabilityService;
}

function createMockAgent(): Agent {
  return {
    subscribe: vi.fn().mockReturnValue(() => {}),
    state: {
      messages: [],
      systemPrompt: "test system prompt",
    },
  } as unknown as Agent;
}

function captureSubscribe(agent: Agent): (event: AgentEvent) => Promise<void> {
  let capturedSubscriber: ((event: AgentEvent) => Promise<void>) | null = null;
  agent.subscribe = vi.fn((cb: (event: AgentEvent) => Promise<void>) => {
    capturedSubscriber = cb;
    return () => {};
  });
  return async (event: AgentEvent) => {
    if (capturedSubscriber) {
      await capturedSubscriber(event);
    }
  };
}

describe("AgentTracer", () => {
  let observabilityService: ObservabilityService;
  let agent: Agent;

  beforeEach(() => {
    observabilityService = createMockObservabilityService();
    agent = createMockAgent();
  });

  it("getSpanContext returns null when no turn started", () => {
    const tracer = new AgentTracer({
      observabilityService,
      provider: DEFAULT_PROVIDER,
    });
    expect(tracer.getSpanContext()).toBeNull();
  });

  it("is a no-op when observabilityService is undefined", () => {
    const tracer = new AgentTracer({
      provider: DEFAULT_PROVIDER,
    });

    expect(() => tracer.startTurn("hello")).not.toThrow();
    expect(() => tracer.endTurn("done")).not.toThrow();
    const unsubscribe = tracer.subscribeToAgent(agent);
    expect(agent.subscribe).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
    expect(tracer.getSpanContext()).toBeNull();
  });

  it("subscribeToAgent is a no-op when observabilityService is undefined", () => {
    const tracer = new AgentTracer({
      provider: DEFAULT_PROVIDER,
    });
    const unsubscribe = tracer.subscribeToAgent(agent);
    expect(agent.subscribe).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });

  it("startTurn creates a turn span and stores context", async () => {
    const turnSpan = createMockSpan({ traceId: "trace-turn", spanId: "span-turn" });
    observabilityService.startObservation = vi.fn().mockResolvedValue(turnSpan);

    const tracer = new AgentTracer({
      observabilityService,
      provider: DEFAULT_PROVIDER,
    });

    await tracer.startTurn("hello");

    expect(observabilityService.startObservation).toHaveBeenCalledWith("agent-turn", {
      asType: "agent",
      input: "hello",
      parentSpanContext: undefined,
      sessionId: undefined,
      metadata: undefined,
    });
    expect(tracer.getSpanContext()).toEqual({ traceId: "trace-turn", spanId: "span-turn" });
  });

  it("startTurn with parentSpanContext passes it through", async () => {
    const turnSpan = createMockSpan({ traceId: "trace-turn", spanId: "span-turn" });
    observabilityService.startObservation = vi.fn().mockResolvedValue(turnSpan);

    const tracer = new AgentTracer({
      observabilityService,
      provider: DEFAULT_PROVIDER,
      parentSpanContext: { traceId: "parent-trace", spanId: "parent-span" },
    });

    await tracer.startTurn("hello");

    expect(observabilityService.startObservation).toHaveBeenCalledWith(
      "agent-turn",
      expect.objectContaining({
        parentSpanContext: { traceId: "parent-trace", spanId: "parent-span" },
      }),
    );
  });

  it("endTurn ends the turn span", async () => {
    const turnSpan = createMockSpan({ traceId: "trace-turn", spanId: "span-turn" });
    observabilityService.startObservation = vi.fn().mockResolvedValue(turnSpan);

    const tracer = new AgentTracer({
      observabilityService,
      provider: DEFAULT_PROVIDER,
    });

    await tracer.startTurn("hello");
    await tracer.endTurn("done");

    expect(turnSpan.update).toHaveBeenCalledWith({ output: "done" });
    expect(turnSpan.end).toHaveBeenCalled();
    expect(tracer.getSpanContext()).toBeNull();
  });

  it("subscribeToAgent creates generation span on message_start", async () => {
    const turnSpan = createMockSpan({ traceId: "trace-turn", spanId: "span-turn" });
    const genSpan = createMockSpan({ traceId: "trace-gen", spanId: "span-gen" });
    observabilityService.startObservation = vi.fn().mockImplementation((name) => {
      if (name === "agent-turn") return Promise.resolve(turnSpan);
      if (name === "llm-generation") return Promise.resolve(genSpan);
      return Promise.resolve(null);
    });

    const tracer = new AgentTracer({
      observabilityService,
      provider: DEFAULT_PROVIDER,
    });

    await tracer.startTurn("hello");

    const subscriber = captureSubscribe(agent);
    tracer.subscribeToAgent(agent);

    await subscriber({
      type: "message_start",
      message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
    } as unknown as AgentEvent);

    expect(observabilityService.startObservation).toHaveBeenCalledWith(
      "llm-generation",
      expect.objectContaining({
        asType: "generation",
        parentSpanContext: { traceId: "trace-turn", spanId: "span-turn" },
      }),
    );
  });

  it("subscribeToAgent creates tool span on tool_execution_start", async () => {
    const turnSpan = createMockSpan({ traceId: "trace-turn", spanId: "span-turn" });
    const toolSpan = createMockSpan({ traceId: "trace-tool", spanId: "span-tool" });
    observabilityService.startObservation = vi.fn().mockImplementation((name) => {
      if (name === "agent-turn") return Promise.resolve(turnSpan);
      if (name === "tool:read_file") return Promise.resolve(toolSpan);
      return Promise.resolve(null);
    });

    const tracer = new AgentTracer({
      observabilityService,
      provider: DEFAULT_PROVIDER,
    });

    await tracer.startTurn("hello");

    const subscriber = captureSubscribe(agent);
    tracer.subscribeToAgent(agent);

    await subscriber({
      type: "tool_execution_start",
      toolCallId: "tc-1",
      toolName: "read_file",
      args: { path: "/tmp/test.txt" },
    } as AgentEvent);

    expect(observabilityService.startObservation).toHaveBeenCalledWith(
      "tool:read_file",
      expect.objectContaining({
        asType: "tool",
        input: { path: "/tmp/test.txt" },
        parentSpanContext: { traceId: "trace-turn", spanId: "span-turn" },
      }),
    );
  });

  it("endTurn cleans up any lingering generation or tool spans", async () => {
    const turnSpan = createMockSpan({ traceId: "trace-turn", spanId: "span-turn" });
    const genSpan = createMockSpan({ traceId: "trace-gen", spanId: "span-gen" });
    const toolSpan = createMockSpan({ traceId: "trace-tool", spanId: "span-tool" });

    observabilityService.startObservation = vi.fn().mockImplementation((name) => {
      if (name === "agent-turn") return Promise.resolve(turnSpan);
      if (name === "llm-generation") return Promise.resolve(genSpan);
      if (name === "tool:read_file") return Promise.resolve(toolSpan);
      return Promise.resolve(null);
    });

    const tracer = new AgentTracer({
      observabilityService,
      provider: DEFAULT_PROVIDER,
    });

    await tracer.startTurn("hello");

    const subscriber = captureSubscribe(agent);
    tracer.subscribeToAgent(agent);

    await subscriber({
      type: "message_start",
      message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
    } as unknown as AgentEvent);
    await subscriber({
      type: "tool_execution_start",
      toolCallId: "tc-1",
      toolName: "read_file",
      args: { path: "/tmp/test.txt" },
    } as AgentEvent);

    // End turn without message_end / tool_execution_end
    await tracer.endTurn();

    expect(genSpan.end).toHaveBeenCalled();
    expect(toolSpan.end).toHaveBeenCalled();
    expect(turnSpan.end).toHaveBeenCalled();
  });

  it("handles generation span message_end with usage and cost", async () => {
    const turnSpan = createMockSpan({ traceId: "trace-turn", spanId: "span-turn" });
    const genSpan = createMockSpan({ traceId: "trace-gen", spanId: "span-gen" });
    observabilityService.startObservation = vi.fn().mockImplementation((name) => {
      if (name === "agent-turn") return Promise.resolve(turnSpan);
      if (name === "llm-generation") return Promise.resolve(genSpan);
      return Promise.resolve(null);
    });

    const tracer = new AgentTracer({
      observabilityService,
      provider: DEFAULT_PROVIDER,
    });

    await tracer.startTurn("hello");

    const subscriber = captureSubscribe(agent);
    tracer.subscribeToAgent(agent);

    await subscriber({
      type: "message_start",
      message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
    } as unknown as AgentEvent);

    await subscriber({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        usage: {
          input: 10,
          output: 20,
          totalTokens: 30,
          cacheRead: 5,
          cacheWrite: 2,
          cost: {
            input: 0.01,
            output: 0.02,
            total: 0.03,
            cacheRead: 0.005,
            cacheWrite: 0.002,
          },
        },
      },
    } as unknown as AgentEvent);

    expect(genSpan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        output: [{ type: "text", text: "done" }],
        metadata: expect.objectContaining({
          model: "gpt-4",
          provider: "openrouter",
          usageDetails: {
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
            cacheReadTokens: 5,
            cacheWriteTokens: 2,
          },
          costDetails: {
            input: 0.01,
            output: 0.02,
            total: 0.03,
            cacheRead: 0.005,
            cacheWrite: 0.002,
          },
        }),
      }),
    );
    expect(genSpan.end).toHaveBeenCalled();
  });

  it("handles tool span tool_execution_end with error", async () => {
    const turnSpan = createMockSpan({ traceId: "trace-turn", spanId: "span-turn" });
    const toolSpan = createMockSpan({ traceId: "trace-tool", spanId: "span-tool" });
    observabilityService.startObservation = vi.fn().mockImplementation((name) => {
      if (name === "agent-turn") return Promise.resolve(turnSpan);
      if (name === "tool:read_file") return Promise.resolve(toolSpan);
      return Promise.resolve(null);
    });

    const tracer = new AgentTracer({
      observabilityService,
      provider: DEFAULT_PROVIDER,
    });

    await tracer.startTurn("hello");

    const subscriber = captureSubscribe(agent);
    tracer.subscribeToAgent(agent);

    await subscriber({
      type: "tool_execution_start",
      toolCallId: "tc-1",
      toolName: "read_file",
      args: { path: "/tmp/test.txt" },
    } as AgentEvent);

    await subscriber({
      type: "tool_execution_end",
      toolCallId: "tc-1",
      toolName: "read_file",
      result: "file not found",
      isError: true,
    } as AgentEvent);

    expect(toolSpan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        output: "file not found",
        metadata: { isError: true },
        level: "ERROR",
        statusMessage: "file not found",
      }),
    );
    expect(toolSpan.end).toHaveBeenCalled();
  });

  it("prevents span leaks on overlapping startTurn calls", async () => {
    const turnSpan1 = createMockSpan({ traceId: "trace-1", spanId: "span-1" });
    const turnSpan2 = createMockSpan({ traceId: "trace-2", spanId: "span-2" });
    observabilityService.startObservation = vi
      .fn()
      .mockResolvedValueOnce(turnSpan1)
      .mockResolvedValueOnce(turnSpan2);

    const tracer = new AgentTracer({
      observabilityService,
      provider: DEFAULT_PROVIDER,
    });

    await tracer.startTurn("first");
    await tracer.startTurn("second");

    expect(turnSpan1.end).toHaveBeenCalled();
    expect(tracer.getSpanContext()).toEqual({ traceId: "trace-2", spanId: "span-2" });
  });
});
