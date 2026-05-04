// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IPC } from "../../../shared/ipc-channels";
import FileExplorer from "./FileExplorer";

function setupElectronAPI() {
  const invoke = vi.fn();
  window.electronAPI = {
    invoke,
    send: vi.fn(),
    on: vi.fn(),
  } as unknown as Window["electronAPI"];
  return { invoke };
}

describe("FileExplorer", () => {
  it("renders loading state initially", () => {
    const { invoke } = setupElectronAPI();
    invoke.mockReturnValue(new Promise(() => {}));

    render(<FileExplorer projectId="proj-1" />);
    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  it("renders tree after data loads", async () => {
    const { invoke } = setupElectronAPI();
    invoke.mockResolvedValue({
      name: "My Project",
      path: "/project",
      isDirectory: true,
      children: [
        {
          name: "src",
          path: "/project/src",
          isDirectory: true,
          children: [{ name: "index.ts", path: "/project/src/index.ts", isDirectory: false }],
        },
      ],
    });

    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText("Project Files")).toBeTruthy();
    });

    expect(screen.getByText(/My Project/)).toBeTruthy();
    expect(screen.getByText(/src/)).toBeTruthy();
    expect(screen.getByText(/index\.ts/)).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith(IPC.GET_FILE_TREE, { projectId: "proj-1" });
  });

  it("toggles directory expand/collapse on click", async () => {
    const { invoke } = setupElectronAPI();
    invoke.mockResolvedValue({
      name: "My Project",
      path: "/project",
      isDirectory: true,
      children: [
        {
          name: "src",
          path: "/project/src",
          isDirectory: true,
          children: [{ name: "index.ts", path: "/project/src/index.ts", isDirectory: false }],
        },
      ],
    });

    render(<FileExplorer projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText(/src/)).toBeTruthy();
    });

    expect(screen.getByText(/index\.ts/)).toBeTruthy();

    const dirNode = screen.getByText(/src/);
    fireEvent.click(dirNode);

    await waitFor(() => {
      expect(screen.queryByText(/index\.ts/)).toBeNull();
    });

    fireEvent.click(dirNode);
    await waitFor(() => {
      expect(screen.getByText(/index\.ts/)).toBeTruthy();
    });
  });
});
