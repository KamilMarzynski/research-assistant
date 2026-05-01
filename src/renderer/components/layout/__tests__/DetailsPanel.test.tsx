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

describe("ArtifactSection", () => {
  it("shows empty state when no artifacts", async () => {
    const { invoke } = setupElectronAPI();
    invoke.mockResolvedValue([]);

    renderWithProvider(<DetailsPanel />);

    // Wait for the async fetch to resolve
    await vi.waitFor(() => {
      expect(screen.getByText("No artifacts yet")).toBeTruthy();
    });
  });

  it("displays artifact list when artifacts exist", async () => {
    const { invoke } = setupElectronAPI();
    invoke.mockResolvedValue([
      {
        id: "1",
        projectId: "p1",
        title: "Research Report",
        filePath: "/x.md",
        createdAt: "2026-01-01",
      },
      { id: "2", projectId: "p1", title: "Findings", filePath: "/y.md", createdAt: "2026-01-02" },
    ]);

    renderWithProvider(<DetailsPanel />);

    await vi.waitFor(() => {
      expect(screen.getByText("Research Report")).toBeTruthy();
      expect(screen.getByText("Findings")).toBeTruthy();
    });
  });
});

describe("ArtifactViewer", () => {
  it("shows loading then content when artifact selected", async () => {
    const { invoke } = setupElectronAPI();
    invoke.mockImplementation((channel: string, payload: unknown) => {
      if (channel === "GET_ARTIFACTS")
        return Promise.resolve([
          { id: "1", projectId: "p1", title: "Report", filePath: "/r.md", createdAt: "2026-01-01" },
        ]);
      if (channel === "READ_ARTIFACT_FILE") return Promise.resolve("# Report\n\nContent here.");
      return Promise.resolve(null);
    });

    renderWithProvider(<DetailsPanel />);

    // Click an artifact
    await vi.waitFor(() => {
      expect(screen.getByText("Report")).toBeTruthy();
    });
    screen.getByText("Report").click();

    // Content should render
    await vi.waitFor(() => {
      expect(screen.getByText("Content here.")).toBeTruthy();
    });
  });

  it("shows file not found on read error", async () => {
    const { invoke } = setupElectronAPI();
    invoke.mockImplementation((channel: string) => {
      if (channel === "GET_ARTIFACTS")
        return Promise.resolve([
          {
            id: "1",
            projectId: "p1",
            title: "Report",
            filePath: "/missing.md",
            createdAt: "2026-01-01",
          },
        ]);
      if (channel === "READ_ARTIFACT_FILE") return Promise.reject(new Error("File not found"));
      return Promise.resolve(null);
    });

    renderWithProvider(<DetailsPanel />);

    await vi.waitFor(() => {
      expect(screen.getByText("Report")).toBeTruthy();
    });
    screen.getByText("Report").click();

    await vi.waitFor(() => {
      expect(screen.getByText("File not found")).toBeTruthy();
    });
  });
});
