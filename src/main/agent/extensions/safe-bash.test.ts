import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkBlocklist, runSafeBash } from "./safe-bash";

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
		).rejects.toThrow("This command would recursively delete");
	});
});
