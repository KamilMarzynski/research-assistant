// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProjectArtifactsPanel from "../ProjectArtifactsPanel";

function mockInvoke(results: Record<string, unknown[]>) {
  return vi.fn((channel: string) => {
    return Promise.resolve(results[channel] ?? []);
  });
}

describe("ProjectArtifactsPanel", () => {
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
          { id: "a1", filePath: "docs/report.md", title: "final report", createdAt: new Date() },
        ],
      }),
      send: vi.fn(),
      on: vi.fn(),
    } as unknown as Window["electronAPI"];

    render(<ProjectArtifactsPanel projectId="proj-1" />);
    expect(await screen.findByText("docs/report.md")).toBeTruthy();
    expect(screen.getByText("final report")).toBeTruthy();
  });
});
