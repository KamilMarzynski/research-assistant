import { mkdir } from "node:fs/promises";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { runSafeBash } from "../extensions/safe-bash";
import type { AgentToolsOptions } from "../tools";

export function createSafeBashTool(
  projectId: string,
  workspacePath: string,
  auditLogPath: string,
  emitBlocked: AgentToolsOptions["emitBlocked"],
): AgentTool<typeof safeBashParameters, Awaited<ReturnType<typeof runSafeBash>>> {
  return {
    name: "safe_bash",
    label: "Run safe bash command",
    description:
      "Execute a bash command in the project workspace. Always state your intent. Blocked commands: rm -rf, sudo, curl, wget, eval, subshells.",
    parameters: safeBashParameters,
    execute: async (_id, { command, intent }) => {
      await mkdir(workspacePath, { recursive: true });
      const result = await runSafeBash({
        command,
        intent,
        projectId,
        workspacePath,
        auditLogPath,
        emitBlocked,
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
  };
}

const safeBashParameters = Type.Object({
  command: Type.String({ description: "The bash command to run" }),
  intent: Type.String({
    description: "What you are trying to accomplish with this command",
  }),
});
