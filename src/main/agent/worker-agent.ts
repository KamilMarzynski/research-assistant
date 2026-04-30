import { Agent } from "@mariozechner/pi-agent-core";
import { loadSkillsByContent } from "./context";
import { createModel } from "./model-factory";
import type { ModelProvider } from "./model-provider";
import type { AgentToolName, AgentType, EvaluationVerdict, SpawnResult } from "./tools";
import { createAgentTools } from "./tools";

export type { AgentType, SpawnResult };

// Tools that require remainingDepth > 0 to be active
const ORCHESTRATOR_ONLY_TOOLS = new Set<AgentToolName>([
  "spawn_agent",
  "spawn_agents_parallel",
  "save_artifact",
  "propose_tool",
]);

export const ORCHESTRATOR_TOOL_NAMES: readonly AgentToolName[] = [
  "read_file",
  "write_file",
  "list_dir",
  "safe_bash",
  "run_in_docker",
  "spawn_agent",
  "spawn_agents_parallel",
  "save_artifact",
  "propose_tool",
] as const;

export interface WorkerAgentConfig {
  toolNames: readonly AgentToolName[];
  systemPromptAddition: string;
  skills?: string[];
  projectId: string;
  projectName: string;
  folderPath: string | null;
  homePath: string;
  provider: ModelProvider;
  remainingDepth?: number; // defaults to 0 (leaf)
  saveArtifactFn?: (path: string, title: string) => Promise<{ artifactId: string }>;
  proposeToolFn?: (name: string, skillContent: string, script?: string) => Promise<void>;
  agentLabel?: string;
  onProgress?: (label: string, delta: string) => void;
}

export interface WorkerAgent {
  agent: Agent;
  run: (input: string) => Promise<string>;
}

export interface EvaluatorBaseConfig {
  projectId: string;
  projectName: string;
  folderPath: string | null;
  homePath: string;
  provider: ModelProvider;
}

export function makeEvaluatorFn(
  base: EvaluatorBaseConfig,
): (filePath: string, criteria: string[]) => Promise<EvaluationVerdict> {
  return async (filePath, criteria) => {
    const { run } = await createWorkerAgent({
      toolNames: ["read_file", "safe_bash"],
      systemPromptAddition:
        "You are a research evaluator. Read the file at the given path, assess it against the criteria, and respond with ONLY a JSON object. No preamble. No explanation.",
      skills: ["evaluate-research"],
      ...base,
    });
    const prompt = [
      `Evaluate the research output at: ${filePath}`,
      "",
      "Criteria:",
      ...criteria.map((c) => `- ${c}`),
      "",
      "Respond with JSON only.",
    ].join("\n");
    const output = await run(prompt);
    const match = output.match(/\{[\s\S]*\}/);
    if (!match) {
      return {
        pass: false,
        criteria: [
          {
            name: "parse-error",
            pass: false,
            rationale: "evaluator did not return valid JSON",
          },
        ],
      };
    }
    try {
      return JSON.parse(match[0]) as EvaluationVerdict;
    } catch {
      return {
        pass: false,
        criteria: [
          {
            name: "parse-error",
            pass: false,
            rationale: "evaluator returned malformed JSON",
          },
        ],
      };
    }
  };
}

type WorkerAgentBase = Pick<
  WorkerAgentConfig,
  | "projectId"
  | "projectName"
  | "folderPath"
  | "homePath"
  | "provider"
  | "saveArtifactFn"
  | "proposeToolFn"
  | "onProgress"
>;

type PresetBuilder = (
  base: WorkerAgentBase,
  outputPath: string,
  depth: number,
) => WorkerAgentConfig;

const AGENT_TYPE_PRESETS: Record<AgentType, PresetBuilder> = {
  researcher: (base, outputPath) => ({
    ...base,
    toolNames: ["read_file", "write_file", "list_dir", "safe_bash"],
    systemPromptAddition: `You are a background researcher. Investigate thoroughly using the available tools, then write your complete findings to: ${outputPath}. When done, respond with a final summary.`,
    remainingDepth: 0,
  }),
  coder: (base, outputPath) => ({
    ...base,
    toolNames: ["read_file", "write_file", "run_in_docker"],
    systemPromptAddition: `You are a coder agent. Use run_in_docker to execute code, then write your results to: ${outputPath}. When done, respond with a summary.`,
    remainingDepth: 0,
  }),
  orchestrator: (base, outputPath, depth) => ({
    ...base,
    toolNames: [...ORCHESTRATOR_TOOL_NAMES],
    systemPromptAddition: `You are a research orchestrator. Plan and delegate subtasks using spawn_agent or spawn_agents_parallel. Write your final synthesis to: ${outputPath}.`,
    remainingDepth: depth - 1,
  }),
};

export async function createWorkerAgent(config: WorkerAgentConfig): Promise<WorkerAgent> {
  const {
    toolNames,
    systemPromptAddition,
    skills = [],
    projectId,
    projectName,
    folderPath,
    homePath,
    provider,
    remainingDepth = 0,
    saveArtifactFn,
    proposeToolFn,
    onProgress,
  } = config;

  // Depth-guard: remove orchestrator-only tools when at leaf depth
  const effectiveToolNames =
    remainingDepth === 0 ? toolNames.filter((t) => !ORCHESTRATOR_ONLY_TOOLS.has(t)) : toolNames;

  // Build spawn callbacks (only when depth > 0)
  let spawnAgentFn:
    | ((type: AgentType, query: string, outputPath: string, label?: string) => Promise<SpawnResult>)
    | undefined;
  let spawnAgentsParallelFn:
    | ((
        agents: Array<{ type: AgentType; query: string; outputPath: string }>,
      ) => Promise<SpawnResult[]>)
    | undefined;

  if (remainingDepth > 0) {
    const base: WorkerAgentBase = {
      projectId,
      projectName,
      folderPath,
      homePath,
      provider,
      saveArtifactFn,
      proposeToolFn,
      onProgress,
    };

    spawnAgentFn = async (
      type: AgentType,
      query: string,
      outputPath: string,
      label?: string,
    ): Promise<SpawnResult> => {
      const effectiveLabel = label ?? `[${type}]`;
      const childConfig = AGENT_TYPE_PRESETS[type](base, outputPath, remainingDepth);
      const { run } = await createWorkerAgent({ ...childConfig, agentLabel: effectiveLabel });
      const summary = await run(query);
      return { outputPath, summary };
    };

    spawnAgentsParallelFn = async (
      agents: Array<{ type: AgentType; query: string; outputPath: string }>,
    ): Promise<SpawnResult[]> => {
      const typeCounters: Partial<Record<AgentType, number>> = {};
      return Promise.all(
        agents.map(({ type, query, outputPath }) => {
          typeCounters[type] = (typeCounters[type] ?? 0) + 1;
          const label = `[${type}-${typeCounters[type]}]`;
          // biome-ignore lint/style/noNonNullAssertion: spawnAgentFn defined in this branch
          return spawnAgentFn!(type, query, outputPath, label);
        }),
      );
    };
  }

  const skillContent = await loadSkillsByContent(skills, folderPath ?? undefined);
  const systemPrompt = [systemPromptAddition, skillContent].filter(Boolean).join("\n\n");

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model: createModel({ provider, langfuseEnabled: false }),
    },
    getApiKey: async () => (provider.type === "ollama" ? "ollama" : provider.apiKey),
  });

  agent.state.tools = createAgentTools({
    projectId,
    projectName,
    folderPath,
    homePath,
    apiKey: provider.type === "ollama" ? "ollama" : provider.apiKey,
    model: provider.model,
    toolNames: effectiveToolNames,
    // requestEvaluationFn is provided unconditionally, but the toolNames filter in
    // createAgentTools will exclude request_evaluation unless "request_evaluation"
    // is in toolNames. Evaluator agents always use ["read_file", "safe_bash"], so
    // they will never receive the request_evaluation tool — preventing infinite recursion.
    requestEvaluationFn: makeEvaluatorFn({
      projectId,
      projectName,
      folderPath,
      homePath,
      provider,
    }),
    saveArtifactFn,
    proposeToolFn,
    spawnAgentFn,
    spawnAgentsParallelFn,
  });

  const run = (input: string): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      let output = "";
      agent.subscribe(async (event) => {
        const e = event as {
          type: string;
          assistantMessageEvent?: { type: string; delta: string };
        };
        if (e.type === "message_update") {
          const ae = e.assistantMessageEvent;
          if (ae?.type === "text_delta") {
            output += ae.delta;
            config.onProgress?.(config.agentLabel ?? "", ae.delta);
          }
        } else if (e.type === "agent_end") {
          resolve(output);
        }
      });
      agent.prompt(input).catch(reject);
    });

  return { agent, run };
}
