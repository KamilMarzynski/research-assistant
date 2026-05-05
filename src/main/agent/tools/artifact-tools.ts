import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { PathJail } from "../path-jail";

export function createSaveArtifactTool(
  jail: PathJail,
  saveFn: (path: string, title: string) => Promise<{ artifactId: string }>,
): AgentTool<typeof saveArtifactParameters, { artifactId: string }> {
  return {
    name: "save_artifact",
    label: "Save artifact",
    description: "Register a file as a named research artifact so it appears in the UI.",
    parameters: saveArtifactParameters,
    execute: async (_id, { path, title }): Promise<AgentToolResult<{ artifactId: string }>> => {
      const resolvedPath = jail.validate(path, "read");
      const result = await saveFn(resolvedPath, title);
      return {
        content: [{ type: "text" as const, text: `Artifact saved (id: ${result.artifactId})` }],
        details: result,
      };
    },
  };
}

const saveArtifactParameters = Type.Object({
  path: Type.String({ description: "Absolute path to the artifact file" }),
  title: Type.String({ description: "Human-readable title for the artifact" }),
});
