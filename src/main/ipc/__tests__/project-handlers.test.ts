import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC } from "../../../shared/ipc-channels";
import { EventBus } from "../../event-bus";
import type { ProjectApprovalLevelUpdateResult } from "../../services/ProjectService";
import { SessionManager } from "../session-manager";

const ipcHandlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();

vi.mock("electron", () => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(
      (channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => {
        ipcHandlers.set(channel, handler);
      },
    ),
  },
}));

function makeDeps() {
  const defaultUpdateResult: ProjectApprovalLevelUpdateResult = {
    approvalLevel: "default",
    approvalsAutoResolved: false,
    resolution: null,
  };

  return {
    projectService: {
      listProjects: vi.fn().mockResolvedValue([]),
      createProject: vi.fn(),
      renameProject: vi.fn(),
      deleteProject: vi.fn(),
      linkFolder: vi.fn(),
      unlinkFolder: vi.fn(),
      setModelOverride: vi.fn(),
      setApprovalLevel: vi.fn().mockResolvedValue(undefined),
      transitionApprovalLevel: vi.fn().mockResolvedValue(defaultUpdateResult),
    },
    approvalResolver: {
      resolvePendingApprovals: vi.fn().mockResolvedValue({ status: "unsupported" }),
    },
    sessionManager: new SessionManager(),
    eventBus: new EventBus(),
  };
}

function makeWin() {
  return {
    webContents: {
      send: vi.fn(),
    },
  } as never;
}

async function invoke(channel: string, payload: unknown) {
  const handler = ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`Handler not registered for ${channel}`);
  }
  return handler({}, payload);
}

describe("registerProjectHandlers", () => {
  beforeEach(() => {
    ipcHandlers.clear();
  });

  it("updates approval level without deleting the session", async () => {
    const deps = makeDeps();
    const deleteSpy = vi.spyOn(deps.sessionManager, "delete");
    const emitSpy = vi.spyOn(deps.eventBus, "emit");

    const { registerProjectHandlers } = await import("../project-handlers");
    registerProjectHandlers(makeWin(), deps as never);

    const result = await invoke(IPC.SET_PROJECT_APPROVAL_LEVEL, {
      projectId: "proj-1",
      approvalLevel: "default",
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(deps.projectService.transitionApprovalLevel).toHaveBeenCalledWith(
      "proj-1",
      "default",
      deps.approvalResolver,
    );
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it("emits approvals:auto_resolved when the service reports successful resolution", async () => {
    const deps = makeDeps();
    deps.projectService.transitionApprovalLevel.mockResolvedValue({
      approvalLevel: "bypass_approvals",
      approvalsAutoResolved: true,
      resolution: { status: "resolved", resolvedCount: 2 },
    });
    const deleteSpy = vi.spyOn(deps.sessionManager, "delete");
    const emitSpy = vi.spyOn(deps.eventBus, "emit");

    const { registerProjectHandlers } = await import("../project-handlers");
    registerProjectHandlers(makeWin(), deps as never);

    const result = await invoke(IPC.SET_PROJECT_APPROVAL_LEVEL, {
      projectId: "proj-1",
      approvalLevel: "bypass_approvals",
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(deps.projectService.transitionApprovalLevel).toHaveBeenCalledWith(
      "proj-1",
      "bypass_approvals",
      deps.approvalResolver,
    );
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith({
      type: "approvals:auto_resolved",
      payload: { projectId: "proj-1" },
    });
  });

  it("returns success when resolver work fails after persistence and does not emit auto_resolved", async () => {
    const deps = makeDeps();
    deps.projectService.transitionApprovalLevel.mockResolvedValue({
      approvalLevel: "bypass_approvals",
      approvalsAutoResolved: false,
      resolution: { status: "failed", error: "resolver failed" },
    });
    const emitSpy = vi.spyOn(deps.eventBus, "emit");

    const { registerProjectHandlers } = await import("../project-handlers");
    registerProjectHandlers(makeWin(), deps as never);

    const result = await invoke(IPC.SET_PROJECT_APPROVAL_LEVEL, {
      projectId: "proj-1",
      approvalLevel: "bypass_approvals",
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(emitSpy).not.toHaveBeenCalledWith({
      type: "approvals:auto_resolved",
      payload: { projectId: "proj-1" },
    });
  });

  it("rejects invalid approval-level payloads", async () => {
    const deps = makeDeps();

    const { registerProjectHandlers } = await import("../project-handlers");
    registerProjectHandlers(makeWin(), deps as never);

    const result = await invoke(IPC.SET_PROJECT_APPROVAL_LEVEL, {
      projectId: "proj-1",
      approvalLevel: "invalid",
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("Invalid payload for SET_PROJECT_APPROVAL_LEVEL"),
    });
    expect(deps.projectService.transitionApprovalLevel).not.toHaveBeenCalled();
  });
});
