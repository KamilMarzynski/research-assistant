import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC } from "../../../shared/ipc-channels";
import { enterExecuteCodeApprovalGate } from "../../agent/extensions/execute-code-approval";
import { enterPathApprovalGate } from "../../agent/extensions/path-approval";
import { clearAllowlists, runSafeBash } from "../../agent/extensions/safe-bash";
import { AllowlistService } from "../../services/AllowlistService";
import { addPendingPathApproval, registerCommandHandlers } from "../command-handlers";

const ipcHandlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => {
        ipcHandlers.set(channel, handler);
      },
    ),
  },
}));

describe("registerCommandHandlers resolver", () => {
  beforeEach(() => {
    ipcHandlers.clear();
    clearAllowlists();
    vi.useRealTimers();
  });

  it("resolves pending approvals across safe_bash, execute_code, and path gates for one project", async () => {
    const allowlistService = new AllowlistService();
    const resolver = registerCommandHandlers({} as never, allowlistService);

    const blockedPromise = runSafeBash({
      command: "echo hello | cat",
      intent: "pipeline command",
      projectId: "p1",
      workspacePath: process.cwd(),
      auditLogPath: "/tmp/task3-command-handlers-audit.log",
      emitBlocked: vi.fn(),
    });

    const executeCodePromise = enterExecuteCodeApprovalGate(
      {
        projectId: "p1",
        intent: "execute",
        language: "python",
        code: "print('ok')",
        codeHash: "hash",
        networkEnabled: false,
        workspaceFiles: [],
        inlineFiles: [],
        requestedPaths: [],
      },
      vi.fn(),
    );

    const pathPromise = enterPathApprovalGate("p1", "/tmp/restricted.txt", "read");
    addPendingPathApproval({
      projectId: "p1",
      path: "/tmp/restricted.txt",
      mode: "read",
      intent: "read restricted",
    });

    const result = await resolver.resolvePendingApprovals("p1");

    expect(result).toEqual({ status: "resolved", resolvedCount: 3 });
    await expect(blockedPromise).resolves.toMatchObject({
      stdout: expect.stringContaining("hello"),
    });
    await expect(executeCodePromise).resolves.toMatchObject({ approved: true });
    await expect(pathPromise).resolves.toEqual({ approved: true });
    expect(allowlistService.isAllowed("p1", "/tmp/restricted.txt", "read", [])).toEqual({
      allowed: true,
      needsApproval: false,
    });
    expect(allowlistService.isAllowed("p1", "/tmp/restricted.txt", "write", [])).toEqual({
      allowed: false,
      needsApproval: true,
    });
  });

  it("returns no_pending_approvals when nothing is waiting", async () => {
    const resolver = registerCommandHandlers({} as never, new AllowlistService());

    await expect(resolver.resolvePendingApprovals("p1")).resolves.toEqual({
      status: "no_pending_approvals",
    });
  });

  it("removes timed-out path approvals from the pending IPC map", async () => {
    vi.useFakeTimers();
    const resolver = registerCommandHandlers({} as never, new AllowlistService());

    const pathPromise = enterPathApprovalGate("p1", "/tmp/timed-out.txt", "read");
    addPendingPathApproval({
      projectId: "p1",
      path: "/tmp/timed-out.txt",
      mode: "read",
      intent: "read timed out",
    });

    const getPendingHandler = ipcHandlers.get(IPC.GET_PENDING_PATH_APPROVALS);
    if (!getPendingHandler) {
      throw new Error("GET_PENDING_PATH_APPROVALS handler not registered");
    }

    await vi.advanceTimersByTimeAsync(300_000);

    await expect(pathPromise).resolves.toEqual({ approved: false });
    await expect(getPendingHandler({}, undefined)).resolves.toEqual({ ok: true, data: [] });
    await expect(resolver.resolvePendingApprovals("p1")).resolves.toEqual({
      status: "no_pending_approvals",
    });
  });
});
