import { basename } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { runExecuteCode } from "../extensions/docker-sandbox";
import type { PathJail } from "../path-jail";

export function createExecuteCodeTool(
  jail: PathJail,
): AgentTool<typeof executeCodeParameters, Awaited<ReturnType<typeof runExecuteCode>>> {
  return {
    name: "execute_code",
    label: "Execute code in sandbox",
    description:
      "Execute code in an isolated Docker container with no access to host environment variables. " +
      "Use for running Python, JavaScript, TypeScript, or Bash code safely. " +
      "Pass input files via workspaceFiles (absolute paths validated by jail) or inline via files. " +
      "Write output files to /workspace/output/ to receive them back as outputFiles.",
    parameters: executeCodeParameters,
    execute: async (_id, { code, language, files, workspaceFiles, networkEnabled }) => {
      const resolvedWorkspaceFiles =
        workspaceFiles?.map((p) => {
          const validated = jail.validate(p, "read");
          return { name: basename(validated), sourcePath: validated };
        }) ?? [];
      const result = await runExecuteCode({
        code,
        language,
        files,
        workspaceFiles: resolvedWorkspaceFiles,
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
  };
}

const executeCodeParameters = Type.Object({
  code: Type.String({ description: "Code to execute" }),
  language: Type.Union(
    [
      Type.Literal("python"),
      Type.Literal("bash"),
      Type.Literal("typescript"),
      Type.Literal("javascript"),
    ],
    { description: "Programming language" },
  ),
  files: Type.Optional(
    Type.Array(Type.Object({ name: Type.String(), content: Type.String() }), {
      description: "Additional files to write into /workspace before execution",
    }),
  ),
  workspaceFiles: Type.Optional(
    Type.Array(Type.String(), {
      description: "Absolute paths of workspace files to copy into /workspace before execution",
    }),
  ),
  networkEnabled: Type.Optional(
    Type.Boolean({ description: "Allow network access inside the container" }),
  ),
});
