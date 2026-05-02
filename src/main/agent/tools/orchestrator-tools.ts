import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { type TSchema, Type } from "@sinclair/typebox";
import type { PathJail } from "../path-jail";
import type { AgentType, SpawnResult } from "../tools";

function makeTool<TParams extends TSchema, TDetails>(
  tool: AgentTool<TParams, TDetails>,
): AgentTool<TParams, TDetails> {
  return tool;
}

export function createSpawnAgentTool(
  jail: PathJail,
  spawnFn: (type: AgentType, query: string, outputPath: string) => Promise<SpawnResult>,
): AgentTool<typeof spawnAgentParameters, SpawnResult> {
  return makeTool({
    name: "spawn_agent",
    label: "Spawn agent",
    description:
      "Spawn a child agent (researcher, coder, or orchestrator) to handle a subtask. Blocks until the child completes and returns a summary.",
    parameters: spawnAgentParameters,
    execute: async (_id, { type, query, outputPath }): Promise<AgentToolResult<SpawnResult>> => {
      const resolvedPath = jail.validate(outputPath, "write");
      const result = await spawnFn(type as AgentType, query, resolvedPath);
      return {
        content: [{ type: "text" as const, text: result.summary }],
        details: result,
      };
    },
  });
}

const spawnAgentParameters = Type.Object({
  type: Type.Union(
    [Type.Literal("researcher"), Type.Literal("coder"), Type.Literal("orchestrator")],
    { description: "Agent type to spawn" },
  ),
  query: Type.String({ description: "Task description for the child agent" }),
  outputPath: Type.String({
    description: "Absolute path where the child agent should write its output",
  }),
});

export function createSpawnAgentsParallelTool(
  jail: PathJail,
  spawnParallelFn: (
    agents: Array<{ type: AgentType; query: string; outputPath: string }>,
  ) => Promise<SpawnResult[]>,
): AgentTool<typeof spawnAgentsParallelParameters, SpawnResult[]> {
  return makeTool({
    name: "spawn_agents_parallel",
    label: "Spawn agents in parallel",
    description:
      "Spawn multiple child agents concurrently. All run in parallel; returns when all complete.",
    parameters: spawnAgentsParallelParameters,
    execute: async (_id, { agents }): Promise<AgentToolResult<SpawnResult[]>> => {
      const validated = agents.map(({ type, query, outputPath }) => ({
        type: type as AgentType,
        query,
        outputPath: jail.validate(outputPath, "write"),
      }));
      const results = await spawnParallelFn(validated);
      const summary = results.map((r, i) => `[${i + 1}] ${r.summary}`).join("\n\n");
      return {
        content: [{ type: "text" as const, text: summary }],
        details: results,
      };
    },
  });
}

const spawnAgentsParallelParameters = Type.Object({
  agents: Type.Array(
    Type.Object({
      type: Type.Union(
        [Type.Literal("researcher"), Type.Literal("coder"), Type.Literal("orchestrator")],
        { description: "Agent type" },
      ),
      query: Type.String({ description: "Task description" }),
      outputPath: Type.String({ description: "Absolute path for output" }),
    }),
    { description: "List of agents to spawn" },
  ),
});
