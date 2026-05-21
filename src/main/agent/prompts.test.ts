import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { BASE_SYSTEM_PROMPT } from "./prompts";

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
