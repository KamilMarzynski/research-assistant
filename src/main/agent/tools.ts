import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { type TSchema, Type } from "@sinclair/typebox";
import { runSafeBash } from "./extensions/safe-bash";
import { PathJail } from "./path-jail";

/** Helper to build a fully-typed AgentTool without losing parameter generics. */
function makeTool<TParams extends TSchema, TDetails>(
  tool: AgentTool<TParams, TDetails>,
): AgentTool<TParams, TDetails> {
  return tool;
}

export interface AgentToolsOptions {
  projectId: string;
  projectName: string;
  folderPath: string | null;
  homePath: string;
  startResearchFn?: (query: string) => Promise<{ taskId: string }>;
}

export function createAgentTools(opts: AgentToolsOptions): AgentTool[] {
  const { projectId, folderPath, homePath, startResearchFn } = opts;
  const jail = new PathJail(projectId, folderPath);
  const workspacePath = join(homePath, "workspace", projectId);
  const auditLogPath = join(homePath, "audit.log");

  // biome-ignore lint/suspicious/noExplicitAny: AgentTool generic is covariant in TDetails but contravariant in TParams; any[] is the correct erasure for a heterogeneous collection
  const tools: AgentTool<any>[] = [
    makeTool({
      name: "read_file",
      label: "Read file",
      description:
        "Read the contents of a file. Path must be within the workspace or linked project folder.",
      parameters: Type.Object({
        path: Type.String({ description: "Absolute path to the file" }),
      }),
      execute: async (_id, { path }): Promise<AgentToolResult<null>> => {
        const resolved = jail.validate(path, "read");
        const content = await readFile(resolved, "utf-8");
        return { content: [{ type: "text" as const, text: content }], details: null };
      },
    }),

    makeTool({
      name: "write_file",
      label: "Write file",
      description:
        "Write content to a file, creating parent directories as needed. Path must be within the workspace or linked project folder.",
      parameters: Type.Object({
        path: Type.String({ description: "Absolute path to the file" }),
        content: Type.String({ description: "Content to write" }),
      }),
      execute: async (_id, { path, content }): Promise<AgentToolResult<null>> => {
        const resolved = jail.validate(path, "write");
        const dir = dirname(resolved);
        await mkdir(dir, { recursive: true });
        await writeFile(resolved, content, "utf-8");
        return {
          content: [{ type: "text" as const, text: `Written: ${resolved}` }],
          details: null,
        };
      },
    }),

    makeTool({
      name: "list_dir",
      label: "List directory",
      description:
        "List files and subdirectories in a directory. Path must be within the workspace or linked project folder.",
      parameters: Type.Object({
        path: Type.String({ description: "Absolute path to the directory" }),
      }),
      execute: async (_id, { path }): Promise<AgentToolResult<string[]>> => {
        const resolved = jail.validate(path, "read");
        const entries = await readdir(resolved, { withFileTypes: true });
        const lines = entries.map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`);
        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: entries.map((e) => e.name),
        };
      },
    }),

    makeTool({
      name: "safe_bash",
      label: "Run safe bash command",
      description:
        "Execute a bash command in the project workspace. Always state your intent. Blocked commands: rm -rf, sudo, curl, wget, eval, subshells.",
      parameters: Type.Object({
        command: Type.String({ description: "The bash command to run" }),
        intent: Type.String({
          description: "What you are trying to accomplish with this command",
        }),
      }),
      execute: async (_id, { command, intent }) => {
        await mkdir(workspacePath, { recursive: true });
        const result = await runSafeBash({
          command,
          intent,
          projectId,
          workspacePath,
          auditLogPath,
        });
        const summary = [
          `Exit code: ${result.exitCode}`,
          result.stdout ? `stdout:\n${result.stdout}` : "",
          result.stderr ? `stderr:\n${result.stderr}` : "",
          result.truncated ? "[output was truncated]" : "",
        ]
          .filter(Boolean)
          .join("\n");
        return {
          content: [{ type: "text" as const, text: summary }],
          details: result,
        };
      },
    }),
  ];

  if (startResearchFn) {
    tools.push(
      makeTool({
        name: "start_research",
        label: "Start background research",
        description:
          "Dispatch a background research task. Returns immediately with a taskId. A summary will be injected into this conversation when the research completes.",
        parameters: Type.Object({
          query: Type.String({
            description:
              "A clear, self-contained research question including all necessary context",
          }),
        }),
        execute: async (_id, { query }) => {
          const { taskId } = await startResearchFn(query);
          return {
            content: [
              {
                type: "text" as const,
                text: `Research task started (taskId: ${taskId}). I'll report back when it completes.`,
              },
            ],
            details: { taskId },
          };
        },
      }),
    );
  }

  return tools;
}
