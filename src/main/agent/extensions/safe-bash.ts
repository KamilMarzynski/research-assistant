import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";

export interface BlocklistEntry {
	pattern: RegExp;
	key: string;
	reason: string;
	category: "destructive" | "privilege_escalation" | "exfiltration" | "persistence";
}

const BLOCKLIST: BlocklistEntry[] = [
	{ pattern: /\brm\s+-rf\b/, key: "recursive_delete", reason: "This command would recursively delete files without recovery.", category: "destructive" },
	{ pattern: /\bsudo\b/, key: "sudo", reason: "Privilege escalation commands require user review.", category: "privilege_escalation" },
	{ pattern: /\bchmod\s+\+x\b/, key: "make_executable", reason: "Making files executable without review is a security risk.", category: "persistence" },
	{ pattern: /\bmkfs\b/, key: "format_filesystem", reason: "Filesystem formatting is destructive and irreversible.", category: "destructive" },
	{ pattern: /\bdd\b\s+if=/, key: "raw_disk_io", reason: "Raw disk I/O can corrupt data.", category: "destructive" },
	{ pattern: /\bcurl\b/, key: "curl", reason: "Network outbound commands are blocked. Use fetch_url tool instead.", category: "exfiltration" },
	{ pattern: /\bwget\b/, key: "wget", reason: "Network outbound commands are blocked. Use fetch_url tool instead.", category: "exfiltration" },
	{ pattern: /\beval\b/, key: "eval", reason: "Dynamic code execution poses injection risks.", category: "persistence" },
	{ pattern: /`/, key: "backtick_subshell", reason: "Backtick subshells bypass command review.", category: "persistence" },
	{ pattern: /\$\(/, key: "command_substitution", reason: "Command substitution ($(...)) can execute hidden code.", category: "persistence" },
];

export function checkBlocklist(command: string): BlocklistEntry | null {
	for (const entry of BLOCKLIST) {
		if (entry.pattern.test(command)) return entry;
	}
	return null;
}

export class BlockedCommandError extends Error {
	readonly commandId?: string;
	readonly category?: string;
	constructor(message: string, commandId?: string, category?: string) {
		super(message);
		this.name = "BlockedCommandError";
		this.commandId = commandId;
		this.category = category;
	}
}

export interface SafeBashOptions {
	command: string;
	intent: string;
	projectId: string;
	workspacePath: string;
	auditLogPath: string;
	timeoutMs?: number;
}

export interface SafeBashResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	truncated: boolean;
}

const MAX_OUTPUT_BYTES = 2048;

export async function runSafeBash(opts: SafeBashOptions): Promise<SafeBashResult> {
	const { command, intent, projectId, workspacePath, auditLogPath, timeoutMs = 30_000 } = opts;

	const entry = checkBlocklist(command);
	if (entry) {
		throw new BlockedCommandError(entry.reason, entry.key, entry.category);
	}

	return new Promise<SafeBashResult>((resolve, reject) => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		const proc = spawn("bash", ["-c", command], {
			cwd: workspacePath,
			signal: controller.signal,
		});

		let stdout = "";
		let stderr = "";
		let truncated = false;
		let settled = false;

		const settle = (result: SafeBashResult) => {
			if (!settled) {
				settled = true;
				resolve(result);
			}
		};

		proc.stdout.on("data", (chunk: Buffer) => {
			if (stdout.length < MAX_OUTPUT_BYTES) {
				stdout += chunk.toString();
				if (stdout.length >= MAX_OUTPUT_BYTES) {
					truncated = true;
					stdout = stdout.slice(0, MAX_OUTPUT_BYTES);
				}
			}
		});

		proc.stderr.on("data", (chunk: Buffer) => {
			if (stderr.length < MAX_OUTPUT_BYTES) {
				stderr += chunk.toString();
				if (stderr.length >= MAX_OUTPUT_BYTES) {
					truncated = true;
					stderr = stderr.slice(0, MAX_OUTPUT_BYTES);
				}
			}
		});

		proc.on("error", (err) => {
			clearTimeout(timer);
			if (
				(err as NodeJS.ErrnoException).code === "ABORT_ERR" ||
				(err as NodeJS.ErrnoException).name === "AbortError"
			) {
				settle({
					stdout,
					stderr: "Timeout: command exceeded 30s limit.",
					exitCode: 124,
					truncated,
				});
			} else {
				if (!settled) {
					settled = true;
					reject(err);
				}
			}
		});

		proc.on("close", (code) => {
			clearTimeout(timer);
			if (truncated) {
				stdout += `\n[truncated — output exceeded ${MAX_OUTPUT_BYTES} bytes]`;
			}

			const entry = JSON.stringify({
				ts: new Date().toISOString(),
				projectId,
				intent,
				command,
				exitCode: code ?? 1,
			});

			// Append to audit log async — do not block resolution
			appendFile(auditLogPath, `${entry}\n`, "utf-8").catch(console.error);

			settle({ stdout, stderr, exitCode: code ?? 1, truncated });
		});
	});
}
