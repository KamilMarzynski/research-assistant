import { join } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { PathJail } from "./path-jail";
import { createSaveArtifactTool } from "./tools/artifact-tools";
import { createDockerTool } from "./tools/docker-tool";
import { createRequestEvaluationTool } from "./tools/eval-tools";
import { createListDirTool, createReadFileTool, createWriteFileTool } from "./tools/file-tools";
import { createSpawnAgentsParallelTool, createSpawnAgentTool } from "./tools/orchestrator-tools";
import { createProposeToolTool } from "./tools/propose-tool";
import { createStartResearchTool } from "./tools/research-tools";
import { createReadMemoryTool, createSaveMemoryTool } from "./tools/memory-tools";
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
  | "run_in_docker"
  | "spawn_agent"
  | "spawn_agents_parallel"
  | "save_artifact"
  | "propose_tool"
  | "save_memory"
  | "read_memory";

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
}

export function createAgentTools(opts: AgentToolsOptions): AgentTool[] {
  const { projectId, folderPath, homePath, startResearchFn, onFileWrite } = opts;
  const jail = new PathJail(projectId, folderPath);
  const workspacePath = join(homePath, "workspace", projectId);
  const auditLogPath = join(homePath, "audit.log");

  // biome-ignore lint/suspicious/noExplicitAny: AgentTool generic is covariant in TDetails but contravariant in TParams; any is the correct erasure for a heterogeneous collection
  const tools: AgentTool<any>[] = [
    createReadFileTool(jail),
    createWriteFileTool(jail, folderPath, onFileWrite),
    createListDirTool(jail),
    createSafeBashTool(projectId, workspacePath, auditLogPath, opts.emitBlocked),
  ];

  if (opts.saveMemoryFn) {
    tools.push(createSaveMemoryTool(opts.saveMemoryFn));
  }
  if (opts.readMemoryFn) {
    tools.push(createReadMemoryTool(opts.readMemoryFn));
  }

  if (opts.webAccessEnabled !== false) {
    tools.push(createFetchUrlTool());
    tools.push(createWebSearchTool());
  }

  tools.push(createDockerTool());

  if (startResearchFn) {
    tools.push(createStartResearchTool(startResearchFn));
  }

  if (opts.requestEvaluationFn) {
    tools.push(createRequestEvaluationTool(jail, opts.requestEvaluationFn));
  }

  if (opts.spawnAgentFn) {
    tools.push(createSpawnAgentTool(jail, opts.spawnAgentFn));
  }

  if (opts.spawnAgentsParallelFn) {
    tools.push(createSpawnAgentsParallelTool(jail, opts.spawnAgentsParallelFn));
  }

  if (opts.saveArtifactFn) {
    tools.push(createSaveArtifactTool(jail, opts.saveArtifactFn));
  }

  if (opts.proposeToolFn) {
    tools.push(createProposeToolTool(opts.proposeToolFn));
  }

  if (opts.toolNames) {
    const allowed = new Set<AgentToolName>(opts.toolNames);
    return tools.filter((t) => allowed.has(t.name as AgentToolName));
  }
  return tools;
}
