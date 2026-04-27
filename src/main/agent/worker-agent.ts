import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { loadSkillsByContent } from "./context";
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
  apiKey: string;
  model: string;
  remainingDepth?: number; // defaults to 0 (leaf)
  saveArtifactFn?: (path: string, title: string) => Promise<{ artifactId: string }>;
  proposeToolFn?: (name: string, skillContent: string, script?: string) => Promise<void>;
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
  apiKey: string;
  model: string;
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

export async function createWorkerAgent(config: WorkerAgentConfig): Promise<WorkerAgent> {
  const {
    toolNames,
    systemPromptAddition,
    skills = [],
    projectId,
    projectName,
    folderPath,
    homePath,
    apiKey,
    model,
    remainingDepth = 0,
    saveArtifactFn,
    proposeToolFn,
  } = config;

  // Depth-guard: remove orchestrator-only tools when at leaf depth
  const effectiveToolNames =
    remainingDepth === 0
      ? toolNames.filter((t) => !ORCHESTRATOR_ONLY_TOOLS.has(t))
      : toolNames;

  // Build spawn callbacks (only when depth > 0)
  let spawnAgentFn: ((type: AgentType, query: string, outputPath: string) => Promise<SpawnResult>) | undefined;
  let spawnAgentsParallelFn:
    | ((agents: Array<{ type: AgentType; query: string; outputPath: string }>) => Promise<SpawnResult[]>)
    | undefined;

  if (remainingDepth > 0) {
    const buildChildConfig = (type: AgentType, outputPath: string): WorkerAgentConfig => {
      const base = { projectId, projectName, folderPath, homePath, apiKey, model, saveArtifactFn, proposeToolFn };
      switch (type) {
        case "researcher":
          return {
            ...base,
            toolNames: ["read_file", "write_file", "list_dir", "safe_bash"],
            systemPromptAddition: `You are a background researcher. Investigate thoroughly using the available tools, then write your complete findings to: ${outputPath}. When done, respond with a final summary.`,
            remainingDepth: 0,
          };
        case "coder":
          return {
            ...base,
            toolNames: ["read_file", "write_file", "run_in_docker"],
            systemPromptAddition: `You are a coder agent. Use run_in_docker to execute code, then write your results to: ${outputPath}. When done, respond with a summary.`,
            remainingDepth: 0,
          };
        case "orchestrator":
          return {
            ...base,
            toolNames: [...ORCHESTRATOR_TOOL_NAMES],
            systemPromptAddition: `You are a research orchestrator. Plan and delegate. Remaining orchestration depth: ${remainingDepth - 1}. Write your synthesis to: ${outputPath}.`,
            remainingDepth: remainingDepth - 1,
          };
      }
    };

    spawnAgentFn = async (type: AgentType, query: string, outputPath: string): Promise<SpawnResult> => {
      const childConfig = buildChildConfig(type, outputPath);
      const { run } = await createWorkerAgent(childConfig);
      const summary = await run(query);
      return { outputPath, summary };
    };

    spawnAgentsParallelFn = async (
      agents: Array<{ type: AgentType; query: string; outputPath: string }>,
    ): Promise<SpawnResult[]> => {
      return Promise.all(
        agents.map(({ type, query, outputPath }) =>
          // biome-ignore lint/style/noNonNullAssertion: spawnAgentFn is defined in this branch
          spawnAgentFn!(type, query, outputPath),
        ),
      );
    };
  }

  const skillContent = await loadSkillsByContent(skills, folderPath ?? undefined);
  const systemPrompt = [systemPromptAddition, skillContent].filter(Boolean).join("\n\n");

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model: getModel("openrouter", model as never),
    },
    getApiKey: async () => apiKey,
  });

  agent.state.tools = createAgentTools({
    projectId,
    projectName,
    folderPath,
    homePath,
    apiKey,
    model,
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
      apiKey,
      model,
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
          if (ae?.type === "text_delta") output += ae.delta;
        } else if (e.type === "agent_end") {
          resolve(output);
        }
      });
      agent.prompt(input).catch(reject);
    });

  return { agent, run };
}
