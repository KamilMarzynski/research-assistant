// @vitest-environment happy-dom

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProjectArtifactsPanel from "../ProjectArtifactsPanel";

function mockInvoke(results: Record<string, unknown[]>) {
  return vi.fn((channel: string) => {
    return Promise.resolve(results[channel] ?? []);
  });
}

function mockInvokeRejects(error: Error) {
  return vi.fn(() => Promise.reject(error));
}

describe("ProjectArtifactsPanel", () => {
  it("shows loading state while fetching", async () => {
    window.electronAPI = {
      invoke: mockInvoke({ GET_PROJECT_ARTIFACTS: [] }),
      send: vi.fn(),
      on: vi.fn(),
    } as unknown as Window["electronAPI"];

    render(<ProjectArtifactsPanel projectId="proj-1" />);
    expect(screen.getByText("Loading...")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
  });

  it("shows empty state when no artifacts", async () => {
    window.electronAPI = {
      invoke: mockInvoke({ GET_PROJECT_ARTIFACTS: [] }),
      send: vi.fn(),
      on: vi.fn(),
    } as unknown as Window["electronAPI"];

    render(<ProjectArtifactsPanel projectId="proj-1" />);
    expect(await screen.findByText("No artifacts yet")).toBeTruthy();
  });

  it("renders artifact list", async () => {
    window.electronAPI = {
      invoke: mockInvoke({
        GET_PROJECT_ARTIFACTS: [
          {
            id: "a1",
            projectId: "proj-1",
            filePath: "docs/report.md",
            title: "final report",
            acknowledged: false,
            createdAt: new Date(),
          },
        ],
      }),
      send: vi.fn(),
      on: vi.fn(),
    } as unknown as Window["electronAPI"];

    render(<ProjectArtifactsPanel projectId="proj-1" />);
    expect(await screen.findByText("docs/report.md")).toBeTruthy();
    expect(screen.getByText("final report")).toBeTruthy();
  });

  it("shows error state on fetch failure", async () => {
    window.electronAPI = {
      invoke: mockInvokeRejects(new Error("IPC failure")),
      send: vi.fn(),
      on: vi.fn(),
    } as unknown as Window["electronAPI"];

    render(<ProjectArtifactsPanel projectId="proj-1" />);
    expect(await screen.findByText("Error: IPC failure")).toBeTruthy();
  });
});
