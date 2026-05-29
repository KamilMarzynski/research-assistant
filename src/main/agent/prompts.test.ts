import "reflect-metadata";
import { describe, expect, it } from "vitest";
import {
  BASE_SYSTEM_PROMPT,
  buildAgentDirs,
  finisherPrompt,
  orchestratorPrompt,
  researcherPrompt,
} from "./prompts";

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

  it("contains the update-over-create rule with <available_skills> + read_skill steps", () => {
    const out = researcherPrompt(dirs, "/out", undefined, brief);
    expect(out).toContain("## Update over create");
    expect(out).toContain("<available_skills>");
    expect(out).toContain("read_skill");
  });

  it("instructs researcher not to attempt format conversion", () => {
    const out = researcherPrompt(dirs, "/out", undefined, brief);
    expect(out).toContain("DO NOT attempt format conversion");
    expect(out).toContain("Never spend cycles on conversion");
  });

  it("uses the new ### Files changed handoff format", () => {
    const out = researcherPrompt(dirs, "/out", undefined, brief);
    expect(out).toContain("### Files changed");
    expect(out).not.toContain("### Output Files");
  });
});

describe("orchestratorPrompt", () => {
  const dirs = buildAgentDirs({
    folderPath: "/u/proj",
    homePath: "/h/.scholar",
    slug: "p",
    taskWorkspaceDir: "/h/.scholar/projects/p/workspace/T1",
  });
  const brief = "<research_brief><user_request>R</user_request></research_brief>";

  it("includes the verbatim brief in a Research Brief section", () => {
    const out = orchestratorPrompt(dirs, "/out", undefined, brief);
    expect(out).toContain("## Research Brief");
    expect(out).toContain(brief);
  });

  it("instructs the orchestrator to construct sub-briefs", () => {
    const out = orchestratorPrompt(dirs, "/out", undefined, brief);
    expect(out).toContain("sub-brief");
    expect(out).toContain("spawn_agents_parallel");
  });

  it("uses ### Files changed handoff with union semantics", () => {
    const out = orchestratorPrompt(dirs, "/out", undefined, brief);
    expect(out).toContain("### Files changed");
    expect(out).toContain("union");
    expect(out).not.toContain("### Output Files");
  });
});

describe("finisherPrompt", () => {
  const dirs = buildAgentDirs({
    folderPath: "/u/proj",
    homePath: "/h/.scholar",
    slug: "p",
    taskWorkspaceDir: "/h/.scholar/projects/p/workspace/T1",
  });
  const brief = "<research_brief><user_request>R</user_request></research_brief>";

  it("includes the brief verbatim", () => {
    const out = finisherPrompt(dirs, undefined, brief);
    expect(out).toContain("## Research Brief (forwarded from coordinator)");
    expect(out).toContain(brief);
  });

  it("lists do-NOT-touch persistent surfaces", () => {
    const out = finisherPrompt(dirs, undefined, brief);
    expect(out).toContain("What you do NOT touch");
    expect(out).toContain("FILES.md");
    expect(out).toContain("GOAL.md");
    expect(out).toContain("config.md");
    expect(out).toContain("skill bodies");
  });

  it("documents the idempotency rule", () => {
    const out = finisherPrompt(dirs, undefined, brief);
    expect(out).toContain("Idempotency");
    expect(out).toContain("Do not overwrite correct work");
  });

  it("instructs format conversion via skills not inline scripts", () => {
    const out = finisherPrompt(dirs, undefined, brief);
    expect(out).toContain("read_skill");
    expect(out).toContain("execute_code");
    expect(out).toContain("do NOT improvise heavy logic");
  });

  it("includes FILES.md as delivery contract when present", () => {
    const out = finisherPrompt(dirs, "## Output locations\n- default: ./reports", brief);
    expect(out).toContain("Delivery contract — FILES.md");
    expect(out).toContain("default: ./reports");
  });
});
