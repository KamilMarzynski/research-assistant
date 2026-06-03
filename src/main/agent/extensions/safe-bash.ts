import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";

export interface BlockedResult {
  key: string;
  reason: string;
  category:
    | "destructive"
    | "privilege_escalation"
    | "exfiltration"
    | "persistence"
    | "unsafe_operator"
    | "unknown_binary";
}

export interface InlineCodeHint {
  detected: true;
  language: "python" | "javascript" | "typescript";
  reason: string;
}

const ALLOWED_BINARIES = new Set([
  "ls",
  "cat",
  "grep",
  "find",
  "head",
  "tail",
  "wc",
  "sort",
  "uniq",
  "mkdir",
  "touch",
  "cp",
  "mv",
  "ln",
  "echo",
  "date",
  "which",
  "git",
  "node",
  "python3",
  "python",
  "bun",
  "npm",
  "npx",
  "sed",
  "awk",
  "cut",
  "tr",
  "tee",
  "diff",
  "xargs",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "file",
  "stat",
  "du",
  "df",
  "chmod",
  "chown",
  "tar",
  "gzip",
  "gunzip",
  "zip",
  "unzip",
]);

// Safe shell builtins that are OK to use in bash -c strings
const ALLOWED_BUILTINS = new Set([
  "exit",
  "sleep",
  "cd",
  "pwd",
  "env",
  "export",
  "source",
  "true",
  "false",
  "test",
  "[",
]);

const INTERPRETER_META: Record<
  string,
  { language: InlineCodeHint["language"]; flagReason: string; replReason: string }
> = {
  python3: { language: "python", flagReason: "python3 -c flag", replReason: "interactive REPL" },
  python: { language: "python", flagReason: "python -c flag", replReason: "interactive REPL" },
  node: { language: "javascript", flagReason: "node -e flag", replReason: "interactive REPL" },
  bun: { language: "typescript", flagReason: "bun -e flag", replReason: "interactive REPL" },
};

const SCRIPT_INTERPRETERS = new Set(["python3", "python", "node", "bun"]);

const BUN_SUBCOMMANDS = new Set([
  "install",
  "run",
  "add",
  "remove",
  "update",
  "link",
  "unlink",
  "test",
  "build",
  "init",
  "create",
  "x",
  "pm",
]);

export interface FileExecutionHint {
  detected: true;
  interpreter: string;
  reason: string;
}

export function detectFileExecution(command: string): FileExecutionHint | null {
  const stripped = stripRedirects(command).trim();
  if (!stripped) return null;

  const tokens = tokenize(stripped);
  if (tokens.length < 2) return null;

  const rawBinary = tokens[0].split("/").pop() ?? tokens[0];
  // Normalize python3.11, python3.12 → "python3"
  const binary = /^python3(\.\d+)?$/.test(rawBinary) ? "python3" : rawBinary;

  if (!SCRIPT_INTERPRETERS.has(binary)) return null;

  let i = 1;
  let hasModuleFlag = false;
  let hasSeenPositional = false;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.startsWith("-")) {
      if (token === "-m" || token === "--module") hasModuleFlag = true;
      // VALUE_FLAGS consume the next token as their value — skip both
      const flagKey = token.includes("=") ? token.split("=")[0] : token;
      if (VALUE_FLAGS.has(flagKey) && !token.includes("=")) {
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // First positional argument reached

    // python3 -m <module>: not file execution
    if (hasModuleFlag && (binary === "python3" || binary === "python")) {
      return null;
    }

    // bun subcommands (bun install, bun test, bun run, etc.): not file execution
    // Check on first positional arg regardless of index (global flags may precede it)
    if (binary === "bun" && !hasSeenPositional && BUN_SUBCOMMANDS.has(token)) {
      return null;
    }

    hasSeenPositional = true;

    // Positional arg to any other interpreter = file execution
    return {
      detected: true,
      interpreter: rawBinary,
      reason: `${rawBinary} file argument: "${token}"`,
    };
  }

  return null;
}

// Dangerous commands always blocked
const DANGEROUS_COMMANDS = [
  {
    pattern: /\bsudo\b/,
    key: "sudo",
    reason: "Privilege escalation.",
    category: "privilege_escalation" as const,
  },
  {
    pattern: /\bsu\b(?=\s)/,
    key: "su",
    reason: "Privilege escalation.",
    category: "privilege_escalation" as const,
  },
  {
    pattern: /\bmkfs\b/,
    key: "mkfs",
    reason: "Filesystem formatting.",
    category: "destructive" as const,
  },
  { pattern: /\bdd\b/, key: "dd", reason: "Raw disk I/O.", category: "destructive" as const },
  {
    pattern: /\bcurl\b/,
    key: "curl",
    reason: "Network outbound. Use fetch_url instead.",
    category: "exfiltration" as const,
  },
  {
    pattern: /\bwget\b/,
    key: "wget",
    reason: "Network outbound. Use fetch_url instead.",
    category: "exfiltration" as const,
  },
  {
    pattern: /\beval\b/,
    key: "eval",
    reason: "Dynamic code execution.",
    category: "persistence" as const,
  },
];

/**
 * Strip shell redirects so they don't interfere with binary extraction.
 * Handles: 2>&1, &>, &>>, >, >>, <, <<<
 */
function stripRedirects(command: string): string {
  // Remove redirect operators and their targets
  let cleaned = command;
  // Remove 2>&1 style
  cleaned = cleaned.replace(/\d*>&\d*/g, "");
  // Remove &> and &>> with target
  cleaned = cleaned.replace(/&>>?\s*\S+/g, "");
  // Remove >>, > with target (including fd-prefixed like 2> file)
  cleaned = cleaned.replace(/\d*>>?\s*\S+/g, "");
  cleaned = cleaned.replace(/<<?\s*\S+/g, "");
  return cleaned.trim();
}

/**
 * Check if a command string contains shell operators (;, |, &) in unquoted positions.
 * We consider text outside of single-quoted regions as unquoted.
 */
/**
 * Simple quote-aware tokenizer for shell-like command strings.
 * Handles unquoted words, double-quoted strings, and single-quoted strings.
 */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let match: RegExpExecArray | null = null;
  match = regex.exec(command);
  while (match !== null) {
    tokens.push(match[1] ?? match[2] ?? match[0]);
    match = regex.exec(command);
  }
  return tokens;
}

const VALUE_FLAGS = new Set(["-c", "--command", "-e", "--eval", "-p", "--print"]);

export function detectInlineCode(command: string): InlineCodeHint | null {
  const stripped = stripRedirects(command).trim();
  if (!stripped) return null;

  const tokens = tokenize(stripped);
  if (tokens.length === 0) return null;

  const binary = tokens[0].split("/").pop() ?? tokens[0];

  const isPython = binary === "python3" || binary === "python" || /^python3\.\d+$/.test(binary);
  const isNode = binary === "node" || binary === "node.exe";
  const isBun = binary === "bun";

  if (!isPython && !isNode && !isBun) {
    return null;
  }

  let hasCodeFlag = false;
  let i = 1;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.startsWith("-")) {
      const flag = token.includes("=") ? token.split("=")[0] : token;
      if (VALUE_FLAGS.has(flag)) {
        hasCodeFlag = true;
        if (token.includes("=")) {
          i += 1;
        } else {
          i += 2;
        }
        continue;
      }
      i += 1;
      continue;
    }
    // Any non-flag token is a positional argument → not inline code
    return null;
  }

  const metaKey = isPython ? (binary === "python" ? "python" : "python3") : isNode ? "node" : "bun";
  const meta = INTERPRETER_META[metaKey];

  if (hasCodeFlag) {
    return { detected: true, language: meta.language, reason: meta.flagReason };
  }

  return { detected: true, language: meta.language, reason: meta.replReason };
}

function hasUnsafeOperators(command: string): boolean {
  // Remove single-quoted strings (they are safe)
  const withoutSingleQuotes = command.replace(/'[^']*'/g, "");
  // Check for dangerous operators in remaining text
  return /[;|&]/.test(withoutSingleQuotes);
}

/**
 * Extract the first binary name from a command string.
 * Strips leading variable assignments (VAR=val), then takes the first word.
 * Strips any leading path components (e.g., /usr/bin/ls → ls).
 */
function extractBinary(command: string): string | null {
  const cleaned = stripRedirects(command).trim();
  if (!cleaned) return null;

  // Strip ALL leading variable assignments (FOO=bar VAR=val)
  let withoutVars = cleaned;
  let prev = "";
  while (prev !== withoutVars) {
    prev = withoutVars;
    withoutVars = withoutVars.replace(/^\s*\w+=\S+\s*/, "").trim();
  }
  if (!withoutVars) return null;

  // Tokenize and skip env/VAR=val passthroughs to find the real binary
  const tokens = tokenize(withoutVars);
  if (tokens.length === 0) return null;

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === "env" || /^\w+=/.test(token)) {
      i++;
      continue;
    }
    break;
  }

  // All tokens were env/VAR=val — fall back to first token
  const binary = i < tokens.length ? tokens[i] : tokens[0];

  // Strip path prefix
  return binary.split("/").pop() ?? binary;
}

export function checkCommand(command: string): BlockedResult | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  // Strip redirects so they don't trigger operator detection
  const withoutRedirects = stripRedirects(trimmed);

  // 1. Check for unsafe shell operators (on redirect-stripped text)
  if (hasUnsafeOperators(withoutRedirects)) {
    return {
      key: "unsafe_operator",
      reason: "Command contains shell operators (;, |, &) which can chain commands.",
      category: "unsafe_operator",
    };
  }

  // 2. Check dangerous commands patterns (on full command text to catch everything)
  for (const entry of DANGEROUS_COMMANDS) {
    if (entry.pattern.test(trimmed)) {
      return {
        key: entry.key,
        reason: entry.reason,
        category: entry.category,
      };
    }
  }

  // 3. Check for $() / backticks (on full command text)
  if (/\$\(/.test(trimmed)) {
    return {
      key: "command_substitution",
      reason: "Command substitution ($(...)) can execute hidden code.",
      category: "persistence",
    };
  }
  if (/`/.test(trimmed)) {
    return {
      key: "backtick_subshell",
      reason: "Backtick subshells bypass command review.",
      category: "persistence",
    };
  }

  // 4. Extract binary and check against allowlist (on redirect-stripped text)
  const binary = extractBinary(trimmed);
  if (binary && !ALLOWED_BINARIES.has(binary) && !ALLOWED_BUILTINS.has(binary)) {
    return {
      key: "unknown_binary",
      reason: `Binary "${binary}" is not in the allowed list. Only known-safe binaries are permitted.`,
      category: "unknown_binary",
    };
  }

  return null;
}

// Re-export checkCommand as checkBlocklist for backward compatibility in tests
export { checkCommand as checkBlocklist };

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
  blockedResult: BlockedResult;
  resolve: (result: SafeBashResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Per-project blocked promises: projectId -> commandId -> deferred. */
const blockedPromises = new Map<string, Map<string, BlockedCommandPromise>>();
/** Reverse index for O(1) commandId -> projectId lookup during resolution. */
const commandProjectIndex = new Map<string, string>();
/** Per-project session allowlist: projectId -> set of hashed commands. */
const sessionAllowlistByProject = new Map<string, Set<string>>();

function getProjectAllowlist(projectId: string): Set<string> {
  let list = sessionAllowlistByProject.get(projectId);
  if (!list) {
    list = new Set<string>();
    sessionAllowlistByProject.set(projectId, list);
  }
  return list;
}

/** Clear all allowlists -- used in tests. */
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
  shouldBypassApproval?: (projectId: string) => Promise<boolean>;
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
        stdout += `\n[truncated -- output exceeded ${MAX_OUTPUT_CHARS} chars]`;
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

function enterApprovalGate(opts: SafeBashOptions, result: BlockedResult): Promise<SafeBashResult> {
  return new Promise<SafeBashResult>((resolve, reject) => {
    const commandId = randomUUID();

    const timer = setTimeout(() => {
      blockedPromises.get(opts.projectId)?.delete(commandId);
      commandProjectIndex.delete(commandId);
      reject(
        new BlockedCommandError(`Approval timed out. ${result.reason}`, commandId, result.category),
      );
    }, 300_000);

    let projectMap = blockedPromises.get(opts.projectId);
    if (!projectMap) {
      projectMap = new Map();
      blockedPromises.set(opts.projectId, projectMap);
    }
    projectMap.set(commandId, {
      commandId,
      options: opts,
      blockedResult: result,
      resolve,
      reject,
      timer,
    });
    commandProjectIndex.set(commandId, opts.projectId);

    if (opts.emitBlocked) {
      opts.emitBlocked({
        commandId,
        command: opts.command,
        reason: result.reason,
        category: result.category,
        key: result.key,
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
  denyReason?: string,
): void {
  const resolvedProjectId = projectId ?? commandProjectIndex.get(commandId);
  if (!resolvedProjectId) return;

  const projectMap = blockedPromises.get(resolvedProjectId);
  if (!projectMap) return;

  const deferred = projectMap.get(commandId);
  if (!deferred) return;

  clearTimeout(deferred.timer);
  projectMap.delete(commandId);
  commandProjectIndex.delete(commandId);
  if (projectMap.size === 0) blockedPromises.delete(resolvedProjectId);

  if (action === "deny") {
    const msg = denyReason
      ? `Denied by user: ${denyReason}`
      : `Blocked: ${deferred.blockedResult.reason}`;
    deferred.reject(new BlockedCommandError(msg, commandId, deferred.blockedResult.category));
    return;
  }

  if (action === "approve_session") {
    const resolvedProjectId = projectId ?? deferred.options.projectId;
    getProjectAllowlist(resolvedProjectId).add(hashCommand(deferred.options.command));
  }

  void runSafeBashInternal(deferred.options).then(deferred.resolve, deferred.reject);
}

export function resolvePendingBlockedCommandsForProject(
  projectId: string,
  action: "approve_once" | "approve_session" = "approve_once",
): number {
  const projectMap = blockedPromises.get(projectId);
  if (!projectMap) return 0;

  const commandIds = Array.from(projectMap.keys());

  for (const commandId of commandIds) {
    resolveBlockedCommand(commandId, action, projectId);
  }

  return commandIds.length;
}

// --- Public API ---

function buildFileExecutionHint(interpreter: string): string {
  const normalizedBin = /^python3/.test(interpreter) ? "python3" : interpreter;
  const langMap: Record<string, string> = {
    python3: "python",
    python: "python",
    node: "javascript",
    bun: "typescript",
  };
  const language = langMap[normalizedBin] ?? "python";
  const example = { tool: "execute_code", language, code: "<paste file contents here>" };
  return [
    `Script file execution detected (${interpreter} <file>).`,
    "For security, running script files is not allowed in safe_bash.",
    "Use execute_code with the script contents instead.",
    "",
    "Example:",
    JSON.stringify(example, null, 2),
  ].join("\n");
}

function buildInlineCodeHint(hint: InlineCodeHint): string {
  const example = {
    tool: "execute_code",
    language: hint.language,
    code: "<your code here>",
  };
  return [
    `Inline ${hint.language} code execution detected (${hint.reason}).`,
    "For security, inline code execution is not allowed in safe_bash.",
    "Please use execute_code instead.",
    "",
    "Example:",
    JSON.stringify(example, null, 2),
  ].join("\n");
}

export async function runSafeBash(opts: SafeBashOptions): Promise<SafeBashResult> {
  const inlineHint = detectInlineCode(opts.command);
  if (inlineHint) {
    return {
      exitCode: 1,
      stderr: "",
      truncated: false,
      stdout: buildInlineCodeHint(inlineHint),
    };
  }

  const fileHint = detectFileExecution(opts.command);
  if (fileHint) {
    return {
      exitCode: 1,
      stderr: "",
      truncated: false,
      stdout: buildFileExecutionHint(fileHint.interpreter),
    };
  }

  const entry = checkCommand(opts.command);

  if (!entry) {
    return runSafeBashInternal(opts);
  }

  if (getProjectAllowlist(opts.projectId).has(hashCommand(opts.command))) {
    return runSafeBashInternal(opts);
  }

  if (opts.shouldBypassApproval && (await opts.shouldBypassApproval(opts.projectId))) {
    return runSafeBashInternal(opts);
  }

  if (opts.emitBlocked) {
    return enterApprovalGate(opts, entry);
  }

  throw new BlockedCommandError(`Blocked: ${entry.reason}`, undefined, entry.category);
}
