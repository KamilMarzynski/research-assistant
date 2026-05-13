import type { Agent, AgentEvent } from "@mariozechner/pi-agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ObservabilityService, ObservationSpan } from "../services/ObservabilityService";
import { AgentTracer } from "./AgentTracer";

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
      provider: { type: "openrouter", apiKey: "key", model: "gpt-4" },
    });
    expect(tracer.getSpanContext()).toBeNull();
  });

  it("is a no-op when observabilityService is undefined", () => {
    const tracer = new AgentTracer({
      provider: { type: "openrouter", apiKey: "key", model: "gpt-4" },
    });

    // startTurn should not throw
    expect(() => tracer.startTurn("hello")).not.toThrow();

    // endTurn should not throw
    expect(() => tracer.endTurn("done")).not.toThrow();

    // subscribeToAgent should not register a listener
    const unsubscribe = tracer.subscribeToAgent(agent);
    expect(agent.subscribe).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();

    expect(tracer.getSpanContext()).toBeNull();
  });

  it("startTurn creates a turn span and stores context", async () => {
    const turnSpan = createMockSpan({ traceId: "trace-turn", spanId: "span-turn" });
    observabilityService.startObservation = vi.fn().mockResolvedValue(turnSpan);

    const tracer = new AgentTracer({
      observabilityService,
      provider: { type: "openrouter", apiKey: "key", model: "gpt-4" },
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
      provider: { type: "openrouter", apiKey: "key", model: "gpt-4" },
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
      provider: { type: "openrouter", apiKey: "key", model: "gpt-4" },
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
      provider: { type: "openrouter", apiKey: "key", model: "gpt-4" },
    });

    await tracer.startTurn("hello");

    let capturedSubscriber: ((event: AgentEvent) => Promise<void>) | null = null;
    agent.subscribe = vi.fn((cb: (event: AgentEvent) => Promise<void>) => {
      capturedSubscriber = cb;
      return () => {};
    });

    tracer.subscribeToAgent(agent);

    const subscriber = capturedSubscriber as unknown as (event: AgentEvent) => Promise<void>;

    const messageStartEvent = {
      type: "message_start",
      message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
    } as unknown as AgentEvent;
    await subscriber(messageStartEvent);

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
      provider: { type: "openrouter", apiKey: "key", model: "gpt-4" },
    });

    await tracer.startTurn("hello");

    let capturedSubscriber: ((event: AgentEvent) => Promise<void>) | null = null;
    agent.subscribe = vi.fn((cb: (event: AgentEvent) => Promise<void>) => {
      capturedSubscriber = cb;
      return () => {};
    });

    tracer.subscribeToAgent(agent);

    const toolStartEvent: AgentEvent = {
      type: "tool_execution_start",
      toolCallId: "tc-1",
      toolName: "read_file",
      args: { path: "/tmp/test.txt" },
    };
    const subscriber = capturedSubscriber as unknown as (event: AgentEvent) => Promise<void>;
    await subscriber(toolStartEvent);

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
      provider: { type: "openrouter", apiKey: "key", model: "gpt-4" },
    });

    await tracer.startTurn("hello");

    let capturedSubscriber: ((event: AgentEvent) => Promise<void>) | null = null;
    agent.subscribe = vi.fn((cb: (event: AgentEvent) => Promise<void>) => {
      capturedSubscriber = cb;
      return () => {};
    });

    tracer.subscribeToAgent(agent);

    const subscriber = capturedSubscriber as unknown as (event: AgentEvent) => Promise<void>;
    await subscriber({
      type: "message_start",
      message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
    } as unknown as AgentEvent);
    await subscriber({
      type: "tool_execution_start",
      toolCallId: "tc-1",
      toolName: "read_file",
      args: { path: "/tmp/test.txt" },
    });

    // End turn without message_end / tool_execution_end
    await tracer.endTurn();

    expect(genSpan.end).toHaveBeenCalled();
    expect(toolSpan.end).toHaveBeenCalled();
    expect(turnSpan.end).toHaveBeenCalled();
  });
});
