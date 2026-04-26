import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { loadSkillsByContent } from "./context";
import type { AgentToolName, EvaluationVerdict } from "./tools";
import { createAgentTools } from "./tools";

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
  } = config;

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
    toolNames,
    requestEvaluationFn: makeEvaluatorFn({
      projectId,
      projectName,
      folderPath,
      homePath,
      apiKey,
      model,
    }),
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
