import { basename } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { type AllowlistService, ApprovalRequiredError } from "../../services/AllowlistService";
import { runExecuteCode } from "../extensions/docker-sandbox";
import {
  appendAuditEntry,
  enterExecuteCodeApprovalGate,
  hashCode,
} from "../extensions/execute-code-approval";
import type { PathJail } from "../path-jail";

interface ExecuteCodeToolOptions {
  projectId: string;
  auditLogPath: string;
  allowlistService: AllowlistService;
  emitApprovalRequired?: Parameters<typeof enterExecuteCodeApprovalGate>[1];
  shouldBypassApproval?: (projectId: string) => Promise<boolean>;
}

export function createExecuteCodeTool(
  jail: PathJail,
  options: ExecuteCodeToolOptions,
): AgentTool<typeof executeCodeParameters, Awaited<ReturnType<typeof runExecuteCode>>> {
  return {
    name: "execute_code",
    label: "Execute code in sandbox",
    description:
      "Execute code in an isolated Docker container with no access to host environment variables. " +
      "Use for isolated, untrusted, or data-processing code (Python scripts, analysis, one-off computations). " +
      "Prefer safe_bash for project-native operations (git, tests, package managers). " +
      "Always state your intent. " +
      "Pass input files via workspaceFiles (absolute paths validated by jail) or inline via files. " +
      "Write output files to /workspace/output/ to receive them back as outputFiles.",
    parameters: executeCodeParameters,
    execute: async (_id, { intent, code, language, files, workspaceFiles, networkEnabled }) => {
      const requestedPaths: Array<{ path: string; mode: "read" }> = [];
      const codeHash = hashCode(code);
      const startedAt = new Date().toISOString();
      const requestedWorkspaceFiles = workspaceFiles ?? [];
      const inlineFileNames = (files ?? []).map((f) => f.name);
      for (const path of requestedWorkspaceFiles) {
        try {
          jail.validate(path, "read");
        } catch (err) {
          if (err instanceof ApprovalRequiredError) {
            requestedPaths.push({ path: err.path, mode: "read" });
            continue;
          }
          throw err;
        }
      }

      const shouldBypass =
        options.shouldBypassApproval &&
        (await options.shouldBypassApproval(options.projectId)) === true;

      if (shouldBypass) {
        for (const pathApproval of requestedPaths) {
          options.allowlistService.approveSession(
            options.projectId,
            pathApproval.path,
            pathApproval.mode,
          );
        }

        const approvedWorkspaceFiles = requestedWorkspaceFiles.map((p) => {
          const validated = jail.validate(p, "read");
          return { name: basename(validated), sourcePath: validated };
        });
        const result = await runExecuteCode({
          code,
          language,
          files,
          workspaceFiles: approvedWorkspaceFiles,
          networkEnabled,
        });
        await appendAuditEntry(options.auditLogPath, {
          ts: startedAt,
          projectId: options.projectId,
          tool: "execute_code",
          intent,
          language,
          code,
          codeHash,
          networkEnabled: networkEnabled === true,
          workspaceFiles: requestedWorkspaceFiles,
          inlineFiles: inlineFileNames,
          outputFiles: result.outputFiles.map((f) => f.name),
          exitCode: result.error ? 1 : 0,
          blockReason: result.error,
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
      }

      if (!options.emitApprovalRequired) {
        throw new Error("execute_code approval is not configured");
      }

      const approval = await enterExecuteCodeApprovalGate(
        {
          projectId: options.projectId,
          intent,
          language,
          code,
          codeHash,
          networkEnabled: networkEnabled === true,
          workspaceFiles: requestedWorkspaceFiles,
          inlineFiles: inlineFileNames,
          requestedPaths,
        },
        options.emitApprovalRequired,
      );

      if (!approval.approved) {
        await appendAuditEntry(options.auditLogPath, {
          ts: startedAt,
          projectId: options.projectId,
          tool: "execute_code",
          intent,
          language,
          code,
          codeHash,
          networkEnabled: networkEnabled === true,
          workspaceFiles: requestedWorkspaceFiles,
          inlineFiles: inlineFileNames,
          exitCode: null,
          blocked: true,
          blockReason: "User denied code execution.",
          blockKey: "execute_code_denied",
          blockCategory: "code_execution",
        });
        return {
          content: [{ type: "text" as const, text: "User denied code execution." }],
          details: { stdout: "", outputFiles: [], error: "User denied code execution." },
        };
      }

      for (const pathApproval of requestedPaths) {
        options.allowlistService.approveSession(
          options.projectId,
          pathApproval.path,
          pathApproval.mode,
        );
      }

      const approvedWorkspaceFiles = requestedWorkspaceFiles.map((p) => {
        const validated = jail.validate(p, "read");
        return { name: basename(validated), sourcePath: validated };
      });
      const result = await runExecuteCode({
        code,
        language,
        files,
        workspaceFiles: approvedWorkspaceFiles,
        networkEnabled,
      });
      await appendAuditEntry(options.auditLogPath, {
        ts: startedAt,
        projectId: options.projectId,
        tool: "execute_code",
        intent,
        language,
        code,
        codeHash,
        networkEnabled: networkEnabled === true,
        workspaceFiles: requestedWorkspaceFiles,
        inlineFiles: inlineFileNames,
        outputFiles: result.outputFiles.map((f) => f.name),
        exitCode: result.error ? 1 : 0,
        blockReason: result.error,
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
  intent: Type.String({ description: "What you are trying to accomplish with this code" }),
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
