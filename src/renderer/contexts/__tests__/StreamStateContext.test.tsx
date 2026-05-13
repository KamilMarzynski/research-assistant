// @vitest-environment happy-dom

import { act, render, screen } from "@testing-library/react";
import { useContext } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC } from "../../../shared/ipc-channels";
import type { StreamSegment } from "../StreamStateContext";
import { StreamStateContext, StreamStateProvider } from "../StreamStateContext";

type ListenerMap = Record<string, ((data: unknown) => void)[]>;

function setupElectronMock() {
  const listeners: ListenerMap = {};
  window.electronAPI = {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn((channel: string, cb: (data: unknown) => void) => {
      listeners[channel] = listeners[channel] ?? [];
      listeners[channel].push(cb);
      return () => {
        listeners[channel] = listeners[channel].filter((l) => l !== cb);
      };
    }),
  } as unknown as Window["electronAPI"];
  return listeners;
}

function emit(listeners: ListenerMap, channel: string, data: unknown) {
  for (const cb of listeners[channel] ?? []) cb(data);
}

function TestConsumer() {
  const { states } = useContext(StreamStateContext);
  const proj = states["p1"];
  if (!proj) return <div>no state</div>;
  return (
    <div>
      <div data-testid="processing">{String(proj.processing)}</div>
      <div data-testid="segments">{JSON.stringify(proj.streamingSegments)}</div>
    </div>
  );
}

describe("StreamStateContext — segments", () => {
  let listeners: ListenerMap;

  beforeEach(() => {
    listeners = setupElectronMock();
    render(
      <StreamStateProvider>
        <TestConsumer />
      </StreamStateProvider>,
    );
  });

  it("appends text segment on MESSAGE_CHUNK", () => {
    act(() => emit(listeners, IPC.MESSAGE_CHUNK, { projectId: "p1", delta: "Hello" }));
    const segments: StreamSegment[] = JSON.parse(
      screen.getByTestId("segments").textContent ?? "[]",
    );
    expect(segments).toEqual([{ type: "text", content: "Hello" }]);
  });

  it("appends to existing text segment on subsequent chunks", () => {
    act(() => emit(listeners, IPC.MESSAGE_CHUNK, { projectId: "p1", delta: "Hello" }));
    act(() => emit(listeners, IPC.MESSAGE_CHUNK, { projectId: "p1", delta: " world" }));
    const segments: StreamSegment[] = JSON.parse(
      screen.getByTestId("segments").textContent ?? "[]",
    );
    expect(segments).toEqual([{ type: "text", content: "Hello world" }]);
  });

  it("starts new text segment after activity segment", () => {
    act(() =>
      emit(listeners, IPC.TOOL_START, {
        projectId: "p1",
        toolCallId: "tc-1",
        toolName: "web_search",
        description: "Searching",
      }),
    );
    act(() => emit(listeners, IPC.MESSAGE_CHUNK, { projectId: "p1", delta: "Result:" }));
    const segments: StreamSegment[] = JSON.parse(
      screen.getByTestId("segments").textContent ?? "[]",
    );
    expect(segments).toHaveLength(2);
    expect(segments[0].type).toBe("activity");
    expect(segments[1]).toEqual({ type: "text", content: "Result:" });
  });

  it("pushes activity segment on TOOL_START", () => {
    act(() =>
      emit(listeners, IPC.TOOL_START, {
        projectId: "p1",
        toolCallId: "tc-1",
        toolName: "web_search",
        description: "Searching for X",
      }),
    );
    const segments: StreamSegment[] = JSON.parse(
      screen.getByTestId("segments").textContent ?? "[]",
    );
    expect(segments).toEqual([
      {
        type: "activity",
        toolCallId: "tc-1",
        toolName: "web_search",
        description: "Searching for X",
        status: "running",
      },
    ]);
  });

  it("updates activity segment to done on TOOL_END", () => {
    act(() =>
      emit(listeners, IPC.TOOL_START, {
        projectId: "p1",
        toolCallId: "tc-2",
        toolName: "write_file",
        description: "Writing output",
      }),
    );
    act(() =>
      emit(listeners, IPC.TOOL_END, {
        projectId: "p1",
        toolCallId: "tc-2",
        toolName: "write_file",
        isError: false,
      }),
    );
    const segments: StreamSegment[] = JSON.parse(
      screen.getByTestId("segments").textContent ?? "[]",
    );
    expect(segments[0]).toMatchObject({ type: "activity", status: "done", toolCallId: "tc-2" });
  });

  it("updates activity segment to error on TOOL_END with isError", () => {
    act(() =>
      emit(listeners, IPC.TOOL_START, {
        projectId: "p1",
        toolCallId: "tc-3",
        toolName: "safe_bash",
        description: "Running cmd",
      }),
    );
    act(() =>
      emit(listeners, IPC.TOOL_END, {
        projectId: "p1",
        toolCallId: "tc-3",
        toolName: "safe_bash",
        isError: true,
      }),
    );
    const segments: StreamSegment[] = JSON.parse(
      screen.getByTestId("segments").textContent ?? "[]",
    );
    expect(segments[0]).toMatchObject({ type: "activity", status: "error" });
  });

  it("clears segments on MESSAGE_DONE", () => {
    act(() => emit(listeners, IPC.MESSAGE_CHUNK, { projectId: "p1", delta: "Hi" }));
    act(() => emit(listeners, IPC.MESSAGE_DONE, { projectId: "p1" }));
    const segments: StreamSegment[] = JSON.parse(
      screen.getByTestId("segments").textContent ?? "[]",
    );
    expect(segments).toEqual([]);
  });
});
