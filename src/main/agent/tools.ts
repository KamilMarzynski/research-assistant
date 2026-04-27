import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { type TSchema, Type } from "@sinclair/typebox";
import type { DockerSandboxInput } from "./extensions/docker-sandbox";
import { runInDocker } from "./extensions/docker-sandbox";
import { runSafeBash } from "./extensions/safe-bash";
import { PathJail } from "./path-jail";

/** Helper to build a fully-typed AgentTool without losing parameter generics. */
function makeTool<TParams extends TSchema, TDetails>(
  tool: AgentTool<TParams, TDetails>,
): AgentTool<TParams, TDetails> {
  return tool;
}

export type AgentToolName =
  | "read_file"
  | "write_file"
  | "list_dir"
  | "safe_bash"
  | "request_evaluation"
  | "start_research"
  | "run_in_docker"
  | "spawn_agent"
  | "spawn_agents_parallel"
  | "save_artifact"
  | "propose_tool";

export type SpawnResult = { outputPath: string; summary: string };
export type AgentType = "researcher" | "coder" | "orchestrator";

export interface EvaluationVerdict {
  pass: boolean;
  criteria: Array<{ name: string; pass: boolean; rationale: string }>;
}

export interface AgentToolsOptions {
  projectId: string;
  projectName: string;
  folderPath: string | null;
  homePath: string;
  toolNames?: readonly AgentToolName[];
  apiKey?: string;
  model?: string;
  startResearchFn?: (query: string, deep?: boolean) => Promise<{ taskId: string }>;
  requestEvaluationFn?: (filePath: string, criteria: string[]) => Promise<EvaluationVerdict>;
  spawnAgentFn?: (type: AgentType, query: string, outputPath: string) => Promise<SpawnResult>;
  spawnAgentsParallelFn?: (
    agents: Array<{ type: AgentType; query: string; outputPath: string }>,
  ) => Promise<SpawnResult[]>;
  saveArtifactFn?: (path: string, title: string) => Promise<{ artifactId: string }>;
  proposeToolFn?: (name: string, skillContent: string, script?: string) => Promise<void>;
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

  tools.push(
    makeTool({
      name: "run_in_docker",
      label: "Run code in Docker",
      description:
        "Execute code in an isolated Docker container. Write output files to /workspace/output/ to receive them back as outputFiles.",
      parameters: Type.Object({
        code: Type.String({ description: "Code to execute" }),
        language: Type.Union(
          [Type.Literal("python"), Type.Literal("bash"), Type.Literal("typescript")],
          { description: "Programming language" },
        ),
        files: Type.Optional(
          Type.Array(Type.Object({ name: Type.String(), content: Type.String() }), {
            description: "Additional files to write into /workspace before execution",
          }),
        ),
        networkEnabled: Type.Optional(
          Type.Boolean({ description: "Allow network access inside the container" }),
        ),
      }),
      execute: async (_id, { code, language, files, networkEnabled }) => {
        const result = await runInDocker({
          code,
          language: language as DockerSandboxInput["language"],
          files,
          networkEnabled,
        });
        const text = [
          result.stdout ? `stdout:\n${result.stdout}` : "",
          result.error ? `error: ${result.error}` : "",
          result.outputFiles.length > 0
            ? `output files: ${result.outputFiles.map((f) => f.name).join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");
        return {
          content: [{ type: "text" as const, text: text || "(no output)" }],
          details: result,
        };
      },
    }),
  );

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

  if (opts.requestEvaluationFn) {
    const evaluateFn = opts.requestEvaluationFn;
    tools.push(
      makeTool({
        name: "request_evaluation",
        label: "Request evaluation",
        description:
          "Ask the evaluator agent to assess a research output file against a list of criteria. Returns a structured pass/fail verdict.",
        parameters: Type.Object({
          filePath: Type.String({ description: "Absolute path to the research output file" }),
          criteria: Type.Array(Type.String(), {
            description: "List of criteria to evaluate the file against",
          }),
        }),
        execute: async (
          _id,
          { filePath, criteria },
        ): Promise<AgentToolResult<EvaluationVerdict>> => {
          const resolvedPath = jail.validate(filePath, "read");
          const verdict = await evaluateFn(resolvedPath, criteria);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(verdict, null, 2) }],
            details: verdict,
          };
        },
      }),
    );
  }

  if (opts.spawnAgentFn) {
    const spawnFn = opts.spawnAgentFn;
    tools.push(
      makeTool({
        name: "spawn_agent",
        label: "Spawn agent",
        description:
          "Spawn a child agent (researcher, coder, or orchestrator) to handle a subtask. Blocks until the child completes and returns a summary.",
        parameters: Type.Object({
          type: Type.Union(
            [Type.Literal("researcher"), Type.Literal("coder"), Type.Literal("orchestrator")],
            { description: "Agent type to spawn" },
          ),
          query: Type.String({ description: "Task description for the child agent" }),
          outputPath: Type.String({
            description: "Absolute path where the child agent should write its output",
          }),
        }),
        execute: async (
          _id,
          { type, query, outputPath },
        ): Promise<AgentToolResult<SpawnResult>> => {
          const resolvedPath = jail.validate(outputPath, "write");
          const result = await spawnFn(type as AgentType, query, resolvedPath);
          return {
            content: [{ type: "text" as const, text: result.summary }],
            details: result,
          };
        },
      }),
    );
  }

  if (opts.spawnAgentsParallelFn) {
    const spawnParallelFn = opts.spawnAgentsParallelFn;
    tools.push(
      makeTool({
        name: "spawn_agents_parallel",
        label: "Spawn agents in parallel",
        description:
          "Spawn multiple child agents concurrently. All run in parallel; returns when all complete.",
        parameters: Type.Object({
          agents: Type.Array(
            Type.Object({
              type: Type.Union(
                [Type.Literal("researcher"), Type.Literal("coder"), Type.Literal("orchestrator")],
                { description: "Agent type" },
              ),
              query: Type.String({ description: "Task description" }),
              outputPath: Type.String({ description: "Absolute path for output" }),
            }),
            { description: "List of agents to spawn" },
          ),
        }),
        execute: async (_id, { agents }): Promise<AgentToolResult<SpawnResult[]>> => {
          const validated = agents.map(({ type, query, outputPath }) => ({
            type: type as AgentType,
            query,
            outputPath: jail.validate(outputPath, "write"),
          }));
          const results = await spawnParallelFn(validated);
          const summary = results.map((r, i) => `[${i + 1}] ${r.summary}`).join("\n\n");
          return {
            content: [{ type: "text" as const, text: summary }],
            details: results,
          };
        },
      }),
    );
  }

  if (opts.saveArtifactFn) {
    const saveFn = opts.saveArtifactFn;
    tools.push(
      makeTool({
        name: "save_artifact",
        label: "Save artifact",
        description: "Register a file as a named research artifact so it appears in the UI.",
        parameters: Type.Object({
          path: Type.String({ description: "Absolute path to the artifact file" }),
          title: Type.String({ description: "Human-readable title for the artifact" }),
        }),
        execute: async (_id, { path, title }): Promise<AgentToolResult<{ artifactId: string }>> => {
          const resolvedPath = jail.validate(path, "read");
          const result = await saveFn(resolvedPath, title);
          return {
            content: [{ type: "text" as const, text: `Artifact saved (id: ${result.artifactId})` }],
            details: result,
          };
        },
      }),
    );
  }

  if (opts.proposeToolFn) {
    const proposeFn = opts.proposeToolFn;
    tools.push(
      makeTool({
        name: "propose_tool",
        label: "Propose new tool",
        description:
          "Propose a new skill/tool for the user to review and approve. The tool becomes available in future sessions once approved.",
        parameters: Type.Object({
          name: Type.String({
            description: "Kebab-case tool name (lowercase letters, digits, hyphens only)",
          }),
          description: Type.String({ description: "What the tool does" }),
          skillContent: Type.String({ description: "Full markdown skill file content" }),
          script: Type.Optional(
            Type.String({ description: "Optional shell script to bundle with the skill" }),
          ),
        }),
        execute: async (
          _id,
          { name, description: _desc, skillContent, script },
        ): Promise<AgentToolResult<null>> => {
          if (!/^[a-z0-9-]+$/.test(name)) {
            throw new Error(
              `Invalid tool name "${name}": only lowercase letters, digits, and hyphens allowed`,
            );
          }
          await proposeFn(name, skillContent, script);
          return {
            content: [
              { type: "text" as const, text: `Tool "${name}" proposed and pending user approval.` },
            ],
            details: null,
          };
        },
      }),
    );
  }

  if (opts.toolNames) {
    const allowed = new Set<AgentToolName>(opts.toolNames);
    return tools.filter((t) => allowed.has(t.name as AgentToolName));
  }
  return tools;
}
