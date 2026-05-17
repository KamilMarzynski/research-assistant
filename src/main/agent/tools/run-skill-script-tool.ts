import { spawn } from "node:child_process";
import { access, appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

interface RunSkillScriptResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
  truncated?: boolean;
}

const MAX_OUTPUT_CHARS = 65536;
const TIMEOUT_MS = 60_000;

async function runScript(
  scriptPath: string,
  args: string[],
  intent: string,
  projectId: string,
  auditLogPath: string,
  skillName: string,
): Promise<RunSkillScriptResult> {
  return new Promise((resolve) => {
    const interpreter = scriptPath.endsWith(".py") ? "python3" : "bash";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const proc = spawn(interpreter, [scriptPath, ...args], {
      env: process.env,
      signal: controller.signal,
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;

    const settle = (result: RunSkillScriptResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    proc.stdout.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stdout) < MAX_OUTPUT_CHARS) {
        stdout += chunk.toString();
        const byteLen = Buffer.byteLength(stdout);
        if (byteLen >= MAX_OUTPUT_CHARS) {
          truncated = true;
          const buf = Buffer.from(stdout);
          stdout = buf.subarray(0, MAX_OUTPUT_CHARS).toString("utf-8");
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stderr) < MAX_OUTPUT_CHARS) {
        stderr += chunk.toString();
        const byteLen = Buffer.byteLength(stderr);
        if (byteLen >= MAX_OUTPUT_CHARS) {
          truncated = true;
          const buf = Buffer.from(stderr);
          stderr = buf.subarray(0, MAX_OUTPUT_CHARS).toString("utf-8");
        }
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (
        (err as NodeJS.ErrnoException).code === "ABORT_ERR" ||
        (err as NodeJS.ErrnoException).name === "AbortError"
      ) {
        settle({
          exitCode: 124,
          stdout,
          stderr: "Timeout: script exceeded 60s limit.",
          error: "timeout",
        });
      } else {
        settle({ exitCode: 1, stdout, stderr, error: err.message });
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (truncated) {
        stdout += `\n[truncated -- output exceeded ${MAX_OUTPUT_CHARS} chars]`;
      }
      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        projectId,
        type: "skill_script",
        skill: skillName,
        intent,
        exitCode: code ?? 1,
      });
      void appendFile(auditLogPath, `${entry}\n`, "utf-8").catch(() => {});
      settle({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

const runSkillScriptParameters = Type.Object({
  skillName: Type.String({
    description: "Name of the approved skill whose script to run (must exist in skills directory)",
  }),
  scope: Type.Union([Type.Literal("global"), Type.Literal("project")], {
    description:
      "Look in global skills directory ('global') or project-specific skills ('project')",
  }),
  intent: Type.String({ description: "What you are trying to accomplish with this script" }),
  args: Type.Optional(
    Type.Array(Type.String(), {
      description: "Command-line arguments to pass to the script",
    }),
  ),
});

export function createRunSkillScriptTool(
  projectSlug: string,
  homePath: string,
  auditLogPath: string,
): AgentTool<typeof runSkillScriptParameters, RunSkillScriptResult> {
  return {
    name: "run_skill_script",
    label: "Run approved skill script",
    description:
      "Execute a shell script bundled with an approved skill. " +
      "Scripts run with host environment variables — only use for trusted, user-approved skills. " +
      "Scripts must be located in an approved skills directory; use write_file to add new ones.",
    parameters: runSkillScriptParameters,
    execute: async (
      _id,
      { skillName, scope, args, intent },
    ): Promise<AgentToolResult<RunSkillScriptResult>> => {
      // Validate skillName to prevent path traversal
      if (!/^[a-z0-9][a-z0-9-]*$/.test(skillName)) {
        throw new Error(
          `Invalid skillName "${skillName}": only lowercase letters, digits, and hyphens allowed`,
        );
      }

      const skillsDir =
        scope === "project"
          ? join(homePath, "projects", projectSlug, "skills")
          : join(homePath, "skills");

      const skillDir = join(skillsDir, skillName);
      let scriptPath: string | null = null;

      for (const ext of [".sh", ".py"]) {
        const candidate = join(skillDir, `script${ext}`);
        try {
          await access(candidate);
          scriptPath = candidate;
          break;
        } catch {
          // try next extension
        }
      }

      if (!scriptPath) {
        const notFound: RunSkillScriptResult = {
          exitCode: 1,
          stdout: "",
          stderr: "",
          error: "script not found",
        };
        return {
          content: [
            {
              type: "text" as const,
              text: `No script found for skill "${skillName}" in ${scope} skills directory.`,
            },
          ],
          details: notFound,
        };
      }

      const result = await runScript(
        scriptPath,
        args ?? [],
        intent,
        projectSlug,
        auditLogPath,
        skillName,
      );
      const summary = [
        `Exit code: ${result.exitCode}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
        result.error ? `error: ${result.error}` : "",
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
