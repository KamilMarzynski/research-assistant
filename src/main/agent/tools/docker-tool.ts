import { basename } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { runInDocker } from "../extensions/docker-sandbox";
import type { PathJail } from "../path-jail";

export function createDockerTool(
  jail: PathJail,
): AgentTool<typeof dockerParameters, Awaited<ReturnType<typeof runInDocker>>> {
  return {
    name: "run_in_docker",
    label: "Run code in Docker",
    description:
      "Execute code in an isolated Docker container. Use for running Python, JavaScript, TypeScript, or Bash code safely. " +
      "Pass input files via workspaceFiles (absolute paths validated by jail) or inline via files. " +
      "Write output files to /workspace/output/ to receive them back as outputFiles.",
    parameters: dockerParameters,
    execute: async (_id, { code, language, files, workspaceFiles, networkEnabled }) => {
      const resolvedWorkspaceFiles =
        workspaceFiles?.map((p) => {
          const validated = jail.validate(p, "read");
          return { name: basename(validated), sourcePath: validated };
        }) ?? [];
      const result = await runInDocker({
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

const dockerParameters = Type.Object({
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
