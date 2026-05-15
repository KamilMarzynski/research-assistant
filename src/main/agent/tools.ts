import { join } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { AllowlistService } from "../services/AllowlistService";
import type { CompressionService } from "./CompressionService";
import { PathJail } from "./path-jail";
import { createRequestEvaluationTool } from "./tools/eval-tools";
import { createExecuteCodeTool } from "./tools/execute-code-tool";
import { createListDirTool, createReadFileTool, createWriteFileTool } from "./tools/file-tools";
import { createReadMemoryTool, createSaveMemoryTool } from "./tools/memory-tools";
import { createSpawnAgentsParallelTool, createSpawnAgentTool } from "./tools/orchestrator-tools";
import { createProposeSkillTool } from "./tools/propose-skill";
import { createStartResearchTool } from "./tools/research-tools";
import { createRunSkillScriptTool } from "./tools/run-skill-script-tool";
import { createSafeBashTool } from "./tools/safe-bash-tool";
import { createFetchUrlTool } from "./tools/web/fetch-url";
import { createWebSearchTool } from "./tools/web/web-search";

export type AgentToolName =
  | "read_file"
  | "write_file"
  | "list_dir"
  | "safe_bash"
  | "fetch_url"
  | "web_search"
  | "request_evaluation"
  | "start_research"
  | "execute_code"
  | "spawn_agent"
  | "spawn_agents_parallel"
  | "propose_skill"
  | "run_skill_script"
  | "save_memory"
  | "read_memory";

export type SpawnResult = { outputPath: string; summary: string };
export type AgentType = "researcher" | "coder" | "orchestrator";

export interface EvaluationVerdict {
  pass: boolean;
  criteria: Array<{ name: string; pass: boolean; rationale: string }>;
}

export interface ToolCapabilities {
  webAccess: boolean;
  memory: boolean;
  codeExecution: boolean;
  research: boolean;
  evaluation: boolean;
  spawn: boolean;
  proposeSkill: boolean;
}

export interface ToolContext {
  projectId: string;
  slug: string;
  projectName: string;
  projectPath: string | null;
  folderPath: string | null;
  homePath: string;
  toolNames?: readonly AgentToolName[];
  apiKey?: string;
  model?: string;
  startResearchFn?: (query: string, deep?: boolean) => Promise<{ taskId: string }>;
  requestEvaluationFn?: (filePath: string, criteria: string[]) => Promise<EvaluationVerdict>;
  spawnAgentFn?: (
    type: AgentType,
    query: string,
    outputPath: string,
    label?: string,
  ) => Promise<SpawnResult>;
  spawnAgentsParallelFn?: (
    agents: Array<{ type: AgentType; query: string; outputPath: string }>,
  ) => Promise<SpawnResult[]>;
  proposeSkillFn?: (
    name: string,
    skillContent: string,
    script: string | undefined,
    scope: "global" | "project",
  ) => Promise<void>;
  saveMemoryFn?: (
    category: string,
    title: string,
    content: string,
    scope: "app" | "project",
  ) => Promise<{ path: string }>;
  readMemoryFn?: (options: {
    category?: string;
    query?: string;
    scope: "app" | "project" | "both";
  }) => Promise<string>;
  webAccessEnabled?: boolean;
  onFileWrite?: (absolutePath: string, relativePath: string, fileName: string) => void;
  emitBlocked?: (payload: {
    commandId: string;
    command: string;
    reason: string;
    category: string;
    key: string;
    projectId: string;
    intent: string;
    timestamp: string;
  }) => void;
  emitApprovalRequired?: (payload: {
    path: string;
    mode: "read" | "write";
    projectId: string;
  }) => void;
  compressionService?: CompressionService;
  allowlistService: AllowlistService;
}

/** Backward-compat alias — callers that pass a single options object continue to work */
export type AgentToolsOptions = ToolContext;

function capabilitiesToToolNames(caps: ToolCapabilities): AgentToolName[] {
  const names: AgentToolName[] = [
    "read_file",
    "write_file",
    "list_dir",
    "safe_bash",
    "execute_code",
    "run_skill_script",
  ];
  if (caps.webAccess) names.push("fetch_url", "web_search");
  if (caps.memory) names.push("save_memory", "read_memory");
  if (caps.research) names.push("start_research");
  if (caps.evaluation) names.push("request_evaluation");
  if (caps.spawn) names.push("spawn_agent", "spawn_agents_parallel");
  if (caps.proposeSkill) names.push("propose_skill");
  return names;
}

// biome-ignore lint/suspicious/noExplicitAny: AgentTool generic is covariant in TDetails but contravariant in TParams; any is the correct erasure for a heterogeneous collection
function buildTools(ctx: ToolContext): AgentTool<any>[] {
  const { projectId, slug, projectPath, folderPath, homePath, startResearchFn, onFileWrite } = ctx;
  const jail = new PathJail(projectId, slug, folderPath, projectPath, ctx.allowlistService);
  const workspacePath = join(homePath, "projects", slug, "workspace");
  const auditLogPath = join(homePath, "audit.log");

  // biome-ignore lint/suspicious/noExplicitAny: see above
  const tools: AgentTool<any>[] = [
    createReadFileTool(jail, ctx.compressionService, ctx.emitApprovalRequired),
    createWriteFileTool(jail, folderPath, onFileWrite, ctx.emitApprovalRequired),
    createListDirTool(jail, ctx.emitApprovalRequired),
    createSafeBashTool(projectId, workspacePath, auditLogPath, ctx.emitBlocked),
    createRunSkillScriptTool(slug, homePath, auditLogPath),
  ];

  if (ctx.saveMemoryFn) {
    tools.push(createSaveMemoryTool(ctx.saveMemoryFn));
  }
  if (ctx.readMemoryFn) {
    tools.push(createReadMemoryTool(ctx.readMemoryFn));
  }

  if (ctx.webAccessEnabled !== false) {
    tools.push(createFetchUrlTool(ctx.compressionService));
    tools.push(createWebSearchTool(ctx.compressionService));
  }

  tools.push(createExecuteCodeTool(jail));

  if (startResearchFn) {
    tools.push(createStartResearchTool(startResearchFn));
  }

  if (ctx.requestEvaluationFn) {
    tools.push(createRequestEvaluationTool(jail, ctx.requestEvaluationFn));
  }

  if (ctx.spawnAgentFn) {
    tools.push(createSpawnAgentTool(jail, ctx.spawnAgentFn));
  }

  if (ctx.spawnAgentsParallelFn) {
    tools.push(createSpawnAgentsParallelTool(jail, ctx.spawnAgentsParallelFn));
  }

  if (ctx.proposeSkillFn) {
    tools.push(createProposeSkillTool(ctx.proposeSkillFn));
  }

  if (ctx.toolNames) {
    const allowed = new Set<AgentToolName>(ctx.toolNames);
    return tools.filter((t) => allowed.has(t.name as AgentToolName));
  }
  return tools;
}

export function createAgentTools(opts: ToolContext): AgentTool[];
export function createAgentTools(caps: ToolCapabilities, ctx: ToolContext): AgentTool[];
export function createAgentTools(
  optsOrCaps: ToolContext | ToolCapabilities,
  ctx?: ToolContext,
  // biome-ignore lint/suspicious/noExplicitAny: see buildTools
): AgentTool<any>[] {
  if (ctx === undefined) {
    return buildTools(optsOrCaps as ToolContext);
  }
  const caps = optsOrCaps as ToolCapabilities;
  return buildTools({ ...ctx, toolNames: capabilitiesToToolNames(caps) });
}
