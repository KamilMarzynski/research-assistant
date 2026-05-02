import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { makeTool } from "./make-tool";

export function createProposeToolTool(
  proposeFn: (name: string, skillContent: string, script?: string) => Promise<void>,
): AgentTool<typeof proposeToolParameters, null> {
  return makeTool({
    name: "propose_tool",
    label: "Propose new tool",
    description:
      "Propose a new skill/tool for the user to review and approve. The tool becomes available in future sessions once approved.",
    parameters: proposeToolParameters,
    execute: async (
      _id,
      { name, description: _desc, skillContent, script },
    ): Promise<AgentToolResult<null>> => {
      if (!/^[a-z0-9-]+$/.test(name)) {
        throw new Error(
          `Invalid tool name "${name}": only lowercase letters, digits, and hyphens allowed`,
        );
      }
      await proposeFn(name, skillContent, script);
      return {
        content: [
          { type: "text" as const, text: `Tool "${name}" proposed and pending user approval.` },
        ],
        details: null,
      };
    },
  });
}

const proposeToolParameters = Type.Object({
  name: Type.String({
    description: "Kebab-case tool name (lowercase letters, digits, hyphens only)",
  }),
  description: Type.String({ description: "What the tool does" }),
  skillContent: Type.String({ description: "Full markdown skill file content" }),
  script: Type.Optional(
    Type.String({ description: "Optional shell script to bundle with the skill" }),
  ),
});
