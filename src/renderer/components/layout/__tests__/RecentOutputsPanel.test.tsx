// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RecentOutputsPanel from "../RecentOutputsPanel";

describe("RecentOutputsPanel", () => {
  it("shows empty state when no outputs", async () => {
    window.electronAPI = {
      invoke: vi.fn().mockResolvedValue([]),
      send: vi.fn(),
      on: vi.fn(),
    } as unknown as Window["electronAPI"];

    render(<RecentOutputsPanel projectId="proj-1" />);
    expect(await screen.findByText("No recent outputs")).toBeTruthy();
  });

  it("renders outputs list", async () => {
    window.electronAPI = {
      invoke: vi
        .fn()
        .mockResolvedValue([
          { id: "a1", filePath: "docs/research.md", title: "research.md", acknowledged: false },
        ]),
      send: vi.fn(),
      on: vi.fn(),
    } as unknown as Window["electronAPI"];

    render(<RecentOutputsPanel projectId="proj-1" />);
    expect(await screen.findByText("docs/research.md")).toBeTruthy();
  });
});
