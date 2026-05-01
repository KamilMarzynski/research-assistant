// @vitest-environment happy-dom

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockOn = vi.fn(() => vi.fn()); // returns unsubscribe fn
const mockInvoke = vi.fn();

type CallEntry = [string, (data: unknown) => void];

vi.stubGlobal("window", {
  electronAPI: {
    on: mockOn,
    invoke: mockInvoke,
  },
});

function getStatusListener(): (data: unknown) => void {
  const calls = mockOn.mock.calls as unknown as CallEntry[];
  const entry = calls.find((c) => c[0] === "RESEARCH_STATUS_UPDATE");
  if (!entry) throw new Error("RESEARCH_STATUS_UPDATE listener not registered");
  return entry[1];
}

describe("ResearchStatusBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when idle (no active, no done, no error)", async () => {
    const ResearchStatusBar = (await import("../ResearchStatusBar")).default;
    const { container } = render(<ResearchStatusBar />);
    expect(container.textContent).toBe("");
  });

  it("shows retry button on research:failed event", async () => {
    const ResearchStatusBar = (await import("../ResearchStatusBar")).default;
    render(<ResearchStatusBar />);

    // After render, the useEffect registers listeners
    expect(mockOn.mock.calls.length).toBeGreaterThan(0);
    const listener = getStatusListener();

    await act(async () => {
      listener({
        status: "failed",
        taskId: "t1",
        projectId: "p1",
        query: "test query",
        error: "API error",
      });
    });

    expect(screen.getByTestId("retry-research-btn")).toBeDefined();
  });

  it("shows label prefix in progress messages", async () => {
    const ResearchStatusBar = (await import("../ResearchStatusBar")).default;
    render(<ResearchStatusBar />);

    expect(mockOn.mock.calls.length).toBeGreaterThan(0);
    const listener = getStatusListener();

    await act(async () => {
      listener({
        status: "progress",
        message: "Analyzing results...",
        label: "[researcher-1]",
      });
    });
  });

  it("dismisses error after 30s timeout", async () => {
    vi.useFakeTimers();

    const ResearchStatusBar = (await import("../ResearchStatusBar")).default;
    render(<ResearchStatusBar />);

    expect(mockOn.mock.calls.length).toBeGreaterThan(0);
    const listener = getStatusListener();

    await act(async () => {
      listener({
        status: "failed",
        taskId: "t1",
        projectId: "p1",
        query: "test query",
        error: "API error",
      });
    });

    // After the error, the retry button should be visible
    expect(screen.getByTestId("retry-research-btn")).toBeDefined();

    // Advance time past the dismiss timeout
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    // After timeout, the retry button should be gone
    expect(screen.queryByTestId("retry-research-btn")).toBeNull();

    vi.useRealTimers();
  });
});
