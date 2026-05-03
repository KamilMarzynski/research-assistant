import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { PathJail } from "../path-jail";
import { makeTool } from "./make-tool";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
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
  start_line: Type.Optional(
    Type.Number({
      description:
        "1-based line number to insert at or start replacement. Existing line at this position shifts down if end_line is omitted.",
    }),
  ),
  end_line: Type.Optional(
    Type.Number({
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
