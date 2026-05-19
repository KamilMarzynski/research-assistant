import { describe, expect, it } from "vitest";
import { orchestratorPrompt, researcherPrompt } from "../prompts";

const dirs = {
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

  it("includes methodology section", () => {
    expect(researcherPrompt(dirs, "/output.md")).toContain("## Methodology");
  });

  it("includes output section", () => {
    expect(researcherPrompt(dirs, "/output.md")).toContain("## Output");
  });

  it("includes output routing when filesMdContent provided", () => {
    expect(researcherPrompt(dirs, "/output.md", "# Files")).toContain("## Output routing");
  });
});

describe("orchestratorPrompt", () => {
  it("identifies as a research orchestrator", () => {
    expect(orchestratorPrompt(dirs, "/output.md")).toContain("You are a research orchestrator");
  });

  it("includes planning section", () => {
    expect(orchestratorPrompt(dirs, "/output.md")).toContain("## Planning");
  });

  it("includes synthesis section", () => {
    expect(orchestratorPrompt(dirs, "/output.md")).toContain("## Synthesis");
  });

  it("includes output routing when filesMdContent provided", () => {
    expect(orchestratorPrompt(dirs, "/output.md", "# Files")).toContain("## Output routing");
  });
});
