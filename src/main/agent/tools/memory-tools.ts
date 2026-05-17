import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

export function createSaveMemoryTool(
  saveMemoryFn: (
    category: string,
    title: string,
    content: string,
    scope: "app" | "project",
  ) => Promise<{ path: string }>,
): AgentTool<typeof saveMemoryParameters, { path: string }> {
  return {
    name: "save_memory",
    label: "Save memory",
    description:
      "Persist an important fact, decision, convention, or finding across conversations. " +
      "Use when the user shares preferences or context that should survive session restarts. " +
      "Choose scope=app for universal facts, scope=project for project-specific ones.",
    parameters: saveMemoryParameters,
    execute: async (
      _id,
      { category, title, content, scope },
    ): Promise<AgentToolResult<{ path: string }>> => {
      const result = await saveMemoryFn(category, title, content, scope);
      return {
        content: [{ type: "text" as const, text: `Saved memory to: ${result.path}` }],
        details: result,
      };
    },
  };
}

const saveMemoryParameters = Type.Object({
  category: Type.String({
    description: "Category: philosophy, decision, finding, tool_reference, project_convention",
  }),
  title: Type.String({ description: "Short title for the memory" }),
  content: Type.String({ description: "Markdown content of the memory" }),
  scope: Type.Union([Type.Literal("app"), Type.Literal("project")], {
    description: "app (universal) or project (project-specific)",
  }),
});

export function createReadMemoryTool(
  readMemoryFn: (options: {
    category?: string;
    query?: string;
    scope: "app" | "project" | "both";
  }) => Promise<string>,
): AgentTool<typeof readMemoryParameters, string> {
  return {
    name: "read_memory",
    label: "Read memory",
    description:
      "Read saved memories by category or text search. " +
      "Call when past context might be relevant — user preferences, prior decisions, known conventions. " +
      "Returns matching memories with title, category, timestamp, and excerpt.",
    parameters: readMemoryParameters,
    execute: async (_id, { category, query, scope }): Promise<AgentToolResult<string>> => {
      const text = await readMemoryFn({ category, query, scope });
      return {
        content: [{ type: "text" as const, text }],
        details: text,
      };
    },
  };
}

const readMemoryParameters = Type.Object({
  category: Type.Optional(
    Type.String({
      description:
        "Filter by category: philosophy, decision, finding, tool_reference, project_convention",
    }),
  ),
  query: Type.Optional(Type.String({ description: "Text search across titles and content" })),
  scope: Type.Union([Type.Literal("app"), Type.Literal("project"), Type.Literal("both")], {
    description: "app, project, or both",
  }),
});
