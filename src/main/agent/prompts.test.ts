import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { BASE_SYSTEM_PROMPT, buildAgentDirs, researcherPrompt } from "./prompts";

describe("BASE_SYSTEM_PROMPT", () => {
  it("contains the persistent system changes section", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("Persistent system changes");
    expect(BASE_SYSTEM_PROMPT).toContain("Detecting persistent intent");
    expect(BASE_SYSTEM_PROMPT).toContain("Building the research brief");
    expect(BASE_SYSTEM_PROMPT).toContain("Output conventions are mutable");
  });

  it("contains the durability cue list", () => {
    for (const cue of ["always", "from now on", "for this project", "default to", "every time"]) {
      expect(BASE_SYSTEM_PROMPT).toContain(cue);
    }
  });

  it("removes the legacy Skill creation block", () => {
    expect(BASE_SYSTEM_PROMPT).not.toContain("## Skill creation");
    expect(BASE_SYSTEM_PROMPT).not.toMatch(/If the user asks for a skill, write it to/);
  });

  it("instructs the coordinator to pass brief to start_research", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("Pass the brief as the `brief` field of start_research");
  });
});

describe("researcherPrompt", () => {
  const dirs = buildAgentDirs({
    folderPath: "/u/proj",
    homePath: "/h/.scholar",
    slug: "p",
    taskWorkspaceDir: "/h/.scholar/projects/p/workspace/T1",
  });
  const brief = "<research_brief><user_request>R</user_request></research_brief>";

  it("includes the verbatim brief in a Research Brief section", () => {
    const out = researcherPrompt(
      dirs,
      "/h/.scholar/projects/p/workspace/T1/out.md",
      undefined,
      brief,
    );
    expect(out).toContain("## Research Brief");
    expect(out).toContain(brief);
  });

  it("lists mutable surfaces explicitly", () => {
    const out = researcherPrompt(
      dirs,
      "/h/.scholar/projects/p/workspace/T1/out.md",
      undefined,
      brief,
    );
    expect(out).toContain("## Mutable surfaces");
    expect(out).toContain("~/.scholar/skills/");
    expect(out).toContain("FILES.md");
    expect(out).toContain("GOAL.md");
    expect(out).toContain("config.md");
  });

  it("contains the update-over-create rule with list_skills + read_skill steps", () => {
    const out = researcherPrompt(dirs, "/out", undefined, brief);
    expect(out).toContain("## Update over create");
    expect(out).toContain("list_skills");
    expect(out).toContain("read_skill");
  });

  it("contains the format-and-delivery deferral", () => {
    const out = researcherPrompt(dirs, "/out", undefined, brief);
    expect(out).toContain("A finisher agent runs after you");
    expect(out).toContain("prioritize content correctness over final format");
  });

  it("uses the new ### Files changed handoff format", () => {
    const out = researcherPrompt(dirs, "/out", undefined, brief);
    expect(out).toContain("### Files changed");
    expect(out).not.toContain("### Output Files");
  });
});
