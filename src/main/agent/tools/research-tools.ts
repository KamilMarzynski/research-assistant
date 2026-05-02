import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type TSchema, Type } from "@sinclair/typebox";

function makeTool<TParams extends TSchema, TDetails>(
  tool: AgentTool<TParams, TDetails>,
): AgentTool<TParams, TDetails> {
  return tool;
}

export function createStartResearchTool(
  startResearchFn: (query: string, deep?: boolean) => Promise<{ taskId: string }>,
): AgentTool<typeof startResearchParameters, { taskId: string }> {
  return makeTool({
    name: "start_research",
    label: "Start background research",
    description:
      "Dispatch a background research task. Returns immediately with a taskId. A summary will be injected into this conversation when the research completes.",
    parameters: startResearchParameters,
    execute: async (_id, { query, deep }) => {
      const { taskId } = await startResearchFn(query, deep);
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
  });
}

const startResearchParameters = Type.Object({
  query: Type.String({
    description: "A clear, self-contained research question including all necessary context",
  }),
  deep: Type.Optional(
    Type.Boolean({
      description:
        "Set true for complex multi-source research requiring parallel subtopic investigation, code execution, or hierarchical orchestration. Defaults to false (single researcher).",
    }),
  ),
});
