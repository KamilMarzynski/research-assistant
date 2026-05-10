// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
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
          { id: "r2", query: "market analysis", status: "complete", startedAt: new Date("2026-05-09") },
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
});
