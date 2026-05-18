import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AllowlistService, ApprovalRequiredError } from "../../../services/AllowlistService";
import { resolveExecuteCodeApproval } from "../../extensions/execute-code-approval";
import type { PathJail } from "../../path-jail";

const { runExecuteCode } = vi.hoisted(() => ({ runExecuteCode: vi.fn() }));

vi.mock("../../extensions/docker-sandbox", () => ({
  runExecuteCode,
}));

const { createExecuteCodeTool } = await import("../execute-code-tool");

function getText<T>(result: AgentToolResult<T>) {
  return (result.content[0] as { text: string }).text;
}

function parseAudit(raw: string) {
  return JSON.parse(raw.trim()) as Record<string, unknown>;
}

describe("createExecuteCodeTool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "execute-code-tool-test-"));
    vi.clearAllMocks();
    runExecuteCode.mockResolvedValue({ stdout: "ok", outputFiles: [] });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("emits one approval request before running code", async () => {
    const emitApprovalRequired = vi.fn();
    const jail = { validate: (p: string) => p } as unknown as PathJail;
    const auditLogPath = join(tempDir, "audit.log");
    const tool = createExecuteCodeTool(jail, {
      projectId: "p1",
      auditLogPath,
      allowlistService: new AllowlistService(),
      emitApprovalRequired,
    });

    const pending = tool.execute("tool-call", {
      intent: "check csv totals",
      code: "print('ok')",
      language: "python",
      files: [{ name: "data.csv", content: "a\n1" }],
    });

    await vi.waitFor(() => expect(emitApprovalRequired).toHaveBeenCalledTimes(1));
    const request = emitApprovalRequired.mock.calls[0][0];
    expect(request.intent).toBe("check csv totals");
    expect(request.language).toBe("python");
    expect(request.code).toBe("print('ok')");
    expect(request.inlineFiles).toEqual(["data.csv"]);

    resolveExecuteCodeApproval(request.executionId, "approve_once");
    const result = await pending;

    expect(getText(result)).toContain("stdout:\nok");
    expect(runExecuteCode).toHaveBeenCalledWith(
      expect.objectContaining({ code: "print('ok')", language: "python" }),
    );
    const audit = await readFile(auditLogPath, "utf-8");
    const auditEntry = parseAudit(audit);
    expect(auditEntry.tool).toBe("execute_code");
    expect(auditEntry.code).toBe("print('ok')");
  });

  it("combines path approval with execute-code approval", async () => {
    const emitApprovalRequired = vi.fn();
    const allowlistService = new AllowlistService();
    const restrictedPath = join(tempDir, "restricted.txt");
    const jail = {
      projectId: "p1",
      validate: vi.fn((p: string) => {
        if (p === restrictedPath) {
          const allowed = allowlistService.isAllowed("p1", p, "read", []);
          if (!allowed.allowed) throw new ApprovalRequiredError(p, "read");
        }
        return p;
      }),
    } as unknown as PathJail;
    const tool = createExecuteCodeTool(jail, {
      projectId: "p1",
      auditLogPath: join(tempDir, "audit.log"),
      allowlistService,
      emitApprovalRequired,
    });

    const pending = tool.execute("tool-call", {
      intent: "read fixture",
      code: "print('ok')",
      language: "python",
      workspaceFiles: [restrictedPath],
    });

    await vi.waitFor(() => expect(emitApprovalRequired).toHaveBeenCalledTimes(1));
    const request = emitApprovalRequired.mock.calls[0][0];
    expect(request.requestedPaths).toEqual([{ path: restrictedPath, mode: "read" }]);

    resolveExecuteCodeApproval(request.executionId, "approve_once");
    await pending;

    expect(runExecuteCode).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceFiles: [{ name: "restricted.txt", sourcePath: restrictedPath }],
      }),
    );
  });

  it("audits denied executions without running Docker", async () => {
    const emitApprovalRequired = vi.fn();
    const auditLogPath = join(tempDir, "audit.log");
    const jail = { validate: (p: string) => p } as unknown as PathJail;
    const tool = createExecuteCodeTool(jail, {
      projectId: "p1",
      auditLogPath,
      allowlistService: new AllowlistService(),
      emitApprovalRequired,
    });

    const pending = tool.execute("tool-call", {
      intent: "try code",
      code: "print('nope')",
      language: "python",
    });

    await vi.waitFor(() => expect(emitApprovalRequired).toHaveBeenCalledTimes(1));
    const request = emitApprovalRequired.mock.calls[0][0];
    resolveExecuteCodeApproval(request.executionId, "deny");
    const result = await pending;

    expect(getText(result)).toBe("User denied code execution.");
    expect(runExecuteCode).not.toHaveBeenCalled();
    const audit = await readFile(auditLogPath, "utf-8");
    const auditEntry = parseAudit(audit);
    expect(auditEntry.blocked).toBe(true);
    expect(auditEntry.code).toBe("print('nope')");
  });

  it("bypasses execute-code approval and requested path approvals when project policy allows it", async () => {
    const emitApprovalRequired = vi.fn();
    const allowlistService = new AllowlistService();
    const restrictedPath = join(tempDir, "restricted.txt");
    const jail = {
      projectId: "p1",
      validate: vi.fn((p: string) => {
        if (p === restrictedPath) {
          const allowed = allowlistService.isAllowed("p1", p, "read", []);
          if (!allowed.allowed) throw new ApprovalRequiredError(p, "read");
        }
        return p;
      }),
    } as unknown as PathJail;
    const tool = createExecuteCodeTool(jail, {
      projectId: "p1",
      auditLogPath: join(tempDir, "audit.log"),
      allowlistService,
      emitApprovalRequired,
      shouldBypassApproval: vi.fn().mockResolvedValue(true),
    });

    const result = await tool.execute("tool-call", {
      intent: "read fixture",
      code: "print('ok')",
      language: "python",
      workspaceFiles: [restrictedPath],
    });

    expect(getText(result)).toContain("stdout:\nok");
    expect(emitApprovalRequired).not.toHaveBeenCalled();
    expect(runExecuteCode).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceFiles: [{ name: "restricted.txt", sourcePath: restrictedPath }],
      }),
    );
  });
});
