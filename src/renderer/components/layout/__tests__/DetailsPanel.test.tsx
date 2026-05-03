// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { ProjectContext, type ProjectContextValue } from "../../../contexts/ProjectContext";
import DetailsPanel from "../DetailsPanel";

function setupElectronAPI() {
  const invoke = vi.fn();
  window.electronAPI = {
    invoke,
    send: vi.fn(),
    on: vi.fn(),
  } as unknown as Window["electronAPI"];
  return { invoke };
}

function renderWithProvider(element: React.ReactElement, projectId = "proj-1") {
  const ctx: ProjectContextValue = {
    activeProjectId: projectId,
    setActiveProjectId: vi.fn(),
  };
  return render(<ProjectContext.Provider value={ctx}>{element}</ProjectContext.Provider>);
}

describe("DetailsPanel", () => {
  it("shows empty state when no outputs", async () => {
    const { invoke } = setupElectronAPI();
    invoke.mockResolvedValue([]);

    renderWithProvider(<DetailsPanel />);

    await vi.waitFor(() => {
      expect(screen.getByText("No recent outputs")).toBeTruthy();
    });
  });

  it("displays recent outputs list", async () => {
    const { invoke } = setupElectronAPI();
    invoke.mockResolvedValue([
      {
        id: "1",
        projectId: "p1",
        title: "Research Report",
        filePath: "docs/research.md",
        acknowledged: false,
        createdAt: "2026-01-01",
      },
      {
        id: "2",
        projectId: "p1",
        title: "Findings",
        filePath: "docs/findings.md",
        acknowledged: false,
        createdAt: "2026-01-02",
      },
    ]);

    renderWithProvider(<DetailsPanel />);

    await vi.waitFor(() => {
      expect(screen.getByText("docs/research.md")).toBeTruthy();
      expect(screen.getByText("docs/findings.md")).toBeTruthy();
    });
  });
});
