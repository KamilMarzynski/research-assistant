import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { PathJail } from "../path-jail";
import { makeTool } from "./make-tool";

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

export function createReadFileTool(jail: PathJail): AgentTool<typeof readFileParameters, null> {
  return makeTool({
    name: "read_file",
    label: "Read file",
    description:
      "Read the contents of a file. Path must be within the workspace or linked project folder.",
    parameters: readFileParameters,
    execute: async (_id, { path }): Promise<AgentToolResult<null>> => {
      const resolved = jail.validate(path, "read");
      const content = await readFile(resolved, "utf-8");
      return { content: [{ type: "text" as const, text: content }], details: null };
    },
  });
}

const readFileParameters = Type.Object({
  path: Type.String({ description: "Absolute path to the file" }),
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
    execute: async (
      _id,
      { path, content, start_line, end_line, expected_hash },
    ): Promise<AgentToolResult<null>> => {
      const resolved = jail.validate(path, "write");
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
  });
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
