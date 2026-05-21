import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

const startResearchParameters = Type.Object({
  brief: Type.String({
    description:
      "A <research_brief> XML chunk built by the coordinator. Must contain all required tags: user_request, coordinator_read, durability, expected_outcomes, success_criteria, existing_state_to_consult, constraints, out_of_scope. Forwarded verbatim to the research worker — code does not parse it.",
  }),
  deep: Type.Optional(
    Type.Boolean({
      description:
        "true → orchestrator with parallel subtasks. false → single researcher. Default false.",
    }),
  ),
});

export function createStartResearchTool(
  startResearchFn: (brief: string, deep?: boolean) => Promise<{ taskId: string }>,
): AgentTool<typeof startResearchParameters, { taskId: string }> {
  return {
    name: "start_research",
    label: "Start background research",
    description:
      "Dispatch a background research task. Returns immediately with a taskId. A summary will be injected into this conversation when the research completes.",
    parameters: startResearchParameters,
    execute: async (_id, { brief, deep }) => {
      const { taskId } = await startResearchFn(brief, deep);
      return {
        content: [
          {
            type: "text" as const,
            text: `Research task started (taskId: ${taskId}). I'll report back when it completes.`,
          },
        ],
        details: { taskId },
      };
    },
  };
}
