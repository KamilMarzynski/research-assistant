import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { makeTool } from "./make-tool";

export function createCompressTool(
  compressFn: (path: string, maxWords: number) => Promise<string>,
): AgentTool<typeof compressParameters, { summary: string }> {
  return makeTool({
    name: "compress",
    label: "Compress file content",
    description:
      "Read a file and return a compressed/summarized version. Use when context is full.",
    parameters: compressParameters,
    execute: async (_id, { path, maxWords }) => {
      const summary = await compressFn(path, maxWords);
      return {
        content: [{ type: "text", text: summary }],
        details: { summary },
      };
    },
  });
}

const compressParameters = Type.Object({
  path: Type.String({ description: "Path to file to compress" }),
  maxWords: Type.Number({ default: 200, description: "Maximum words in summary" }),
});
