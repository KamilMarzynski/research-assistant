import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";

export interface BlocklistEntry {
  pattern: RegExp;
  key: string;
  reason: string;
  category: "destructive" | "privilege_escalation" | "exfiltration" | "persistence";
}

const BLOCKLIST: BlocklistEntry[] = [
  {
    pattern: /\brm\s+-rf\b/,
    key: "recursive_delete",
    reason: "This command would recursively delete files without recovery.",
    category: "destructive",
  },
  {
    pattern: /\bsudo\b/,
    key: "sudo",
    reason: "Privilege escalation commands require user review.",
    category: "privilege_escalation",
  },
  {
    pattern: /\bchmod\s+\+x\b/,
    key: "make_executable",
    reason: "Making files executable without review is a security risk.",
    category: "persistence",
  },
  {
    pattern: /\bmkfs\b/,
    key: "format_filesystem",
    reason: "Filesystem formatting is destructive and irreversible.",
    category: "destructive",
  },
  {
    pattern: /\bdd\b\s+if=/,
    key: "raw_disk_io",
    reason: "Raw disk I/O can corrupt data.",
    category: "destructive",
  },
  {
    pattern: /\bcurl\b/,
    key: "curl",
    reason: "Network outbound commands are blocked. Use fetch_url tool instead.",
    category: "exfiltration",
  },
  {
    pattern: /\bwget\b/,
    key: "wget",
    reason: "Network outbound commands are blocked. Use fetch_url tool instead.",
    category: "exfiltration",
  },
  {
    pattern: /\beval\b/,
    key: "eval",
    reason: "Dynamic code execution poses injection risks.",
    category: "persistence",
  },
  {
    pattern: /`/,
    key: "backtick_subshell",
    reason: "Backtick subshells bypass command review.",
    category: "persistence",
  },
  {
    pattern: /\$\(/,
    key: "command_substitution",
    reason: "Command substitution ($(...)) can execute hidden code.",
    category: "persistence",
  },
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

// --- Approval Gate State ---

export interface BlockedCommandPayload {
  commandId: string;
  command: string;
  reason: string;
  category: string;
  key: string;
  projectId: string;
  intent: string;
  timestamp: string;
}

interface BlockedCommandPromise {
  commandId: string;
  options: SafeBashOptions;
  blocklistEntry: BlocklistEntry;
  resolve: (result: SafeBashResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const blockedPromises = new Map<string, BlockedCommandPromise>();
/** Per-project session allowlist: projectId → set of hashed commands. */
const sessionAllowlistByProject = new Map<string, Set<string>>();

function getProjectAllowlist(projectId: string): Set<string> {
  let list = sessionAllowlistByProject.get(projectId);
  if (!list) {
    list = new Set<string>();
    sessionAllowlistByProject.set(projectId, list);
  }
  return list;
}

/** Clear all allowlists — used in tests. */
export function clearAllowlists(): void {
  sessionAllowlistByProject.clear();
}

function hashCommand(command: string): string {
  return createHash("sha256")
    .update(command.trim().toLowerCase().replace(/\s+/g, " "))
    .digest("hex");
}

// --- Interfaces ---

export interface SafeBashOptions {
  command: string;
  intent: string;
  projectId: string;
  workspacePath: string;
  auditLogPath: string;
  timeoutMs?: number;
  emitBlocked?: (payload: BlockedCommandPayload) => void;
}

export interface SafeBashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
}

// --- Internal Execution (after approval) ---

const MAX_OUTPUT_CHARS = 65536;

function runSafeBashInternal(opts: SafeBashOptions): Promise<SafeBashResult> {
  const { command, intent, projectId, workspacePath, auditLogPath, timeoutMs = 30_000 } = opts;

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
      if (Buffer.byteLength(stdout) < MAX_OUTPUT_CHARS) {
        stdout += chunk.toString();
        const byteLen = Buffer.byteLength(stdout);
        if (byteLen >= MAX_OUTPUT_CHARS) {
          truncated = true;
          const buf = Buffer.from(stdout);
          stdout = buf.subarray(0, MAX_OUTPUT_CHARS).toString("utf-8");
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stderr) < MAX_OUTPUT_CHARS) {
        stderr += chunk.toString();
        const byteLen = Buffer.byteLength(stderr);
        if (byteLen >= MAX_OUTPUT_CHARS) {
          truncated = true;
          const buf = Buffer.from(stderr);
          stderr = buf.subarray(0, MAX_OUTPUT_CHARS).toString("utf-8");
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
        stdout += `\n[truncated — output exceeded ${MAX_OUTPUT_CHARS} chars]`;
      }

      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        projectId,
        intent,
        command,
        exitCode: code ?? 1,
      });

      appendFile(auditLogPath, `${entry}\n`, "utf-8").catch((err) => {
        console.error("[safe-bash] audit log append failed:", err);
      });

      settle({ stdout, stderr, exitCode: code ?? 1, truncated });
    });
  });
}

// --- Approval Gate ---

function enterApprovalGate(opts: SafeBashOptions, entry: BlocklistEntry): Promise<SafeBashResult> {
  return new Promise<SafeBashResult>((resolve, reject) => {
    const commandId = randomUUID();

    const timer = setTimeout(() => {
      blockedPromises.delete(commandId);
      reject(
        new BlockedCommandError(`Approval timed out. ${entry.reason}`, commandId, entry.category),
      );
    }, 300_000);

    blockedPromises.set(commandId, {
      commandId,
      options: opts,
      blocklistEntry: entry,
      resolve,
      reject,
      timer,
    });

    if (opts.emitBlocked) {
      opts.emitBlocked({
        commandId,
        command: opts.command,
        reason: entry.reason,
        category: entry.category,
        key: entry.key,
        projectId: opts.projectId,
        intent: opts.intent,
        timestamp: new Date().toISOString(),
      });
    }
  });
}

export function resolveBlockedCommand(
  commandId: string,
  action: "approve_once" | "approve_session" | "deny",
  projectId?: string,
): void {
  const deferred = blockedPromises.get(commandId);
  if (!deferred) return;

  clearTimeout(deferred.timer);
  blockedPromises.delete(commandId);

  if (action === "deny") {
    deferred.reject(
      new BlockedCommandError(
        `Blocked: ${deferred.blocklistEntry.reason}`,
        commandId,
        deferred.blocklistEntry.category,
      ),
    );
    return;
  }

  if (action === "approve_session") {
    const resolvedProjectId = projectId ?? deferred.options.projectId;
    getProjectAllowlist(resolvedProjectId).add(hashCommand(deferred.options.command));
  }

  void runSafeBashInternal(deferred.options).then(deferred.resolve, deferred.reject);
}

// --- Public API ---

export async function runSafeBash(opts: SafeBashOptions): Promise<SafeBashResult> {
  const entry = checkBlocklist(opts.command);

  if (!entry) {
    return runSafeBashInternal(opts);
  }

  if (getProjectAllowlist(opts.projectId).has(hashCommand(opts.command))) {
    return runSafeBashInternal(opts);
  }

  if (opts.emitBlocked) {
    return enterApprovalGate(opts, entry);
  }

  throw new BlockedCommandError(`Blocked: ${entry.reason}`, undefined, entry.category);
}
