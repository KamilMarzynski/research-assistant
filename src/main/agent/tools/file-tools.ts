import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { AllowlistService } from "../../services/AllowlistService";
import { ApprovalRequiredError } from "../../services/AllowlistService";
import type { CompressionService } from "../CompressionService";
import { enterPathApprovalGate } from "../extensions/path-approval";
import type { PathJail } from "../path-jail";

export type SmartReadResult = {
  path: string;
  mimeType: string;
  sha256: string;
  totalLines: number;
  startLine: number | null;
  endLine: number | null;
  linesReturned: number;
  truncated: boolean;
  hint: string | null;
  content: string | null;
  isBinary?: true;
};

const MAX_BYTES = 500 * 1024;

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    csv: "text/csv",
    md: "text/markdown",
    markdown: "text/markdown",
    ts: "text/typescript",
    tsx: "text/tsx",
    js: "text/javascript",
    jsx: "text/jsx",
    json: "application/json",
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    py: "text/x-python",
    sh: "text/x-sh",
    yaml: "text/yaml",
    yml: "text/yaml",
    sql: "text/x-sql",
    txt: "text/plain",
    png: "image/png",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

function isBinaryMimeType(mime: string): boolean {
  if (mime === "application/octet-stream") return true;
  if (mime.includes("image/")) return true;
  if (mime.includes("video/")) return true;
  if (mime.includes("audio/")) return true;
  if (mime.includes("application/pdf")) return true;
  return false;
}

function hashString(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function applyLineEdit(
  lines: string[],
  startLine: number | undefined,
  endLine: number | undefined,
  content: string,
): { lines: string[] } | { error: string } {
  const newLines = content.split("\n");

  if (startLine === undefined) {
    return { lines: newLines };
  }

  if (startLine < 1) {
    return { error: "start_line must be >= 1" };
  }

  if (endLine !== undefined && endLine < startLine) {
    return { error: "end_line must be >= start_line" };
  }

  const zeroStart = startLine - 1;

  if (endLine === undefined) {
    // Insert mode: insert content at start_line, shift existing lines down
    const before = lines.slice(0, zeroStart);
    const after = lines.slice(zeroStart);
    return { lines: [...before, ...newLines, ...after] };
  }

  // Replace mode: replace lines [startLine, endLine] inclusive
  const zeroEnd = endLine - 1;
  const before = lines.slice(0, zeroStart);
  const after = lines.slice(zeroEnd + 1);
  return { lines: [...before, ...newLines, ...after] };
}

export function createReadFileTool(
  jail: PathJail,
  compressionService?: CompressionService,
  emitApprovalRequired?: (payload: {
    path: string;
    mode: "read" | "write";
    projectId: string;
  }) => void,
  allowlistService?: AllowlistService,
  shouldBypassApproval?: (projectId: string) => Promise<boolean>,
): AgentTool<typeof readFileParameters, SmartReadResult> {
  return {
    name: "read_file",
    label: "Read file",
    description:
      "Read a file. Returns a JSON object with `path`, `mimeType`, `sha256`, `totalLines`, `startLine`, `endLine`, `linesReturned`, `truncated`, `hint`, `content`. " +
      "Use `sha256` directly as `expected_hash` when calling `write_file`. Paginate with `startLine`/`maxLines`; check `truncated` and follow `hint` to read more. " +
      "Use `userProjectDir` when exploring the user's project. Always read before editing — never compute hashes via `safe_bash`.",
    parameters: readFileParameters,
    execute: async (
      _id,
      { path, startLine, maxLines },
    ): Promise<AgentToolResult<SmartReadResult>> => {
      let resolved: string;
      try {
        resolved = jail.validate(path, "read");
      } catch (err) {
        if (err instanceof ApprovalRequiredError) {
          if (
            await shouldBypassPathApproval(
              jail.projectId,
              err,
              allowlistService,
              shouldBypassApproval,
            )
          ) {
            resolved = jail.validate(path, "read");
          } else {
            if (emitApprovalRequired) {
              emitApprovalRequired({ path: err.path, mode: err.mode, projectId: jail.projectId });
            }
            const { approved, denyReason } = await enterPathApprovalGate(
              jail.projectId,
              err.path,
              err.mode,
            );
            if (!approved) {
              const feedback = denyReason ? ` ${denyReason}` : "";
              const deniedExt = extname(err.path).slice(1);
              const deniedMimeType = getMimeType(deniedExt);
              const deniedIsBinary = isBinaryMimeType(deniedMimeType);
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `User did not approve access to "${err.path}". Choose a different path or ask the user to allow it.${feedback}`,
                  },
                ],
                details: {
                  path: err.path,
                  mimeType: deniedIsBinary ? deniedMimeType : "text/plain",
                  sha256: "",
                  totalLines: 0,
                  startLine: null,
                  endLine: null,
                  linesReturned: 0,
                  truncated: false,
                  hint: null,
                  content: deniedIsBinary ? null : "",
                  isBinary: deniedIsBinary ? true : undefined,
                },
              };
            }
            resolved = jail.validate(path, "read");
          }
        } else {
          throw err;
        }
      }
      const buffer = await readFile(resolved);
      const sha256 = createHash("sha256").update(buffer).digest("hex");

      const ext = extname(resolved).slice(1);
      const mimeType = getMimeType(ext);

      if (isBinaryMimeType(mimeType)) {
        const payload: SmartReadResult = {
          path: resolved,
          mimeType,
          sha256,
          isBinary: true,
          totalLines: 0,
          startLine: null,
          endLine: null,
          linesReturned: 0,
          truncated: false,
          hint: `Binary file (${mimeType}). Cannot read as text.`,
          content: null,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          details: payload,
        };
      }

      const fullText = buffer.toString("utf-8");
      const allLines =
        fullText === "" ? [] : fullText.split("\n").map((line) => line.replace(/\r$/, ""));
      if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
        allLines.pop();
      }
      const totalLines = allLines.length;

      const sLine = Math.max(1, startLine ?? 1);
      const mLines = Math.max(1, maxLines ?? 500);
      const selectedLines = allLines.slice(sLine - 1, sLine - 1 + mLines);
      let content = selectedLines.join("\n");
      let truncated = false;
      let hint: string | null = null;

      const contentBuffer = Buffer.from(content, "utf-8");
      if (contentBuffer.length > MAX_BYTES) {
        content = contentBuffer.subarray(0, MAX_BYTES).toString("utf-8");
        truncated = true;
        const returnedLines = content === "" ? 0 : content.split("\n").length;
        hint = `Returned lines ${sLine}-${sLine + returnedLines - 1} of ${totalLines} (content truncated to 500KB). Use startLine=${sLine + returnedLines} to read more.`;
      } else if (totalLines > mLines && selectedLines.length > 0) {
        truncated = true;
        hint = `Returned lines ${sLine}-${sLine + selectedLines.length - 1} of ${totalLines}. Use startLine=${sLine + selectedLines.length} to read more.`;
      } else if (sLine > totalLines && totalLines > 0) {
        hint = `File has ${totalLines} lines. startLine ${sLine} exceeds total.`;
      }

      if (compressionService) {
        const compressed = await compressionService.compress("read_file", content);
        content = compressed.content;
        if (compressed.wasCompressed) {
          const note = `Content summarized (too large). Use read_file with startLine/maxLines to read specific sections of this file.`;
          hint = hint ? `${hint} ${note}` : note;
        }
      }

      const linesReturned = content === "" ? 0 : content.split("\n").length;

      let startLineResult: number | null;
      let endLineResult: number | null;

      if (totalLines === 0) {
        startLineResult = null;
        endLineResult = null;
        hint = null;
      } else if (sLine > totalLines) {
        startLineResult = null;
        endLineResult = null;
      } else {
        startLineResult = sLine;
        endLineResult = sLine + linesReturned - 1;
      }

      const payload: SmartReadResult = {
        path: resolved,
        mimeType,
        sha256,
        totalLines,
        startLine: startLineResult,
        endLine: endLineResult,
        linesReturned,
        truncated,
        hint,
        content,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        details: payload,
      };
    },
  };
}

const readFileParameters = Type.Object({
  path: Type.String({ description: "Absolute path to the file" }),
  startLine: Type.Optional(Type.Integer({ description: "Starting line (1-based)", default: 1 })),
  maxLines: Type.Optional(Type.Integer({ description: "Maximum lines to return", default: 500 })),
});

export function createWriteFileTool(
  jail: PathJail,
  folderPath: string | null,
  onFileWrite?: (absolutePath: string, relativePath: string, fileName: string) => void,
  emitApprovalRequired?: (payload: {
    path: string;
    mode: "read" | "write";
    projectId: string;
    intent?: string;
  }) => void,
  allowlistService?: AllowlistService,
  shouldBypassApproval?: (projectId: string) => Promise<boolean>,
): AgentTool<typeof writeFileParameters, null> {
  return {
    name: "write_file",
    label: "Write file",
    description:
      "Write or edit a file. " +
      "Write research outputs and artifacts to userProjectDir; write project metadata (GOAL.md, FILES.md) to assistantProjectDir. " +
      "Use meaningful filenames — no task IDs, no UUIDs. Follow FILES.md conventions if they exist. " +
      "State your intent — it is shown to the user when approval is needed.",
    parameters: writeFileParameters,
    execute: async (
      _id,
      { path, content, intent, start_line, end_line, expected_hash },
    ): Promise<AgentToolResult<null>> => {
      let resolved: string;
      try {
        resolved = jail.validate(path, "write");
      } catch (err) {
        if (err instanceof ApprovalRequiredError) {
          if (
            await shouldBypassPathApproval(
              jail.projectId,
              err,
              allowlistService,
              shouldBypassApproval,
            )
          ) {
            resolved = jail.validate(path, "write");
          } else {
            if (emitApprovalRequired) {
              emitApprovalRequired({
                path: err.path,
                mode: err.mode,
                projectId: jail.projectId,
                intent,
              });
            }
            const { approved, denyReason } = await enterPathApprovalGate(
              jail.projectId,
              err.path,
              err.mode,
            );
            if (!approved) {
              const feedback = denyReason ? ` ${denyReason}` : "";
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `User did not approve access to "${err.path}". Choose a different path or ask the user to allow it.${feedback}`,
                  },
                ],
                details: null,
              };
            }
            resolved = jail.validate(path, "write");
          }
        } else {
          throw err;
        }
      }
      const fileExists = await access(resolved).then(
        () => true,
        () => false,
      );

      if (end_line !== undefined && start_line === undefined) {
        return {
          content: [{ type: "text" as const, text: `end_line requires start_line` }],
          details: null,
        };
      }

      if (!fileExists) {
        if (expected_hash !== undefined) {
          return {
            content: [{ type: "text" as const, text: `Cannot provide expected_hash for new file` }],
            details: null,
          };
        }
        if (start_line !== undefined || end_line !== undefined) {
          return {
            content: [{ type: "text" as const, text: `Line ranges not valid for new files` }],
            details: null,
          };
        }

        const dir = dirname(resolved);
        await mkdir(dir, { recursive: true });
        await writeFile(resolved, content, "utf-8");

        if (folderPath && onFileWrite) {
          const normalizedFolder = folderPath.replace(/\/$/, "");
          if (resolved.startsWith(`${normalizedFolder}/`)) {
            const relativePath = resolved.slice(normalizedFolder.length + 1);
            const fileName = resolved.split("/").pop() || relativePath;
            onFileWrite(resolved, relativePath, fileName);
          }
        }

        return {
          content: [{ type: "text" as const, text: `Written: ${resolved}` }],
          details: null,
        };
      }

      // File exists
      const existingContent = await readFile(resolved, "utf-8");
      const currentHash = hashString(existingContent);

      if (expected_hash === undefined) {
        return {
          content: [
            {
              type: "text" as const,
              text: "expected_hash is required when writing an existing file. Re-read file and retry with the sha256 returned by read_file.",
            },
          ],
          details: null,
        };
      }

      if (expected_hash !== undefined && expected_hash !== currentHash) {
        return {
          content: [
            {
              type: "text" as const,
              text: "File changed since last read. Re-read file and retry with the sha256 returned by read_file.",
            },
          ],
          details: null,
        };
      }

      const lines = existingContent.split("\n");
      const editResult = applyLineEdit(lines, start_line, end_line, content);
      if ("error" in editResult) {
        return {
          content: [{ type: "text" as const, text: editResult.error }],
          details: null,
        };
      }
      const newContent = editResult.lines.join("\n");

      await writeFile(resolved, newContent, "utf-8");

      if (folderPath && onFileWrite) {
        const normalizedFolder = folderPath.replace(/\/$/, "");
        if (resolved.startsWith(`${normalizedFolder}/`)) {
          const relativePath = resolved.slice(normalizedFolder.length + 1);
          const fileName = resolved.split("/").pop() || relativePath;
          onFileWrite(resolved, relativePath, fileName);
        }
      }

      let actionText: string;
      if (start_line !== undefined && end_line !== undefined) {
        actionText = `Edited: ${resolved} (lines ${start_line}-${end_line})`;
      } else if (start_line !== undefined) {
        actionText = `Inserted: ${resolved} at line ${start_line}`;
      } else {
        actionText = `Written: ${resolved}`;
      }

      return {
        content: [{ type: "text" as const, text: actionText }],
        details: null,
      };
    },
  };
}

const writeFileParameters = Type.Object({
  path: Type.String({ description: "Absolute path to the file" }),
  intent: Type.String({
    description:
      "What you are trying to accomplish with this write — shown to the user when approval is needed.",
  }),
  content: Type.String({ description: "Content to write" }),
  start_line: Type.Optional(
    Type.Integer({
      description:
        "1-based line number to insert at or start replacement. Existing line at this position shifts down if end_line is omitted.",
    }),
  ),
  end_line: Type.Optional(
    Type.Integer({
      description:
        "1-based inclusive line number to end replacement. If omitted with start_line, inserts at start_line without replacing any lines.",
    }),
  ),
  expected_hash: Type.Optional(
    Type.String({
      description:
        "SHA-256 hash of current file contents (as agent last saw it). Required when editing existing files to prevent overwriting concurrent changes.",
    }),
  ),
});

export function createListDirTool(
  jail: PathJail,
  emitApprovalRequired?: (payload: {
    path: string;
    mode: "read" | "write";
    projectId: string;
  }) => void,
  allowlistService?: AllowlistService,
  shouldBypassApproval?: (projectId: string) => Promise<boolean>,
): AgentTool<typeof listDirParameters, string[]> {
  return {
    name: "list_dir",
    label: "List directory",
    description:
      "List files and subdirectories in a directory. You can list any path — use userProjectDir when exploring the user's project.",
    parameters: listDirParameters,
    execute: async (_id, { path }): Promise<AgentToolResult<string[]>> => {
      let resolved: string;
      try {
        resolved = jail.validate(path, "read");
      } catch (err) {
        if (err instanceof ApprovalRequiredError) {
          if (
            await shouldBypassPathApproval(
              jail.projectId,
              err,
              allowlistService,
              shouldBypassApproval,
            )
          ) {
            resolved = jail.validate(path, "read");
          } else {
            if (emitApprovalRequired) {
              emitApprovalRequired({ path: err.path, mode: err.mode, projectId: jail.projectId });
            }
            const { approved, denyReason } = await enterPathApprovalGate(
              jail.projectId,
              err.path,
              err.mode,
            );
            if (!approved) {
              const feedback = denyReason ? ` ${denyReason}` : "";
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `User did not approve access to "${err.path}". Choose a different path or ask the user to allow it.${feedback}`,
                  },
                ],
                details: [],
              };
            }
            resolved = jail.validate(path, "read");
          }
        } else {
          throw err;
        }
      }
      const entries = await readdir(resolved, { withFileTypes: true });
      const lines = entries.map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`);
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: entries.map((e) => e.name),
      };
    },
  };
}

const listDirParameters = Type.Object({
  path: Type.String({ description: "Absolute path to the directory" }),
});

async function shouldBypassPathApproval(
  projectId: string,
  error: ApprovalRequiredError,
  allowlistService?: AllowlistService,
  shouldBypassApproval?: (projectId: string) => Promise<boolean>,
): Promise<boolean> {
  if (!allowlistService || !shouldBypassApproval) {
    return false;
  }

  if (!(await shouldBypassApproval(projectId))) {
    return false;
  }

  allowlistService.approveSession(projectId, error.path, error.mode);
  return true;
}
