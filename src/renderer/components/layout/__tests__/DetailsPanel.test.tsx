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
  it("renders empty state when no project is active", () => {
    setupElectronAPI();
    const ctx: ProjectContextValue = {
      activeProjectId: null,
      setActiveProjectId: vi.fn(),
    };
    render(
      <ProjectContext.Provider value={ctx}>
        <DetailsPanel />
      </ProjectContext.Provider>,
    );
    expect(screen.queryByText("Project Files")).toBeNull();
    expect(screen.getByText(/Details, artifacts and recent outputs/)).toBeTruthy();
  });

  it("renders file explorer for active project", async () => {
    const { invoke } = setupElectronAPI();
    invoke.mockImplementation((channel: string) => {
      if (channel === "GET_FILE_TREE") {
        return Promise.resolve({
          name: "Test Project",
          path: "/project",
          isDirectory: true,
          children: [{ name: "readme.md", path: "/project/readme.md", isDirectory: false }],
        });
      }
      if (channel === "GET_RECENT_OUTPUTS") {
        return Promise.resolve([]);
      }
      return Promise.resolve(undefined);
    });

    renderWithProvider(<DetailsPanel />);

    await vi.waitFor(() => {
      expect(screen.getByText("Project Files")).toBeTruthy();
    });

    expect(screen.getByText(/Test Project/)).toBeTruthy();
    expect(screen.getByText(/readme\.md/)).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("GET_FILE_TREE", { projectId: "proj-1" });
  });
});
