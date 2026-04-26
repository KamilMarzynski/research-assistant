import { describe, expect, it, vi } from "vitest";
import { createAgentTools } from "./tools";

const BASE = {
  projectId: "p1",
  projectName: "Test",
  folderPath: null,
  homePath: "/tmp/home",
};

describe("createAgentTools – toolNames filter", () => {
  it("returns all built-in tools when toolNames not provided", () => {
    const tools = createAgentTools(BASE);
    const names = tools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("list_dir");
    expect(names).toContain("safe_bash");
  });

  it("filters to specified tool names", () => {
    const tools = createAgentTools({ ...BASE, toolNames: ["read_file", "list_dir"] });
    expect(tools.map((t) => t.name)).toEqual(["read_file", "list_dir"]);
  });

  it("excludes start_research when startResearchFn not provided even if in toolNames", () => {
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["read_file", "start_research"],
    });
    expect(tools.map((t) => t.name)).toEqual(["read_file"]);
  });

  it("includes start_research when startResearchFn provided and in toolNames", () => {
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["read_file", "start_research"],
      startResearchFn: vi.fn().mockResolvedValue({ taskId: "x" }),
    });
    expect(tools.map((t) => t.name)).toContain("start_research");
  });

  it("excludes request_evaluation when requestEvaluationFn not provided", () => {
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["read_file", "request_evaluation"],
    });
    expect(tools.map((t) => t.name)).not.toContain("request_evaluation");
  });

  it("includes request_evaluation when requestEvaluationFn provided and in toolNames", () => {
    const fn = vi.fn().mockResolvedValue({ pass: true, criteria: [] });
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["read_file", "request_evaluation"],
      requestEvaluationFn: fn,
    });
    expect(tools.map((t) => t.name)).toContain("request_evaluation");
  });
});

describe("createAgentTools – request_evaluation execute path", () => {
  it("calls requestEvaluationFn with jail-validated path and criteria, returns verdict", async () => {
    const verdict = {
      pass: true,
      criteria: [{ name: "completeness", pass: true, rationale: "All sections present" }],
    };
    const evaluateFn = vi.fn().mockResolvedValue(verdict);

    // PathJail uses homedir() to build workspace: homedir()/.research-assistant/workspace/<projectId>/
    // With projectId "p1", the allowed workspace path is homedir()/.research-assistant/workspace/p1/
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const filePath = join(homedir(), ".research-assistant", "workspace", "p1", "output.md");

    const tools = createAgentTools({
      ...BASE,
      toolNames: ["request_evaluation"],
      requestEvaluationFn: evaluateFn,
    });

    const tool = tools.find((t) => t.name === "request_evaluation");
    expect(tool).toBeDefined();

    // biome-ignore lint/style/noNonNullAssertion: expect above confirmed defined
    const result = await tool!.execute("call-1", { filePath, criteria: ["covers topic X"] });

    expect(evaluateFn).toHaveBeenCalledWith(filePath, ["covers topic X"]);
    expect(result.details).toEqual(verdict);
    const firstContent = result.content[0];
    expect(firstContent.type).toBe("text");
    expect((firstContent as { type: "text"; text: string }).text).toContain('"pass": true');
  });
});
