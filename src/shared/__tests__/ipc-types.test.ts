import { describe, expect, it } from "vitest";
import type { AgentProgressEvent, IpcPushEvent, IpcResult } from "../ipc-types";

describe("IpcResult", () => {
  it("ok variant has data", () => {
    const r: IpcResult<string> = { ok: true, data: "hello" };
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBe("hello");
  });

  it("error variant has error and code", () => {
    const r: IpcResult<string> = { ok: false, error: "Not found", code: "NOT_FOUND" };
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("Not found");
      expect(r.code).toBe("NOT_FOUND");
    }
  });
});

describe("AgentProgressEvent", () => {
  it("research_started is a valid AgentProgressEvent", () => {
    const e: AgentProgressEvent = {
      kind: "research_started",
      taskId: "t1",
      projectId: "p1",
      query: "test",
    };
    expect(e.kind).toBe("research_started");
  });

  it("research_step includes projectId", () => {
    const e: AgentProgressEvent = {
      kind: "research_step",
      taskId: "t1",
      projectId: "p1",
      message: "step message",
    };
    expect(e.kind).toBe("research_step");
    if (e.kind === "research_step") expect(e.projectId).toBe("p1");
  });

  it("tool_call_start is a valid AgentProgressEvent", () => {
    const e: AgentProgressEvent = {
      kind: "tool_call_start",
      projectId: "p1",
      toolCallId: "tc1",
      toolName: "read_file",
      description: "Reading file",
    };
    expect(e.kind).toBe("tool_call_start");
  });

  it("tool_call_end is a valid AgentProgressEvent", () => {
    const e: AgentProgressEvent = {
      kind: "tool_call_end",
      projectId: "p1",
      toolCallId: "tc1",
      toolName: "read_file",
      isError: false,
    };
    expect(e.kind).toBe("tool_call_end");
  });
});

describe("IpcPushEvent", () => {
  it("AGENT_PROGRESS event is typed", () => {
    const e: IpcPushEvent = {
      type: "AGENT_PROGRESS",
      event: { kind: "research_started", taskId: "t1", projectId: "p1", query: "q" },
    };
    expect(e.type).toBe("AGENT_PROGRESS");
  });

  it("MESSAGE_CHUNK event is typed", () => {
    const e: IpcPushEvent = { type: "MESSAGE_CHUNK", projectId: "p1", delta: "hello" };
    expect(e.type).toBe("MESSAGE_CHUNK");
    if (e.type === "MESSAGE_CHUNK") expect(e.delta).toBe("hello");
  });
});
