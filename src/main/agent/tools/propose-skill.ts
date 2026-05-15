import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

export function createProposeSkillTool(
  proposeFn: (
    name: string,
    skillContent: string,
    script: string | undefined,
    scope: "global" | "project",
    update: boolean,
  ) => Promise<void>,
): AgentTool<typeof proposeSkillParameters, null> {
  return {
    name: "propose_skill",
    label: "Propose new or updated skill",
    description:
      "Propose a new or updated skill for the user to review and approve. " +
      "Use scope='global' for skills useful across all projects, or scope='project' for project-specific helpers. " +
      "Set update=true to propose an update to an existing skill — the tool will error if the skill does not exist. " +
      "Without update=true (default), the tool will error if a skill with the same name already exists. " +
      "The skill becomes available in future sessions once approved.",
    parameters: proposeSkillParameters,
    execute: async (
      _id,
      { name, description: _desc, skillContent, script, scope, update },
    ): Promise<AgentToolResult<null>> => {
      if (!/^[a-z0-9-]+$/.test(name)) {
        throw new Error(
          `Invalid skill name "${name}": only lowercase letters, digits, and hyphens allowed`,
        );
      }
      await proposeFn(name, skillContent, script, scope ?? "global", update ?? false);
      return {
        content: [
          {
            type: "text" as const,
            text: `Skill "${name}" proposed as ${update ? "update" : "new"} (scope: ${scope ?? "global"}) and pending user approval.`,
          },
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
  scope: Type.Optional(
    Type.Union([Type.Literal("global"), Type.Literal("project")], {
      description:
        "Whether this skill is for all projects ('global') or just this project ('project'). Defaults to 'global'.",
    }),
  ),
  update: Type.Optional(
    Type.Boolean({
      description:
        "Set to true to propose an update to an existing skill. Defaults to false (new skill). " +
        "The tool errors if update=false and the skill already exists, or if update=true and it does not.",
    }),
  ),
});
