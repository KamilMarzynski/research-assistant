import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

export function createProposeSkillTool(
  proposeFn: (name: string, skillContent: string, script?: string) => Promise<void>,
): AgentTool<typeof proposeSkillParameters, null> {
  return {
    name: "propose_skill",
    label: "Propose new skill",
    description:
      "Propose a new skill for the user to review and approve. The skill becomes available in future sessions once approved.",
    parameters: proposeSkillParameters,
    execute: async (
      _id,
      { name, description: _desc, skillContent, script },
    ): Promise<AgentToolResult<null>> => {
      if (!/^[a-z0-9-]+$/.test(name)) {
        throw new Error(
          `Invalid skill name "${name}": only lowercase letters, digits, and hyphens allowed`,
        );
      }
      await proposeFn(name, skillContent, script);
      return {
        content: [
          { type: "text" as const, text: `Skill "${name}" proposed and pending user approval.` },
        ],
        details: null,
      };
    },
  };
}

const proposeSkillParameters = Type.Object({
  name: Type.String({
    description: "Kebab-case skill name (lowercase letters, digits, hyphens only)",
  }),
  description: Type.String({ description: "What the skill does" }),
  skillContent: Type.String({ description: "Full markdown skill file content" }),
  script: Type.Optional(
    Type.String({ description: "Optional shell script to bundle with the skill" }),
  ),
});
