import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { PathJail } from "../path-jail";
import type { EvaluationVerdict } from "../tools";

export function createRequestEvaluationTool(
  jail: PathJail,
  evaluateFn: (filePath: string, criteria: string[]) => Promise<EvaluationVerdict>,
): AgentTool<typeof requestEvaluationParameters, EvaluationVerdict> {
  return {
    name: "request_evaluation",
    label: "Request evaluation",
    description:
      "Ask the evaluator agent to assess a research output file against a list of criteria. Returns a structured pass/fail verdict.",
    parameters: requestEvaluationParameters,
    execute: async (_id, { filePath, criteria }): Promise<AgentToolResult<EvaluationVerdict>> => {
      const resolvedPath = jail.validate(filePath, "read");
      const verdict = await evaluateFn(resolvedPath, criteria);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(verdict, null, 2) }],
        details: verdict,
      };
    },
  };
}

const requestEvaluationParameters = Type.Object({
  filePath: Type.String({ description: "Absolute path to the research output file" }),
  criteria: Type.Array(Type.String(), {
    description: "List of criteria to evaluate the file against",
  }),
});
