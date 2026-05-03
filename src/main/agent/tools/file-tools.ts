import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { PathJail } from "../path-jail";
import { makeTool } from "./make-tool";

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

export function createReadFileTool(
  jail: PathJail,
): AgentTool<typeof readFileParameters, SmartReadResult> {
  return makeTool({
    name: "read_file",
    label: "Read file",
    description:
      "Read the contents of a file with smart pagination and mime detection. Path must be within the workspace or linked project folder.",
    parameters: readFileParameters,
    execute: async (
      _id,
      { path, startLine, maxLines },
    ): Promise<AgentToolResult<SmartReadResult>> => {
      const resolved = jail.validate(path, "read");
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
  });
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
): AgentTool<typeof writeFileParameters, null> {
  return makeTool({
    name: "write_file",
    label: "Write file",
    description:
      "Write content to a file, creating parent directories as needed. Path must be within the workspace or linked project folder.",
    parameters: writeFileParameters,
    execute: async (_id, { path, content }): Promise<AgentToolResult<null>> => {
      const resolved = jail.validate(path, "write");
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
    },
  });
}

const writeFileParameters = Type.Object({
  path: Type.String({ description: "Absolute path to the file" }),
  content: Type.String({ description: "Content to write" }),
});

export function createListDirTool(jail: PathJail): AgentTool<typeof listDirParameters, string[]> {
  return makeTool({
    name: "list_dir",
    label: "List directory",
    description:
      "List files and subdirectories in a directory. Path must be within the workspace or linked project folder.",
    parameters: listDirParameters,
    execute: async (_id, { path }): Promise<AgentToolResult<string[]>> => {
      const resolved = jail.validate(path, "read");
      const entries = await readdir(resolved, { withFileTypes: true });
      const lines = entries.map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`);
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: entries.map((e) => e.name),
      };
    },
  });
}

const listDirParameters = Type.Object({
  path: Type.String({ description: "Absolute path to the directory" }),
});
