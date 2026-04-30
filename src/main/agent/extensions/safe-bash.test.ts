import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BlockedCommandError,
  checkBlocklist,
  resolveBlockedCommand,
  runSafeBash,
  sessionAllowlist,
} from "./safe-bash";

let testCounter = 0;

describe("checkBlocklist", () => {
  it("returns matching entry for rm -rf", () => {
    const entry = checkBlocklist("rm -rf /tmp/test");
    expect(entry).not.toBeNull();
    expect(entry?.key).toBe("recursive_delete");
    expect(entry?.reason).toContain("recursively delete");
  });

  it("returns matching entry for sudo", () => {
    const entry = checkBlocklist("sudo apt-get install curl");
    expect(entry).not.toBeNull();
    expect(entry?.key).toBe("sudo");
    expect(entry?.category).toBe("privilege_escalation");
  });

  it("returns matching entry for curl", () => {
    const entry = checkBlocklist("curl https://example.com");
    expect(entry).not.toBeNull();
    expect(entry?.key).toBe("curl");
    expect(entry?.category).toBe("exfiltration");
  });

  it("returns matching entry for wget", () => {
    const entry = checkBlocklist("wget https://example.com");
    expect(entry).not.toBeNull();
    expect(entry?.key).toBe("wget");
  });

  it("returns matching entry for eval", () => {
    const entry = checkBlocklist("eval $(cat /etc/passwd)");
    expect(entry).not.toBeNull();
    expect(entry?.key).toBe("eval");
  });

  it("returns matching entry for backtick subshell", () => {
    const entry = checkBlocklist("echo `id`");
    expect(entry).not.toBeNull();
    expect(entry?.key).toBe("backtick_subshell");
  });

  it("returns matching entry for command substitution", () => {
    const entry = checkBlocklist("echo $(id)");
    expect(entry).not.toBeNull();
    expect(entry?.key).toBe("command_substitution");
  });

  it("returns null for safe commands", () => {
    expect(checkBlocklist("ls -la")).toBeNull();
    expect(checkBlocklist("cat README.md")).toBeNull();
    expect(checkBlocklist("bun run test")).toBeNull();
  });
});

describe("runSafeBash", () => {
  let workDir: string;
  let auditLogPath: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), `safebash-test-${testCounter++}-`));
    auditLogPath = join(workDir, "audit.log");
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("runs a command and returns stdout", async () => {
    const result = await runSafeBash({
      command: "echo hello",
      intent: "test echo",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
    });
    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("returns non-zero exitCode on failure", async () => {
    const result = await runSafeBash({
      command: "exit 1",
      intent: "test failure",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
    });
    expect(result.exitCode).toBe(1);
  });

  it("captures stderr", async () => {
    const result = await runSafeBash({
      command: "echo error >&2",
      intent: "test stderr",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
    });
    expect(result.stderr).toContain("error");
  });

  it("appends to audit log", async () => {
    await runSafeBash({
      command: "echo audit-test",
      intent: "testing audit",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
    });
    // appendFile is fire-and-forget; brief wait for disk flush
    await new Promise((r) => setTimeout(r, 100));
    const log = await readFile(auditLogPath, "utf-8");
    expect(log).toContain("testing audit");
    expect(log).toContain("echo audit-test");
  });

  it("throws BlockedCommandError when blocked and no emitBlocked provided", async () => {
    await expect(
      runSafeBash({
        command: "sudo rm -rf /",
        intent: "bad intent",
        projectId: "p1",
        workspacePath: workDir,
        auditLogPath,
      }),
    ).rejects.toThrow(BlockedCommandError);
    await expect(
      runSafeBash({
        command: "sudo rm -rf /",
        intent: "bad intent",
        projectId: "p1",
        workspacePath: workDir,
        auditLogPath,
      }),
    ).rejects.toThrow("This command would recursively delete");
  });
});

describe("approval gate", () => {
  let workDir: string;
  let auditLogPath: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), `safebash-test-${testCounter++}-`));
    auditLogPath = join(workDir, "audit.log");
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    sessionAllowlist.clear();
  });

  async function getBlockedPayload(emitBlocked: ReturnType<typeof vi.fn>) {
    // emitBlocked is called in the same microtask; wait a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(emitBlocked).toHaveBeenCalledOnce();
    return emitBlocked.mock.calls[0][0] as {
      commandId: string;
      command: string;
      reason: string;
      category: string;
      key: string;
      projectId: string;
      intent: string;
      timestamp: string;
    };
  }

  it("blocks curl and calls emitBlocked", async () => {
    const emitBlocked = vi.fn();
    const promise = runSafeBash({
      command: "curl https://example.com",
      intent: "fetch data",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
      emitBlocked,
    });

    const payload = await getBlockedPayload(emitBlocked);
    expect(payload.command).toBe("curl https://example.com");
    expect(payload.reason).toContain("Network outbound");
    expect(payload.commandId).toBeDefined();

    resolveBlockedCommand(payload.commandId, "deny");
    await expect(promise).rejects.toThrow("Blocked:");
  });

  it("approve_once executes command and resolves", async () => {
    const emitBlocked = vi.fn();
    const promise = runSafeBash({
      command: "curl https://example.com",
      intent: "test",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
      emitBlocked,
    });

    const payload = await getBlockedPayload(emitBlocked);
    resolveBlockedCommand(payload.commandId, "approve_once");

    // curl may fail to connect, but promise should resolve (not reject)
    const result = await promise;
    expect(result).toBeDefined();
  });

  it("approve_session adds hash to allowlist", async () => {
    const emitBlocked = vi.fn();
    const command = "curl https://session-test.example.com";

    // First call blocked, approve_session
    const promise1 = runSafeBash({
      command,
      intent: "test",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
      emitBlocked,
    });
    const payload = await getBlockedPayload(emitBlocked);
    resolveBlockedCommand(payload.commandId, "approve_session");
    await promise1;

    // Second call should pass through (not blocked)
    const emitBlocked2 = vi.fn();
    const result = await runSafeBash({
      command,
      intent: "test",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
      emitBlocked: emitBlocked2,
    });
    expect(emitBlocked2).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("auto-rejects after timeout", async () => {
    vi.useFakeTimers();
    const emitBlocked = vi.fn();
    const promise = runSafeBash({
      command: "curl https://example.com",
      intent: "test",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
      emitBlocked,
    });

    vi.advanceTimersByTime(300_001);

    await expect(promise).rejects.toThrow(/timed out/i);
    vi.useRealTimers();
  });
});
