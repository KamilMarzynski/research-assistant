import { describe, expect, it } from "vitest";
import {
  getAgentsHome,
  getAgentsPath,
  getHomePath,
  getProjectSkillsPaths,
  getResearchAssistantHome,
  getSkillsPath,
  getWorkspacePath,
} from "../paths";

describe("paths", () => {
  it("getResearchAssistantHome returns a path containing .research-assistant", () => {
    const home = getResearchAssistantHome();
    expect(home).toContain(".research-assistant");
  });

  it("getAgentsHome returns a path containing .agents", () => {
    const home = getAgentsHome();
    expect(home).toContain(".agents");
  });

  it("getHomePath is an alias for getResearchAssistantHome", () => {
    expect(getHomePath()).toBe(getResearchAssistantHome());
  });

  it("getAgentsPath is an alias for getAgentsHome", () => {
    expect(getAgentsPath()).toBe(getAgentsHome());
  });

  it("getSkillsPath returns a path under research-assistant home", () => {
    const path = getSkillsPath();
    expect(path).toContain("skills");
    expect(path).toContain(".research-assistant");
  });

  it("getWorkspacePath returns a path under research-assistant home", () => {
    const path = getWorkspacePath();
    expect(path).toContain("workspace");
    expect(path).toContain(".research-assistant");
  });

  it("getProjectSkillsPaths returns both agent and research-assistant skill dirs", () => {
    const paths = getProjectSkillsPaths("/my/project");
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain(".agents/skills");
    expect(paths[1]).toContain(".research-assistant/skills");
  });
});
