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

describe("createAgentTools – run_in_docker", () => {
  it("includes run_in_docker when in toolNames", () => {
    const tools = createAgentTools({ ...BASE, toolNames: ["run_in_docker"] });
    expect(tools.map((t) => t.name)).toContain("run_in_docker");
  });

  it("excludes run_in_docker when not in toolNames", () => {
    const tools = createAgentTools({ ...BASE, toolNames: ["read_file"] });
    expect(tools.map((t) => t.name)).not.toContain("run_in_docker");
  });
});

describe("createAgentTools – spawn + orchestrator tools", () => {
  it("excludes spawn_agent when spawnAgentFn not provided", () => {
    const tools = createAgentTools({ ...BASE, toolNames: ["spawn_agent"] });
    expect(tools.map((t) => t.name)).not.toContain("spawn_agent");
  });

  it("includes spawn_agent when spawnAgentFn provided and in toolNames", () => {
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["spawn_agent"],
      spawnAgentFn: vi.fn().mockResolvedValue({ outputPath: "/p", summary: "done" }),
    });
    expect(tools.map((t) => t.name)).toContain("spawn_agent");
  });

  it("excludes spawn_agents_parallel when spawnAgentsParallelFn not provided", () => {
    const tools = createAgentTools({ ...BASE, toolNames: ["spawn_agents_parallel"] });
    expect(tools.map((t) => t.name)).not.toContain("spawn_agents_parallel");
  });

  it("includes spawn_agents_parallel when spawnAgentsParallelFn provided", () => {
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["spawn_agents_parallel"],
      spawnAgentsParallelFn: vi.fn().mockResolvedValue([]),
    });
    expect(tools.map((t) => t.name)).toContain("spawn_agents_parallel");
  });

  it("excludes save_artifact when saveArtifactFn not provided", () => {
    const tools = createAgentTools({ ...BASE, toolNames: ["save_artifact"] });
    expect(tools.map((t) => t.name)).not.toContain("save_artifact");
  });

  it("includes save_artifact when saveArtifactFn provided", () => {
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["save_artifact"],
      saveArtifactFn: vi.fn().mockResolvedValue({ artifactId: "art-1" }),
    });
    expect(tools.map((t) => t.name)).toContain("save_artifact");
  });

  it("excludes propose_tool when proposeToolFn not provided", () => {
    const tools = createAgentTools({ ...BASE, toolNames: ["propose_tool"] });
    expect(tools.map((t) => t.name)).not.toContain("propose_tool");
  });

  it("includes propose_tool when proposeToolFn provided", () => {
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["propose_tool"],
      proposeToolFn: vi.fn().mockResolvedValue(undefined),
    });
    expect(tools.map((t) => t.name)).toContain("propose_tool");
  });

  it("propose_tool rejects invalid name (spaces not allowed)", async () => {
    const proposeToolFn = vi.fn().mockResolvedValue(undefined);
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["propose_tool"],
      proposeToolFn,
    });
    const tool = tools.find((t) => t.name === "propose_tool");
    await expect(
      tool?.execute("call-1", {
        name: "invalid name",
        description: "desc",
        skillContent: "# skill",
      }),
    ).rejects.toThrow(/invalid/i);
    expect(proposeToolFn).not.toHaveBeenCalled();
  });

  it("propose_tool calls proposeToolFn with valid name", async () => {
    const proposeToolFn = vi.fn().mockResolvedValue(undefined);
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["propose_tool"],
      proposeToolFn,
    });
    const tool = tools.find((t) => t.name === "propose_tool");
    await tool?.execute("call-1", {
      name: "fetch-arxiv",
      description: "fetches arxiv papers",
      skillContent: "# fetch-arxiv\n\nFetches arxiv papers.",
    });
    expect(proposeToolFn).toHaveBeenCalledWith(
      "fetch-arxiv",
      "# fetch-arxiv\n\nFetches arxiv papers.",
      undefined,
    );
  });
});

it("includes save_memory and read_memory when functions are provided", () => {
  const tools = createAgentTools({
    ...BASE,
    saveMemoryFn: vi.fn().mockResolvedValue({ path: "/tmp/test.md" }),
    readMemoryFn: vi.fn().mockResolvedValue("test"),
  });
  const names = tools.map((t) => t.name);
  expect(names).toContain("save_memory");
  expect(names).toContain("read_memory");
});

describe("createAgentTools – start_research deep flag", () => {
  it("passes deep=true to startResearchFn when tool called with deep: true", async () => {
    const startResearchFn = vi.fn().mockResolvedValue({ taskId: "t1" });
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["start_research"],
      startResearchFn,
    });
    const tool = tools.find((t) => t.name === "start_research");
    expect(tool).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: expect above confirmed defined
    await tool!.execute("call-1", { query: "research X", deep: true });
    expect(startResearchFn).toHaveBeenCalledWith("research X", true);
  });

  it("passes deep=undefined to startResearchFn when deep omitted", async () => {
    const startResearchFn = vi.fn().mockResolvedValue({ taskId: "t1" });
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["start_research"],
      startResearchFn,
    });
    const tool = tools.find((t) => t.name === "start_research");
    // biome-ignore lint/style/noNonNullAssertion: expect above confirmed defined
    await tool!.execute("call-1", { query: "research X" });
    expect(startResearchFn).toHaveBeenCalledWith("research X", undefined);
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
