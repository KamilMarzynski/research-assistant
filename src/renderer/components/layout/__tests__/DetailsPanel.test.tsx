// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { ProjectContext, type ProjectContextValue } from "../../../contexts/ProjectContext";
import DetailsPanel from "../DetailsPanel";

function mockInvoke(results: Record<string, unknown[]>) {
  return vi.fn((channel: string) => {
    return Promise.resolve(results[channel] ?? []);
  });
}

function renderWithProvider(element: React.ReactElement, projectId: string | null = "proj-1") {
  const ctx: ProjectContextValue = {
    activeProjectId: projectId,
    setActiveProjectId: vi.fn(),
  };
  return render(<ProjectContext.Provider value={ctx}>{element}</ProjectContext.Provider>);
}

describe("DetailsPanel", () => {
  it("renders empty state when no project is active", () => {
    window.electronAPI = {
      invoke: mockInvoke({}),
      send: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
    } as unknown as Window["electronAPI"];

    renderWithProvider(<DetailsPanel />, null);
    expect(screen.getByText(/Select a project/)).toBeTruthy();
  });

  it("renders both panels for active project", async () => {
    window.electronAPI = {
      invoke: mockInvoke({
        GET_PROJECT_ARTIFACTS: [],
        GET_RESEARCHES: [],
      }),
      send: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
    } as unknown as Window["electronAPI"];

    renderWithProvider(<DetailsPanel />, "proj-1");
    expect(await screen.findByText("No artifacts yet")).toBeTruthy();
    expect(await screen.findByText("No research history")).toBeTruthy();
  });
});
