import { describe, expect, it, vi } from "vitest";
import type { MessageSegment } from "../../../shared/types";
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
      pendingSkillDeltas: [],
      pendingToolCalls: [],
      skillRouterReady: false,
      sessionId: "sess-1",
      streamingMessageId: null,
      streamChunkCount: 0,
      pendingToolDescriptions: new Map(),
      segmentLog: [],
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

  it("pushes to pendingToolCalls on tool_execution_start", async () => {
    const ctx = makeCtx();
    ctx.state.pendingToolDescriptions.set("tc-1", "Searching for papers");
    await handleStreamChunk(
      { type: "tool_execution_start", toolCallId: "tc-1", toolName: "web_search", args: {} },
      ctx,
    );
    expect(ctx.state.pendingToolCalls).toHaveLength(1);
    expect(ctx.state.pendingToolCalls[0]).toEqual({
      toolCallId: "tc-1",
      toolName: "web_search",
      description: "Searching for papers",
      status: "running",
    });
  });

  it("updates pendingToolCalls to done on tool_execution_end", async () => {
    const ctx = makeCtx();
    ctx.state.pendingToolCalls.push({
      toolCallId: "tc-4",
      toolName: "start_research",
      description: "Searching",
      status: "running",
    });
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
    expect(ctx.state.pendingToolCalls[0]).toMatchObject({ toolCallId: "tc-4", status: "done" });
  });

  it("updates pendingToolCalls to error on tool_execution_end with isError=true", async () => {
    const ctx = makeCtx();
    ctx.state.pendingToolCalls.push({
      toolCallId: "tc-5",
      toolName: "safe_bash",
      description: "Running cmd",
      status: "running",
    });
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
    expect(ctx.state.pendingToolCalls[0]).toMatchObject({ toolCallId: "tc-5", status: "error" });
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

describe("handleStreamChunk — segmentLog", () => {
  it("starts a new text segment on first text_delta", async () => {
    const ctx = makeCtx();
    await handleStreamChunk(
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello" },
      } as never,
      ctx,
    );
    expect(ctx.state.segmentLog).toEqual([
      { type: "text", content: "Hello" },
    ] satisfies MessageSegment[]);
  });

  it("appends to last text segment on subsequent text_delta", async () => {
    const ctx = makeCtx();
    await handleStreamChunk(
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hi " },
      } as never,
      ctx,
    );
    await handleStreamChunk(
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "there" },
      } as never,
      ctx,
    );
    expect(ctx.state.segmentLog).toEqual([{ type: "text", content: "Hi there" }]);
  });

  it("pushes activity segment on tool_execution_start", async () => {
    const ctx = makeCtx();
    ctx.state.pendingToolDescriptions.set("tc-1", "Reading file");
    await handleStreamChunk(
      {
        type: "tool_execution_start",
        toolCallId: "tc-1",
        toolName: "read_file",
        args: {},
      } as never,
      ctx,
    );
    expect(ctx.state.segmentLog).toEqual([
      {
        type: "activity",
        toolCallId: "tc-1",
        toolName: "read_file",
        description: "Reading file",
        status: "done",
      },
    ]);
  });

  it("starts a new text segment after a tool call (text-after-tool = new bubble)", async () => {
    const ctx = makeCtx();
    await handleStreamChunk(
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "before" },
      } as never,
      ctx,
    );
    await handleStreamChunk(
      {
        type: "tool_execution_start",
        toolCallId: "tc-1",
        toolName: "read_file",
        args: {},
      } as never,
      ctx,
    );
    await handleStreamChunk(
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "after" },
      } as never,
      ctx,
    );
    expect(ctx.state.segmentLog).toEqual([
      { type: "text", content: "before" },
      {
        type: "activity",
        toolCallId: "tc-1",
        toolName: "read_file",
        description: "read_file",
        status: "done",
      },
      { type: "text", content: "after" },
    ]);
  });

  it("marks activity segment as error on tool_execution_end with isError", async () => {
    const ctx = makeCtx();
    await handleStreamChunk(
      {
        type: "tool_execution_start",
        toolCallId: "tc-1",
        toolName: "read_file",
        args: {},
      } as never,
      ctx,
    );
    await handleStreamChunk(
      {
        type: "tool_execution_end",
        toolCallId: "tc-1",
        toolName: "read_file",
        isError: true,
        result: "",
      } as never,
      ctx,
    );
    expect(ctx.state.segmentLog[0]).toMatchObject({ type: "activity", status: "error" });
  });
});

describe("handleStreamChunk — tool_execution_update", () => {
  it("emits agent:tool_update on tool_execution_update", async () => {
    const ctx = makeCtx();
    await handleStreamChunk(
      {
        type: "tool_execution_update",
        toolCallId: "tc-1",
        toolName: "execute_code",
        args: {},
        partialResult: { stdout: "partial output" },
      } as never,
      ctx,
    );
    expect(ctx.eventBus.emit).toHaveBeenCalledWith({
      type: "agent:tool_update",
      payload: {
        projectId: "proj-1",
        toolCallId: "tc-1",
        toolName: "execute_code",
        partialResult: { stdout: "partial output" },
      },
    });
  });

  it("emits multiple tool_update events for streaming progress", async () => {
    const ctx = makeCtx();
    await handleStreamChunk(
      {
        type: "tool_execution_update",
        toolCallId: "tc-1",
        toolName: "safe_bash",
        args: {},
        partialResult: { stdout: "line1" },
      } as never,
      ctx,
    );
    await handleStreamChunk(
      {
        type: "tool_execution_update",
        toolCallId: "tc-1",
        toolName: "safe_bash",
        args: {},
        partialResult: { stdout: "line2" },
      } as never,
      ctx,
    );
    expect(ctx.eventBus.emit).toHaveBeenCalledTimes(2);
  });

  it("does not modify pendingToolCalls on tool_execution_update", async () => {
    const ctx = makeCtx();
    ctx.state.pendingToolCalls.push({
      toolCallId: "tc-1",
      toolName: "execute_code",
      description: "Running code",
      status: "running",
    });
    await handleStreamChunk(
      {
        type: "tool_execution_update",
        toolCallId: "tc-1",
        toolName: "execute_code",
        args: {},
        partialResult: { stdout: "progress" },
      } as never,
      ctx,
    );
    expect(ctx.state.pendingToolCalls[0].status).toBe("running");
  });
});
