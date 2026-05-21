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
  it("identifies as a background researcher", () => {
    expect(researcherPrompt(dirs, "/output.md")).toContain("You are a background researcher");
  });
  it("includes approach section", () => {
    expect(researcherPrompt(dirs, "/output.md")).toContain("## Approach");
  });
  it("includes output section", () => {
    expect(researcherPrompt(dirs, "/output.md")).toContain("## Output");
  });
  it("includes ## Handoff section", () => {
    expect(researcherPrompt(dirs, "/output.md")).toContain("## Handoff");
  });
  it("includes ### Files changed instruction", () => {
    expect(researcherPrompt(dirs, "/output.md")).toContain("### Files changed");
  });
  it("includes FILES.md routing when filesMdContent provided", () => {
    expect(researcherPrompt(dirs, "/output.md", "# Files")).toContain("## Output Routing");
  });
});

describe("orchestratorPrompt", () => {
  it("identifies as a research orchestrator", () => {
    expect(orchestratorPrompt(dirs, "/output.md")).toContain("You are a research orchestrator");
  });
  it("includes planning section", () => {
    expect(orchestratorPrompt(dirs, "/output.md")).toContain("## Planning");
  });
  it("includes ## Handoff section", () => {
    expect(orchestratorPrompt(dirs, "/output.md")).toContain("## Handoff");
  });
  it("instructs to aggregate sub-agent output file declarations", () => {
    expect(orchestratorPrompt(dirs, "/output.md")).toContain("union");
  });
  it("includes FILES.md routing when filesMdContent provided", () => {
    expect(orchestratorPrompt(dirs, "/output.md", "# Files")).toContain("## Output Routing");
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
  it("documents idempotency — do not overwrite correct work", () => {
    expect(finisherPrompt(dirs)).toContain("Do not overwrite correct work");
  });
  it("includes Delivery contract section when filesMdContent provided", () => {
    expect(finisherPrompt(dirs, "# Files")).toContain("Delivery contract — FILES.md");
  });
  it("omits old Output Routing section", () => {
    expect(finisherPrompt(dirs)).not.toContain("Output Routing");
  });
});
