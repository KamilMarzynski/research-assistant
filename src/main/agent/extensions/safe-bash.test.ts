import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkBlocklist, runSafeBash } from "./safe-bash";

describe("checkBlocklist", () => {
  it("throws on rm -rf", () => {
    expect(() => checkBlocklist("rm -rf /tmp/test")).toThrow(/blocked/i);
  });

  it("throws on sudo", () => {
    expect(() => checkBlocklist("sudo apt-get install curl")).toThrow(/blocked/i);
  });

  it("throws on curl", () => {
    expect(() => checkBlocklist("curl https://example.com")).toThrow(/blocked/i);
  });

  it("throws on wget", () => {
    expect(() => checkBlocklist("wget https://example.com")).toThrow(/blocked/i);
  });

  it("throws on eval", () => {
    expect(() => checkBlocklist("eval $(cat /etc/passwd)")).toThrow(/blocked/i);
  });

  it("throws on backtick subshell", () => {
    expect(() => checkBlocklist("echo `id`")).toThrow(/blocked/i);
  });

  it("throws on $() subshell", () => {
    expect(() => checkBlocklist("echo $(id)")).toThrow(/blocked/i);
  });

  it("allows safe commands", () => {
    expect(() => checkBlocklist("ls -la")).not.toThrow();
    expect(() => checkBlocklist("cat README.md")).not.toThrow();
    expect(() => checkBlocklist("bun run test")).not.toThrow();
  });
});

describe("runSafeBash", () => {
  let workDir: string;
  let auditLogPath: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "safebash-test-"));
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
    const log = await readFile(auditLogPath, "utf-8");
    expect(log).toContain("testing audit");
    expect(log).toContain("echo audit-test");
  });

  it("rejects blocklisted commands before execution", async () => {
    await expect(
      runSafeBash({
        command: "sudo rm -rf /",
        intent: "bad intent",
        projectId: "p1",
        workspacePath: workDir,
        auditLogPath,
      }),
    ).rejects.toThrow(/blocked/i);
  });
});
