import { describe, expect, it } from "vitest";
import {
  initialStreamState,
  type StreamAction,
  type StreamState,
  streamReducer,
} from "../StreamStateContext";

function stateWithProject(
  projectId: string,
  partial: Partial<{
    processing: boolean;
    segments: StreamState["states"][string]["streamingSegments"];
  }> = {},
): StreamState {
  return {
    states: {
      [projectId]: {
        processing: partial.processing ?? false,
        streamingSegments: partial.segments ?? [],
      },
    },
  };
}

describe("streamReducer", () => {
  // ─── START_STREAM ─────────────────────────────────────────────────────────

  it("START_STREAM creates project entry with processing=true", () => {
    const next = streamReducer(initialStreamState, { type: "START_STREAM", projectId: "p1" });
    expect(next.states["p1"]).toEqual({ streamingSegments: [], processing: true });
  });

  it("START_STREAM preserves existing segments", () => {
    const base = stateWithProject("p1", {
      segments: [{ type: "text", content: "hi" }],
      processing: false,
    });
    const next = streamReducer(base, { type: "START_STREAM", projectId: "p1" });
    expect(next.states["p1"].streamingSegments).toEqual([{ type: "text", content: "hi" }]);
    expect(next.states["p1"].processing).toBe(true);
  });

  it("START_STREAM does not mutate other projects", () => {
    const base = stateWithProject("p2", { processing: false });
    const next = streamReducer(base, { type: "START_STREAM", projectId: "p1" });
    expect(next.states["p2"]).toEqual(base.states["p2"]);
  });

  // ─── END_STREAM ───────────────────────────────────────────────────────────

  it("END_STREAM clears segments and sets processing=false", () => {
    const base = stateWithProject("p1", {
      segments: [{ type: "text", content: "hi" }],
      processing: true,
    });
    const next = streamReducer(base, { type: "END_STREAM", projectId: "p1" });
    expect(next.states["p1"]).toEqual({ streamingSegments: [], processing: false });
  });

  it("END_STREAM returns same state when project does not exist", () => {
    const next = streamReducer(initialStreamState, { type: "END_STREAM", projectId: "p1" });
    expect(next).toBe(initialStreamState);
  });

  // ─── APPEND_CHUNK ─────────────────────────────────────────────────────────

  it("APPEND_CHUNK creates text segment when none exists", () => {
    const next = streamReducer(initialStreamState, {
      type: "APPEND_CHUNK",
      projectId: "p1",
      delta: "Hello",
    });
    expect(next.states["p1"].streamingSegments).toEqual([{ type: "text", content: "Hello" }]);
    expect(next.states["p1"].processing).toBe(true);
  });

  it("APPEND_CHUNK appends to existing text segment", () => {
    const base = stateWithProject("p1", {
      segments: [{ type: "text", content: "Hello" }],
      processing: true,
    });
    const next = streamReducer(base, { type: "APPEND_CHUNK", projectId: "p1", delta: " world" });
    expect(next.states["p1"].streamingSegments).toEqual([{ type: "text", content: "Hello world" }]);
  });

  it("APPEND_CHUNK starts new text segment after activity segment", () => {
    const base = stateWithProject("p1", {
      segments: [
        {
          type: "activity",
          toolCallId: "tc-1",
          toolName: "search",
          description: "searching",
          status: "running",
        },
      ],
      processing: true,
    });
    const next = streamReducer(base, { type: "APPEND_CHUNK", projectId: "p1", delta: "result" });
    expect(next.states["p1"].streamingSegments).toHaveLength(2);
    expect(next.states["p1"].streamingSegments[1]).toEqual({ type: "text", content: "result" });
  });

  // ─── TOOL_CALL_START ──────────────────────────────────────────────────────

  it("TOOL_CALL_START pushes activity segment with status running", () => {
    const action: StreamAction = {
      type: "TOOL_CALL_START",
      projectId: "p1",
      toolCallId: "tc-1",
      toolName: "web_search",
      description: "Searching",
    };
    const next = streamReducer(initialStreamState, action);
    expect(next.states["p1"].streamingSegments).toEqual([
      {
        type: "activity",
        toolCallId: "tc-1",
        toolName: "web_search",
        description: "Searching",
        status: "running",
      },
    ]);
  });

  it("TOOL_CALL_START preserves existing processing flag", () => {
    const base = stateWithProject("p1", { processing: false });
    const next = streamReducer(base, {
      type: "TOOL_CALL_START",
      projectId: "p1",
      toolCallId: "tc-1",
      toolName: "tool",
      description: "desc",
    });
    expect(next.states["p1"].processing).toBe(false);
  });

  // ─── TOOL_CALL_END ────────────────────────────────────────────────────────

  it("TOOL_CALL_END marks matching activity segment as done", () => {
    const base = stateWithProject("p1", {
      segments: [
        {
          type: "activity",
          toolCallId: "tc-1",
          toolName: "tool",
          description: "desc",
          status: "running",
        },
      ],
      processing: true,
    });
    const next = streamReducer(base, {
      type: "TOOL_CALL_END",
      projectId: "p1",
      toolCallId: "tc-1",
      isError: false,
    });
    expect(next.states["p1"].streamingSegments[0]).toMatchObject({
      type: "activity",
      toolCallId: "tc-1",
      status: "done",
    });
  });

  it("TOOL_CALL_END marks matching activity segment as error when isError=true", () => {
    const base = stateWithProject("p1", {
      segments: [
        {
          type: "activity",
          toolCallId: "tc-1",
          toolName: "tool",
          description: "desc",
          status: "running",
        },
      ],
      processing: true,
    });
    const next = streamReducer(base, {
      type: "TOOL_CALL_END",
      projectId: "p1",
      toolCallId: "tc-1",
      isError: true,
    });
    expect(next.states["p1"].streamingSegments[0]).toMatchObject({ status: "error" });
  });

  it("TOOL_CALL_END does not mutate unrelated segments", () => {
    const base = stateWithProject("p1", {
      segments: [
        {
          type: "activity",
          toolCallId: "tc-1",
          toolName: "tool",
          description: "desc",
          status: "running",
        },
        { type: "text", content: "hello" },
        {
          type: "activity",
          toolCallId: "tc-2",
          toolName: "tool2",
          description: "desc2",
          status: "running",
        },
      ],
      processing: true,
    });
    const next = streamReducer(base, {
      type: "TOOL_CALL_END",
      projectId: "p1",
      toolCallId: "tc-1",
      isError: false,
    });
    expect(next.states["p1"].streamingSegments[1]).toEqual({ type: "text", content: "hello" });
    expect(next.states["p1"].streamingSegments[2]).toMatchObject({ status: "running" });
  });

  it("TOOL_CALL_END returns same state when project does not exist", () => {
    const next = streamReducer(initialStreamState, {
      type: "TOOL_CALL_END",
      projectId: "p1",
      toolCallId: "tc-1",
      isError: false,
    });
    expect(next).toBe(initialStreamState);
  });

  // ─── Immutability ─────────────────────────────────────────────────────────

  it("reducer never mutates the input state", () => {
    const base = stateWithProject("p1", {
      segments: [{ type: "text", content: "existing" }],
      processing: true,
    });
    const segmentsBefore = base.states["p1"].streamingSegments;
    streamReducer(base, { type: "APPEND_CHUNK", projectId: "p1", delta: " more" });
    // original array should be untouched
    expect(segmentsBefore).toHaveLength(1);
    expect(segmentsBefore[0]).toEqual({ type: "text", content: "existing" });
  });
});
