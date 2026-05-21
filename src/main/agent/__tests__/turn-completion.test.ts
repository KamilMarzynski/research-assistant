import { describe, expect, it, vi } from "vitest";
import { handleTurnCompletion } from "../handlers/turn-completion";
import type { HandlerContext } from "../handlers/types";

function makeCtx(
  overrides: Partial<HandlerContext["state"]> & Partial<Pick<HandlerContext, "projectId">> = {},
): HandlerContext {
  const state = {
    assistantContent: "",
    lastUserContent: "",
    currentTurnId: 1,
    savedForTurn: 0,
    processing: false,
    pendingFollowUp: null,
    pendingSkillDeltas: [],
    pendingToolDescriptions: new Map<string, string>(),
    pendingToolCalls: [],
    skillRouterReady: false,
    sessionId: "sid-1",
    streamingMessageId: null,
    streamChunkCount: 0,
    ...overrides,
  };
  return {
    projectId: "p1",
    eventBus: { emit: vi.fn() } as unknown as HandlerContext["eventBus"],
    messageService: {
      addMessage: vi.fn().mockResolvedValue({ id: "msg-2" }),
      updateMessage: vi.fn().mockResolvedValue(undefined),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      getHistory: vi.fn().mockResolvedValue([]),
      getRecentContext: vi.fn().mockResolvedValue([]),
    } as unknown as HandlerContext["messageService"],
    memoryManager: {
      buildContext: vi.fn().mockResolvedValue({ summary: "", recentMessages: [] }),
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as HandlerContext["memoryManager"],
    state,
  };
}

describe("handleTurnCompletion", () => {
  it("ignores non-agent_end events", async () => {
    const ctx = makeCtx();
    await handleTurnCompletion({ type: "message_update" } as any, ctx);
    expect(ctx.memoryManager.save).not.toHaveBeenCalled();
  });

  it("updates streaming message with tool calls when present", async () => {
    const ctx = makeCtx({
      assistantContent: "answer",
      lastUserContent: "question",
      streamingMessageId: "msg-1",
      pendingToolCalls: [
        { toolCallId: "tc-1", toolName: "read_file", description: "Read file", status: "done" },
      ],
    });
    await handleTurnCompletion({ type: "agent_end" } as any, ctx);
    expect(ctx.messageService.updateMessage).toHaveBeenCalledWith(
      "msg-1",
      "answer",
      expect.arrayContaining([expect.objectContaining({ toolCallId: "tc-1" })]),
    );
  });

  it("adds new assistant message when no streamingMessageId", async () => {
    const ctx = makeCtx({
      assistantContent: "answer",
      lastUserContent: "question",
      streamingMessageId: null,
    });
    await handleTurnCompletion({ type: "agent_end" } as any, ctx);
    expect(ctx.messageService.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        role: "assistant",
        content: "answer",
      }),
    );
  });

  it("adds assistant message with toolCalls when streamingMessageId absent", async () => {
    const ctx = makeCtx({
      assistantContent: "answer",
      lastUserContent: "question",
      streamingMessageId: null,
      pendingToolCalls: [
        { toolCallId: "tc-1", toolName: "read_file", description: "Read file", status: "done" },
      ],
    });
    await handleTurnCompletion({ type: "agent_end" } as any, ctx);
    expect(ctx.messageService.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCalls: expect.arrayContaining([expect.objectContaining({ toolCallId: "tc-1" })]),
      }),
    );
  });

  it("clears pendingToolCalls even when content is empty", async () => {
    const ctx = makeCtx({
      pendingToolCalls: [
        { toolCallId: "tc-1", toolName: "read_file", description: "Read file", status: "done" },
      ],
    });
    await handleTurnCompletion({ type: "agent_end" } as any, ctx);
    expect(ctx.state.pendingToolCalls).toEqual([]);
    expect(ctx.messageService.updateMessage).not.toHaveBeenCalled();
  });

  it("does not save twice for the same turn", async () => {
    const ctx = makeCtx({
      assistantContent: "answer",
      lastUserContent: "question",
      savedForTurn: 1,
      currentTurnId: 1,
    });
    await handleTurnCompletion({ type: "agent_end" } as any, ctx);
    expect(ctx.memoryManager.save).not.toHaveBeenCalled();
  });
});
