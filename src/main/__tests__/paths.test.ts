import { describe, expect, it } from "vitest";
import {
  getHomePath,
  getProjectConfigPath,
  getScholarHome,
  getSkillsPath,
  getWorkspacePath,
} from "../paths";

describe("paths", () => {
  it("getScholarHome returns a path containing .scholar", () => {
    const home = getScholarHome();
    expect(home).toContain(".scholar");
  });

  it("getHomePath is an alias for getScholarHome", () => {
    expect(getHomePath()).toBe(getScholarHome());
  });

  it("getSkillsPath returns a path under scholar home", () => {
    const path = getSkillsPath();
    expect(path).toContain("skills");
    expect(path).toContain(".scholar");
  });

  it("getWorkspacePath returns a path under project workspace", () => {
    const path = getWorkspacePath("my-project");
    expect(path).toContain("projects");
    expect(path).toContain("my-project");
    expect(path).toContain("workspace");
    expect(path).toContain(".scholar");
  });

  it("getProjectConfigPath returns a path under projects with the given slug", () => {
    const path = getProjectConfigPath("my-project");
    expect(path).toContain("projects");
    expect(path).toContain("my-project");
    expect(path).toContain(".scholar");
  });
});
