import { Agent } from "@mariozechner/pi-agent-core";
import { z } from "zod/v4";
import type { AllowlistService } from "../services/AllowlistService";
import { loadSkillsByContent } from "./context";
import { createModel } from "./model-factory";
import type { ModelProvider } from "./model-provider";
import type { AgentToolName, AgentType, EvaluationVerdict, SpawnResult } from "./tools";
import { createAgentTools } from "./tools";

export type { AgentType, SpawnResult };

// Tools that require remainingDepth > 0 to be active
const ORCHESTRATOR_ONLY_TOOLS = new Set<AgentToolName>(["spawn_agent", "spawn_agents_parallel"]);

export const ORCHESTRATOR_TOOL_NAMES: readonly AgentToolName[] = [
  "read_file",
  "write_file",
  "list_dir",
  "safe_bash",
  "run_in_docker",
  "spawn_agent",
  "spawn_agents_parallel",
] as const;

export interface WorkerAgentConfig {
  toolNames: readonly AgentToolName[];
  systemPromptAddition: string;
  skills?: string[];
  projectId: string;
  projectName: string;
  projectPath: string | null;
  folderPath: string | null;
  homePath: string;
  provider: ModelProvider;
  remainingDepth?: number; // defaults to 0 (leaf)
  proposeSkillFn?: (name: string, skillContent: string, script?: string) => Promise<void>;
  agentLabel?: string;
  onProgress?: (label: string, delta: string) => void;
  webAccessEnabled?: boolean;
  allowlistService: AllowlistService;
}

export interface WorkerAgent {
  agent: Agent;
  run: (input: string) => Promise<string>;
}

export interface EvaluatorBaseConfig {
  projectId: string;
  projectName: string;
  projectPath: string | null;
  folderPath: string | null;
  homePath: string;
  provider: ModelProvider;
  webAccessEnabled?: boolean;
  allowlistService: AllowlistService;
}

const EvaluationCriterionSchema = z.object({
  name: z.string(),
  pass: z.boolean(),
  rationale: z.string(),
});

const EvaluationVerdictSchema = z.object({
  pass: z.boolean(),
  criteria: z.array(EvaluationCriterionSchema),
});

/**
 * Extract a JSON object from text using balanced-brace matching.
 * More robust than regex: handles nested braces in string values.
 */
function extractJson(text: string): unknown {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate) as Record<string, unknown>;
        } catch {
          start = -1;
        }
      }
    }
  }
  return null;
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
      webAccessEnabled: base.webAccessEnabled,
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
    const parsed = extractJson(output);
    if (!parsed) {
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
    const result = EvaluationVerdictSchema.safeParse(parsed);
    if (!result.success) {
      return {
        pass: false,
        criteria: [
          {
            name: "parse-error",
            pass: false,
            rationale: `evaluator returned invalid JSON schema: ${result.error.message}`,
          },
        ],
      };
    }
    return result.data as EvaluationVerdict;
  };
}

type WorkerAgentBase = Omit<
  WorkerAgentConfig,
  "toolNames" | "systemPromptAddition" | "skills" | "remainingDepth" | "agentLabel"
>;

type PresetBuilder = (
  base: WorkerAgentBase,
  outputPath: string,
  depth: number,
) => WorkerAgentConfig;

const AGENT_TYPE_PRESETS: Record<AgentType, PresetBuilder> = {
  researcher: (base, outputPath) => ({
    ...base,
    toolNames: ["read_file", "write_file", "list_dir", "safe_bash", "fetch_url", "web_search"],
    systemPromptAddition: `You are a background researcher. Investigate thoroughly using the available tools, then write complete findings to: ${outputPath}.

## Methodology

1. Search broadly for overview information and identify key sources
2. Read specific documents that directly address the query
3. Verify claims against multiple sources; note conflicts
4. Synthesize into a coherent narrative with clear headings

## Source requirements

- Cite sources for every factual claim
- Prefer primary sources over summaries
- Note when information is incomplete or uncertain

## Output

Write your complete findings to userProjectDir using write_file. Use Markdown with clear headings and a Sources section. Use meaningful filenames (no task IDs, no UUIDs).

When done, respond with a brief summary of key findings.`,
    remainingDepth: 0,
  }),
  coder: (base, outputPath) => ({
    ...base,
    toolNames: ["read_file", "write_file", "run_in_docker"],
    systemPromptAddition: `You are a code execution agent. Use run_in_docker to execute code safely, then write results to: ${outputPath}.

## When to use each tool

- run_in_docker: For executing Python scripts, data processing, or any isolated code execution
- safe_bash: For project-native operations (git, tests, package managers) when available

## Output

Write working code plus a brief explanation to the specified outputPath.`,
    remainingDepth: 0,
  }),
  orchestrator: (base, outputPath, depth) => ({
    ...base,
    toolNames: [...ORCHESTRATOR_TOOL_NAMES],
    systemPromptAddition: `You are a research orchestrator. Plan and delegate subtasks, then write your final synthesis to: ${outputPath}.

## Planning

1. Break the query into independent subtasks
2. Use spawn_agents_parallel for tasks that can run simultaneously
3. Use spawn_agent for sequential tasks with dependencies

## Synthesis

Combine findings from subagents into a coherent conclusion. Do not concatenate outputs. Resolve conflicts, summarize themes, and present actionable results.`,
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
    projectPath,
    folderPath,
    homePath,
    provider,
    remainingDepth = 0,
    proposeSkillFn,
    onProgress,
    webAccessEnabled,
    allowlistService,
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
      projectPath,
      folderPath,
      homePath,
      provider,
      proposeSkillFn,
      onProgress,
      webAccessEnabled,
      allowlistService,
    };

    const spawnAgentImpl = async (
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

    spawnAgentFn = spawnAgentImpl;

    spawnAgentsParallelFn = async (
      agents: Array<{ type: AgentType; query: string; outputPath: string }>,
    ): Promise<SpawnResult[]> => {
      const typeCounters: Partial<Record<AgentType, number>> = {};
      return Promise.all(
        agents.map(({ type, query, outputPath }) => {
          typeCounters[type] = (typeCounters[type] ?? 0) + 1;
          const label = `[${type}-${typeCounters[type]}]`;
          return spawnAgentImpl(type, query, outputPath, label);
        }),
      );
    };
  }

  const skillContent = await loadSkillsByContent(skills, folderPath ?? undefined);
  const systemPrompt = [systemPromptAddition, skillContent].filter(Boolean).join("\n\n");

  const tools = createAgentTools({
    projectId,
    projectName,
    projectPath,
    folderPath,
    homePath,
    apiKey: provider.type === "ollama" ? "ollama" : provider.apiKey,
    model: provider.model,
    toolNames: effectiveToolNames,
    webAccessEnabled,
    // requestEvaluationFn is provided unconditionally, but the toolNames filter in
    // createAgentTools will exclude request_evaluation unless "request_evaluation"
    // is in toolNames. Evaluator agents always use ["read_file", "safe_bash"], so
    // they will never receive the request_evaluation tool — preventing infinite recursion.
    requestEvaluationFn: makeEvaluatorFn({
      projectId,
      projectName,
      projectPath,
      folderPath,
      homePath,
      provider,
      webAccessEnabled,
      allowlistService,
    }),
    proposeSkillFn,
    spawnAgentFn,
    spawnAgentsParallelFn,
    allowlistService,
  });

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model: createModel({ provider }),
      tools,
    },
    getApiKey: async () => (provider.type === "ollama" ? "ollama" : provider.apiKey),
  });

  const run = (input: string): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      let output = "";
      const unsubscribe = agent.subscribe(async (event) => {
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
          unsubscribe();
          resolve(output);
        }
      });
      agent.prompt(input).catch((err) => {
        unsubscribe();
        reject(err);
      });
    });

  return { agent, run };
}
