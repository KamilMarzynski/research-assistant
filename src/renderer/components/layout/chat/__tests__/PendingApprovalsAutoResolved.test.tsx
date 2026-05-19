// @vitest-environment happy-dom

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PendingCommandBanner from "../PendingCommandBanner";
import PendingExecuteCodeBanner from "../PendingExecuteCodeBanner";
import PendingPathBanner from "../PendingPathBanner";

describe("pending approval banners", () => {
  it("clears pending approvals for the project on APPROVALS_AUTO_RESOLVED", async () => {
    const listeners = new Map<string, Array<(payload: unknown) => void>>();
    const emit = (channel: string, payload: unknown) => {
      for (const listener of listeners.get(channel) ?? []) {
        listener(payload);
      }
    };

    window.electronAPI = {
      invoke: vi.fn(),
      send: vi.fn(),
      on: vi.fn((channel: string, handler: (payload: unknown) => void) => {
        const handlers = listeners.get(channel) ?? [];
        handlers.push(handler);
        listeners.set(channel, handlers);

        return () => {
          const nextHandlers = (listeners.get(channel) ?? []).filter((entry) => entry !== handler);
          if (nextHandlers.length === 0) {
            listeners.delete(channel);
            return;
          }
          listeners.set(channel, nextHandlers);
        };
      }),
    } as unknown as Window["electronAPI"];

    render(
      <>
        <PendingCommandBanner activeProjectId="proj-1" projects={[]} />
        <PendingExecuteCodeBanner activeProjectId="proj-1" projects={[]} />
        <PendingPathBanner activeProjectId="proj-1" projects={[]} />
      </>,
    );

    act(() => {
      emit("BASH_BLOCKED", {
        commandId: "cmd-1",
        command: "echo test | cat",
        reason: "Unsafe operator",
        category: "unsafe_operator",
        key: "pipe",
        projectId: "proj-1",
        intent: "stream output",
        timestamp: new Date().toISOString(),
      });
      emit("EXECUTE_CODE_APPROVAL_REQUIRED", {
        executionId: "exec-1",
        projectId: "proj-1",
        intent: "run code",
        language: "python",
        code: "print('ok')",
        codeHash: "hash",
        networkEnabled: false,
        workspaceFiles: [],
        inlineFiles: [],
        requestedPaths: [],
        timestamp: new Date().toISOString(),
      });
      emit("PATH_APPROVAL_REQUIRED", {
        projectId: "proj-1",
        path: "/tmp/secret.txt",
        mode: "read",
        intent: "inspect file",
      });
    });

    expect(await screen.findByText(/Blocked command:/)).toBeTruthy();
    expect(screen.getByText(/code execution/)).toBeTruthy();
    expect(screen.getByText(/Blocked path:/)).toBeTruthy();

    act(() => {
      emit("APPROVALS_AUTO_RESOLVED", {
        type: "APPROVALS_AUTO_RESOLVED",
        projectId: "proj-1",
      });
    });

    expect(screen.queryByText(/Blocked command:/)).toBeNull();
    expect(screen.queryByText(/code execution/)).toBeNull();
    expect(screen.queryByText(/Blocked path:/)).toBeNull();
  });
});
