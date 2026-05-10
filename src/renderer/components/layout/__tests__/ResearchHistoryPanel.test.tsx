// @vitest-environment happy-dom

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ResearchHistoryPanel from "../ResearchHistoryPanel";

function mockInvoke(results: Record<string, unknown[]>) {
  return vi.fn((channel: string) => {
    return Promise.resolve(results[channel] ?? []);
  });
}

describe("ResearchHistoryPanel", () => {
  it("shows empty state when no researches", async () => {
    window.electronAPI = {
      invoke: mockInvoke({ GET_RESEARCHES: [] }),
      send: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
    } as unknown as Window["electronAPI"];

    render(<ResearchHistoryPanel projectId="proj-1" />);
    expect(await screen.findByText("No research history")).toBeTruthy();
  });

  it("renders research list with status", async () => {
    window.electronAPI = {
      invoke: mockInvoke({
        GET_RESEARCHES: [
          { id: "r1", query: "quantum computing", status: "in_progress", startedAt: new Date() },
          {
            id: "r2",
            query: "market analysis",
            status: "complete",
            startedAt: new Date("2026-05-09"),
          },
        ],
      }),
      send: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
    } as unknown as Window["electronAPI"];

    render(<ResearchHistoryPanel projectId="proj-1" />);
    expect(await screen.findByText("quantum computing")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("shows loading state while fetching", async () => {
    let resolveResearch!: (value: unknown[]) => void;
    const researchPromise = new Promise<unknown[]>((resolve) => {
      resolveResearch = resolve;
    });

    window.electronAPI = {
      invoke: vi.fn().mockReturnValue(researchPromise),
      send: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
    } as unknown as Window["electronAPI"];

    render(<ResearchHistoryPanel projectId="proj-1" />);
    expect(screen.getByText("Loading...")).toBeTruthy();

    resolveResearch([{ id: "r1", query: "test", status: "complete", startedAt: new Date() }]);
    await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
  });

  it("shows error state on fetch failure", async () => {
    window.electronAPI = {
      invoke: vi.fn().mockRejectedValue(new Error("Network error")),
      send: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
    } as unknown as Window["electronAPI"];

    render(<ResearchHistoryPanel projectId="proj-1" />);
    expect(await screen.findByText("Error: Network error")).toBeTruthy();
  });

  it("subscribes to research events and reloads on matching projectId", async () => {
    const listeners: Record<string, Array<(data: unknown) => void>> = {};
    window.electronAPI = {
      invoke: mockInvoke({
        GET_RESEARCHES: [{ id: "r1", query: "initial", status: "pending", startedAt: new Date() }],
      }),
      send: vi.fn(),
      on: vi.fn().mockImplementation((channel: string, handler: (data: unknown) => void) => {
        if (!listeners[channel]) listeners[channel] = [];
        listeners[channel].push(handler);
        return () => {
          listeners[channel] = listeners[channel].filter((h) => h !== handler);
        };
      }),
    } as unknown as Window["electronAPI"];

    render(<ResearchHistoryPanel projectId="proj-1" />);
    expect(await screen.findByText("initial")).toBeTruthy();

    (window.electronAPI as unknown as { invoke: ReturnType<typeof vi.fn> }).invoke = mockInvoke({
      GET_RESEARCHES: [{ id: "r2", query: "updated", status: "complete", startedAt: new Date() }],
    });

    listeners.RESEARCH_STATUS_UPDATE?.forEach((h) => {
      h({ projectId: "proj-1" });
    });
    await waitFor(() => expect(screen.queryByText("updated")).toBeTruthy());
  });

  it("ignores research events for different projectId", async () => {
    const listeners: Record<string, Array<(data: unknown) => void>> = {};
    window.electronAPI = {
      invoke: mockInvoke({
        GET_RESEARCHES: [{ id: "r1", query: "initial", status: "pending", startedAt: new Date() }],
      }),
      send: vi.fn(),
      on: vi.fn().mockImplementation((channel: string, handler: (data: unknown) => void) => {
        if (!listeners[channel]) listeners[channel] = [];
        listeners[channel].push(handler);
        return () => {
          listeners[channel] = listeners[channel].filter((h) => h !== handler);
        };
      }),
    } as unknown as Window["electronAPI"];

    render(<ResearchHistoryPanel projectId="proj-1" />);
    expect(await screen.findByText("initial")).toBeTruthy();

    (window.electronAPI as unknown as { invoke: ReturnType<typeof vi.fn> }).invoke = vi
      .fn()
      .mockRejectedValue(new Error("should not be called"));

    listeners.RESEARCH_STATUS_UPDATE?.forEach((h) => {
      h({ projectId: "proj-2" });
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText("initial")).toBeTruthy();
  });

  it("formats date correctly", async () => {
    window.electronAPI = {
      invoke: mockInvoke({
        GET_RESEARCHES: [
          { id: "r1", query: "today query", status: "complete", startedAt: new Date() },
          {
            id: "r2",
            query: "yesterday query",
            status: "complete",
            startedAt: new Date(Date.now() - 86400000),
          },
          { id: "r3", query: "old query", status: "complete", startedAt: new Date("2025-01-15") },
        ],
      }),
      send: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
    } as unknown as Window["electronAPI"];

    render(<ResearchHistoryPanel projectId="proj-1" />);
    expect(await screen.findByText("today query")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Yesterday")).toBeTruthy();
    expect(screen.getByText("Jan 15")).toBeTruthy();
  });

  it("cancels stale fetch when projectId changes", async () => {
    let resolveFirst!: (value: unknown[]) => void;
    const firstPromise = new Promise<unknown[]>((resolve) => {
      resolveFirst = resolve;
    });

    let resolveSecond!: (value: unknown[]) => void;
    const secondPromise = new Promise<unknown[]>((resolve) => {
      resolveSecond = resolve;
    });

    const invoke = vi.fn();
    invoke.mockImplementation((channel: string, payload: { projectId: string }) => {
      if (payload.projectId === "proj-1") return firstPromise;
      if (payload.projectId === "proj-2") return secondPromise;
      return Promise.resolve([]);
    });

    window.electronAPI = {
      invoke,
      send: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
    } as unknown as Window["electronAPI"];

    const { rerender } = render(<ResearchHistoryPanel projectId="proj-1" />);
    await waitFor(() => expect(screen.getByText("Loading...")).toBeTruthy());

    // Switch to proj-2 before proj-1 resolves
    rerender(<ResearchHistoryPanel projectId="proj-2" />);
    await waitFor(() => expect(screen.getByText("Loading...")).toBeTruthy());

    // Resolve the stale proj-1 fetch with data that should be ignored
    resolveFirst([{ id: "old", query: "stale", status: "complete", startedAt: new Date() }]);
    // Resolve the fresh proj-2 fetch
    resolveSecond([{ id: "new", query: "fresh", status: "complete", startedAt: new Date() }]);

    await waitFor(() => expect(screen.getByText("fresh")).toBeTruthy());
    expect(screen.queryByText("stale")).toBeNull();
  });
});
