import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { ApprovalRequiredError } from "../../services/AllowlistService";
import type { CompressionService } from "../CompressionService";
import type { PathJail } from "../path-jail";

export type SmartReadResult = {
  content: string;
  mimeType: string;
  truncated: boolean;
  hint: string | null;
  totalLines: number;
  lineCount: number;
  fileHash: string;
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

function sha256(content: string): string {
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
): AgentTool<typeof readFileParameters, SmartReadResult> {
  return {
    name: "read_file",
    label: "Read file",
    description:
      "Read the contents of a file with smart pagination and mime detection. You can read any path — use userProjectDir when exploring the user's project.",
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
          if (emitApprovalRequired) {
            emitApprovalRequired({ path: err.path, mode: err.mode, projectId: jail.projectId });
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `Approval required for ${err.mode} on "${err.path}". Waiting for user approval.`,
              },
            ],
            details: {
              content: "",
              mimeType: "text/plain",
              truncated: false,
              hint: null,
              totalLines: 0,
              lineCount: 0,
              fileHash: "",
            },
          };
        }
        throw err;
      }
      const buffer = await readFile(resolved);
      const fileHash = createHash("sha256").update(buffer).digest("hex");

      const ext = extname(resolved).slice(1);
      const mimeType = getMimeType(ext);

      if (isBinaryMimeType(mimeType)) {
        const placeholder = `[Binary file: ${resolved} (${mimeType})]`;
        return {
          content: [{ type: "text" as const, text: placeholder }],
          details: {
            content: placeholder,
            mimeType,
            truncated: false,
            hint: `Binary file (${mimeType}). Cannot read as text.`,
            totalLines: 0,
            lineCount: 0,
            fileHash,
          },
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
      } else if (sLine > totalLines) {
        hint = `File has ${totalLines} lines. startLine exceeds total.`;
      }

      if (compressionService) {
        const compressed = await compressionService.compress("read_file", content);
        content = compressed.content;
        if (compressed.wasCompressed) {
          const note = `Content compressed via ${compressed.strategy}.`;
          hint = hint ? `${hint} ${note}` : note;
        }
      }

      const lineCount = content === "" ? 0 : content.split("\n").length;
      const fileName = basename(resolved);

      return {
        content: [
          {
            type: "text" as const,
            text: `Read ${lineCount} lines of ${fileName} (${mimeType}). Total: ${totalLines.toLocaleString()} lines.`,
          },
        ],
        details: {
          content,
          mimeType,
          truncated,
          hint,
          totalLines,
          lineCount,
          fileHash,
        },
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
  }) => void,
): AgentTool<typeof writeFileParameters, null> {
  return {
    name: "write_file",
    label: "Write file",
    description:
      "Write content to a file, creating parent directories as needed. Write to userProjectDir for artifacts and project files. Write to assistantDir for project metadata (GOAL.md, FILES.md, skills). Writing to ~/.scholar/skills requires user approval.",
    parameters: writeFileParameters,
    execute: async (
      _id,
      { path, content, start_line, end_line, expected_hash },
    ): Promise<AgentToolResult<null>> => {
      let resolved: string;
      try {
        resolved = jail.validate(path, "write");
      } catch (err) {
        if (err instanceof ApprovalRequiredError) {
          if (emitApprovalRequired) {
            emitApprovalRequired({ path: err.path, mode: err.mode, projectId: jail.projectId });
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `Approval required for ${err.mode} on "${err.path}". Waiting for user approval.`,
              },
            ],
            details: null,
          };
        }
        throw err;
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
      const currentHash = sha256(existingContent);

      if (expected_hash !== undefined && expected_hash !== currentHash) {
        return {
          content: [
            {
              type: "text" as const,
              text: `File changed since last read. Current hash: ${currentHash}. Re-read file and retry.`,
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
          if (emitApprovalRequired) {
            emitApprovalRequired({ path: err.path, mode: err.mode, projectId: jail.projectId });
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `Approval required for ${err.mode} on "${err.path}". Waiting for user approval.`,
              },
            ],
            details: [],
          };
        }
        throw err;
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
