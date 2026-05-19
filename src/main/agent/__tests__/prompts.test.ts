import { describe, expect, it } from "vitest";
import { type AgentDirs, finisherPrompt, orchestratorPrompt, researcherPrompt } from "../prompts";

const dirs: AgentDirs = {
  userProjectDir: "/user/project",
  assistantDir: "/home/.scholar",
  assistantProjectDir: "/home/.scholar/projects/test",
  taskWorkspaceDir: "/home/.scholar/projects/test/workspace/abc",
  assistantProjectSkillsDir: "/home/.scholar/projects/test/skills",
};

describe("researcherPrompt", () => {
  it("includes ## Handoff section", () => {
    expect(researcherPrompt(dirs, "/output.md")).toContain("## Handoff");
  });
  it("includes ### Output Files instruction", () => {
    expect(researcherPrompt(dirs, "/output.md")).toContain("### Output Files");
  });
});

describe("orchestratorPrompt", () => {
  it("includes ## Handoff section", () => {
    expect(orchestratorPrompt(dirs, "/output.md")).toContain("## Handoff");
  });
  it("instructs to aggregate sub-agent output file declarations", () => {
    expect(orchestratorPrompt(dirs, "/output.md")).toContain("union");
  });
});

describe("finisherPrompt", () => {
  it("instructs to use mv via safe_bash", () => {
    const p = finisherPrompt(dirs);
    expect(p).toContain("mv");
    expect(p).toContain("safe_bash");
  });
  it("instructs to use read_memory", () => {
    expect(finisherPrompt(dirs)).toContain("read_memory");
  });
  it("instructs never to recreate files", () => {
    expect(finisherPrompt(dirs)).toContain("Never recreate");
  });
  it("includes Output Routing section when filesMdContent provided", () => {
    expect(finisherPrompt(dirs, "# Files")).toContain("Output Routing");
  });
  it("omits Output Routing section when no filesMdContent", () => {
    expect(finisherPrompt(dirs)).not.toContain("Output Routing");
  });
});
