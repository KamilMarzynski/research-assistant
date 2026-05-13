import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { handleStreamChunk } from "./stream-chunk";
import type { HandlerContext } from "./types";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectId: "proj-1",
    eventBus: { emit: vi.fn(), on: vi.fn() } as unknown as HandlerContext["eventBus"],
    messageService: { updateMessage: vi.fn() } as unknown as HandlerContext["messageService"],
    memoryManager: {} as HandlerContext["memoryManager"],
    state: {
      assistantContent: "",
      lastUserContent: "",
      currentTurnId: 0,
      savedForTurn: 0,
      processing: false,
      pendingFollowUp: null,
      pendingSkillDeltas: [],
      skillRouterReady: false,
      activeTurnSpan: null,
      activeGenerationSpan: null,
      activeToolSpan: null,
      sessionId: "sess-1",
      turnTraceId: null,
      turnSpanId: null,
      streamingMessageId: null,
      streamChunkCount: 0,
      pendingToolDescriptions: new Map(),
    },
    ...overrides,
  };
}

describe("handleStreamChunk — tool events", () => {
  it("emits agent:tool_start with stashed description on tool_execution_start", async () => {
    const ctx = makeCtx();
    ctx.state.pendingToolDescriptions.set("tc-1", "Searching for papers");
    await handleStreamChunk(
      { type: "tool_execution_start", toolCallId: "tc-1", toolName: "web_search", args: {} },
      ctx,
    );
    expect(ctx.eventBus.emit).toHaveBeenCalledWith({
      type: "agent:tool_start",
      payload: {
        projectId: "proj-1",
        toolCallId: "tc-1",
        toolName: "web_search",
        description: "Searching for papers",
      },
    });
  });

  it("removes entry from pendingToolDescriptions after tool_execution_start", async () => {
    const ctx = makeCtx();
    ctx.state.pendingToolDescriptions.set("tc-2", "Some description");
    await handleStreamChunk(
      { type: "tool_execution_start", toolCallId: "tc-2", toolName: "read_file", args: {} },
      ctx,
    );
    expect(ctx.state.pendingToolDescriptions.has("tc-2")).toBe(false);
  });

  it("falls back to toolName when no stashed description", async () => {
    const ctx = makeCtx();
    await handleStreamChunk(
      { type: "tool_execution_start", toolCallId: "tc-3", toolName: "write_file", args: {} },
      ctx,
    );
    expect(ctx.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent:tool_start",
        payload: expect.objectContaining({ description: "write_file" }),
      }),
    );
  });

  it("emits agent:tool_end on tool_execution_end", async () => {
    const ctx = makeCtx();
    await handleStreamChunk(
      {
        type: "tool_execution_end",
        toolCallId: "tc-4",
        toolName: "start_research",
        result: {},
        isError: false,
      },
      ctx,
    );
    expect(ctx.eventBus.emit).toHaveBeenCalledWith({
      type: "agent:tool_end",
      payload: {
        projectId: "proj-1",
        toolCallId: "tc-4",
        toolName: "start_research",
        isError: false,
      },
    });
  });

  it("emits agent:tool_end with isError:true on error", async () => {
    const ctx = makeCtx();
    await handleStreamChunk(
      {
        type: "tool_execution_end",
        toolCallId: "tc-5",
        toolName: "safe_bash",
        result: "error",
        isError: true,
      },
      ctx,
    );
    expect(ctx.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ isError: true }),
      }),
    );
  });

  it("still handles text_delta normally alongside tool events", async () => {
    const ctx = makeCtx();
    await handleStreamChunk(
      {
        type: "message_update",
        message: { content: [] },
        assistantMessageEvent: {
          type: "text_delta",
          delta: "Hello",
          contentIndex: 0,
          partial: { content: [] },
        },
      } as any,
      ctx,
    );
    expect(ctx.state.assistantContent).toBe("Hello");
    expect(ctx.eventBus.emit).toHaveBeenCalledWith({
      type: "agent:chunk",
      payload: { projectId: "proj-1", delta: "Hello" },
    });
  });
});
