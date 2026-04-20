import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";

const BLOCKLIST_PATTERNS = [
  /\brm\s+-rf\b/,
  /\bsudo\b/,
  /\bchmod\s+\+x\b/,
  /\bmkfs\b/,
  /\bdd\b\s+if=/,
  /\bcurl\b/,
  /\bwget\b/,
  /\beval\b/,
  /`/,
  /\$\(/,
];

export function checkBlocklist(command: string): void {
  for (const pattern of BLOCKLIST_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(
        `Command blocked by safe_bash policy (matched: ${pattern.toString()}). Use a safer alternative or request a skill.`,
      );
    }
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

  checkBlocklist(command);

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
