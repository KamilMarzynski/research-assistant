import { dirname } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import { z } from "zod/v4";
import type { AllowlistService } from "../services/AllowlistService";
import type { ObservabilityService } from "../services/ObservabilityService";
import { AgentTracer } from "./AgentTracer";
import { loadSkillsByContent } from "./context";
import { createModel } from "./model-factory";
import type { ModelProvider } from "./model-provider";
import {
  buildAgentDirs,
  coderPrompt,
  evaluatorPrompt,
  orchestratorPrompt,
  researcherPrompt,
} from "./prompts";
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
  "execute_code",
  "spawn_agent",
  "spawn_agents_parallel",
] as const;

export interface WorkerAgentConfig {
  toolNames: readonly AgentToolName[];
  systemPromptAddition: string;
  skills?: string[];
  projectId: string;
  slug: string;
  projectName: string;
  projectPath: string | null;
  folderPath: string | null;
  homePath: string;
  /** Ephemeral workspace for this specific research task. Injected into agent prompt. */
  taskWorkspacePath?: string;
  /** Content of FILES.md for this project. Injected into top-level agent prompts to guide output routing. Not passed to child agents. */
  filesMdContent?: string;
  provider: ModelProvider;
  remainingDepth?: number; // defaults to 0 (leaf)
  agentLabel?: string;
  onProgress?: (label: string, delta: string) => void;
  webAccessEnabled?: boolean;
  allowlistService: AllowlistService;
  observabilityService?: ObservabilityService;
  parentSpanContext?: { traceId: string; spanId: string };
}

export interface WorkerAgent {
  agent: Agent;
  run: (input: string) => Promise<string>;
}

export interface EvaluatorBaseConfig {
  projectId: string;
  slug: string;
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
      systemPromptAddition: evaluatorPrompt(),
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

export const AGENT_TYPE_PRESETS: Record<AgentType, PresetBuilder> = {
  researcher: (base, outputPath) => {
    const dirs = buildAgentDirs({
      folderPath: base.folderPath,
      homePath: base.homePath,
      slug: base.slug,
      taskWorkspaceDir: base.taskWorkspacePath ?? dirname(outputPath),
    });
    return {
      ...base,
      toolNames: ["read_file", "write_file", "list_dir", "safe_bash", "fetch_url", "web_search"],
      systemPromptAddition: researcherPrompt(dirs, outputPath, base.filesMdContent),
      remainingDepth: 0,
    };
  },
  coder: (base, outputPath) => {
    const dirs = buildAgentDirs({
      folderPath: base.folderPath,
      homePath: base.homePath,
      slug: base.slug,
      taskWorkspaceDir: base.taskWorkspacePath ?? dirname(outputPath),
    });
    return {
      ...base,
      toolNames: ["read_file", "write_file", "execute_code"],
      systemPromptAddition: coderPrompt(dirs, outputPath),
      remainingDepth: 0,
    };
  },
  orchestrator: (base, outputPath, depth) => {
    const dirs = buildAgentDirs({
      folderPath: base.folderPath,
      homePath: base.homePath,
      slug: base.slug,
      taskWorkspaceDir: base.taskWorkspacePath ?? dirname(outputPath),
    });
    return {
      ...base,
      toolNames: [...ORCHESTRATOR_TOOL_NAMES],
      systemPromptAddition: orchestratorPrompt(dirs, outputPath, base.filesMdContent),
      remainingDepth: depth,
    };
  },
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
    onProgress,
    webAccessEnabled,
    allowlistService,
  } = config;

  const tracer = new AgentTracer({
    observabilityService: config.observabilityService,
    provider: config.provider,
    parentSpanContext: config.parentSpanContext,
    metadata: { agentLabel: config.agentLabel },
  });

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
      slug: config.slug,
      projectName,
      projectPath,
      folderPath,
      homePath,
      taskWorkspacePath: config.taskWorkspacePath,
      filesMdContent: config.filesMdContent,
      provider,
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
      // Children write to workspace temp files — don't inherit FILES.md routing instructions
      const childBase: WorkerAgentBase = {
        ...base,
        taskWorkspacePath: dirname(outputPath),
        filesMdContent: undefined,
      };
      const childConfig = AGENT_TYPE_PRESETS[type](childBase, outputPath, remainingDepth - 1);
      const { run } = await createWorkerAgent({
        ...childConfig,
        agentLabel: effectiveLabel,
        observabilityService: config.observabilityService,
        parentSpanContext: tracer.getSpanContext() ?? undefined,
      });
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
    slug: config.slug,
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
      slug: config.slug,
      projectName,
      projectPath,
      folderPath,
      homePath,
      provider,
      webAccessEnabled,
      allowlistService,
    }),
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

      tracer.startTurn({ query: input }).then(() => {
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
            tracer.endTurn({ summary: output });
            resolve(output);
          }
        });

        // Also subscribe tracer for generation/tool spans
        const unsubscribeTracer = tracer.subscribeToAgent(agent);

        agent.prompt(input).catch((err) => {
          unsubscribe();
          unsubscribeTracer();
          tracer.endTurn({ error: String(err) });
          reject(err);
        });
      });
    });

  return { agent, run };
}
