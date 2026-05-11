import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpHome: string;

vi.mock("node:os", () => ({
  tmpdir: () => "/tmp",
  homedir: () => tmpHome,
}));

const { loadSkillIndexXml, buildSystemContext, toSlug, loadSkillsByContent } = await import(
  "./context"
);

describe("loadSkillIndexXml", () => {
  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "ctx-test-"));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("returns empty string when no skill dirs exist", async () => {
    const result = await loadSkillIndexXml(undefined);
    expect(result).toBe("");
  });

  it("returns XML with skills found in ~/.scholar/skills", async () => {
    const skillDir = join(tmpHome, ".scholar", "skills", "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: my-skill\ndescription: Does something useful.\n---\n# Content`,
    );

    const result = await loadSkillIndexXml(undefined);
    expect(result).toContain("<available_skills>");
    expect(result).toContain('name="my-skill"');
    expect(result).toContain('description="Does something useful."');
  });

  it("project-level skill overrides global when same name", async () => {
    const globalDir = join(tmpHome, ".scholar", "skills", "shared-skill");
    const projectDir = "/tmp/myproject-ctx-test/.scholar/skills/shared-skill";

    await mkdir(globalDir, { recursive: true });
    await writeFile(
      join(globalDir, "SKILL.md"),
      `---\nname: shared-skill\ndescription: Global version.\n---`,
    );

    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, "SKILL.md"),
      `---\nname: shared-skill\ndescription: Project version.\n---`,
    );

    const result = await loadSkillIndexXml("/tmp/myproject-ctx-test");
    expect(result).toContain("Project version.");
    expect(result).not.toContain("Global version.");

    await rm("/tmp/myproject-ctx-test", { recursive: true, force: true });
  });

  it("skips skill directories that contain .disabled file", async () => {
    const skillDir = join(tmpHome, ".scholar", "skills", "disabled-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: disabled-skill\ndescription: Should not appear.\n---\n# Content",
    );
    await writeFile(join(skillDir, ".disabled"), "");

    const result = await loadSkillIndexXml(undefined);
    expect(result).not.toContain("disabled-skill");
  });

  it("skips malformed skill entries missing frontmatter", async () => {
    const skillDir = join(tmpHome, ".scholar", "skills", "bad-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# No frontmatter here");

    const result = await loadSkillIndexXml(undefined);
    expect(result).not.toContain("bad-skill");
  });

  it("skips skill entries where readFile throws", async () => {
    const skillDir = join(tmpHome, ".scholar", "skills", "dir-skill");
    await mkdir(skillDir, { recursive: true });
    // Create a directory named SKILL.md to make readFile throw EISDIR
    await mkdir(join(skillDir, "SKILL.md"), { recursive: true });

    const result = await loadSkillIndexXml(undefined);
    expect(result).not.toContain("dir-skill");
  });
});

describe("toSlug", () => {
  it("converts to lowercase with spaces as hyphens", () => {
    expect(toSlug("My Cool Project")).toBe("my-cool-project");
  });

  it("strips non-alphanumeric characters", () => {
    expect(toSlug("My Cool Project!")).toBe("my-cool-project");
  });

  it("collapses multiple spaces", () => {
    expect(toSlug("hello   world")).toBe("hello-world");
  });

  it("trims leading and trailing hyphens", () => {
    expect(toSlug("!hello world!")).toBe("hello-world");
  });

  it("handles empty string", () => {
    expect(toSlug("")).toBe("");
  });

  it("handles all-special characters", () => {
    expect(toSlug("!!!")).toBe("");
  });
});

describe("buildSystemContext", () => {
  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "ctx-test-"));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("returns onboarding prompt when no context files exist", async () => {
    const result = await buildSystemContext("my project", undefined);
    expect(result).toContain("no AGENTS.md yet");
    expect(result).toContain("If the user already described");
  });

  it("includes config.md content when present", async () => {
    const home = join(tmpHome, ".scholar");
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "config.md"), "# My working style\nI prefer folders.");

    const result = await buildSystemContext("my project", undefined);
    expect(result).toContain("I prefer folders.");
  });

  it("includes AGENTS.md content when present", async () => {
    const home = join(tmpHome, ".scholar");
    const slug = "my-project";
    await mkdir(join(home, "projects", slug), { recursive: true });
    await writeFile(
      join(home, "projects", slug, "AGENTS.md"),
      "# My Project context\nThis is a TypeScript monorepo.",
    );

    const result = await buildSystemContext("my project", undefined);
    expect(result).toContain("TypeScript monorepo.");
  });

  it("skips empty config.md", async () => {
    const home = join(tmpHome, ".scholar");
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "config.md"), "   ");

    const result = await buildSystemContext("my project", undefined);
    expect(result).not.toContain("config.md");
  });

  it("skips empty AGENTS.md", async () => {
    const home = join(tmpHome, ".scholar");
    const slug = "my-project";
    await mkdir(join(home, "projects", slug), { recursive: true });
    await writeFile(join(home, "projects", slug, "AGENTS.md"), "   ");

    const result = await buildSystemContext("my project", undefined);
    expect(result).not.toContain("Project context");
  });

  it("generates correct slug from project name", async () => {
    const home = join(tmpHome, ".scholar");
    // "My Cool Project!" → "my-cool-project"
    const slug = "my-cool-project";
    await mkdir(join(home, "projects", slug), { recursive: true });
    await writeFile(join(home, "projects", slug, "AGENTS.md"), "# Context for cool project.");

    const result = await buildSystemContext("My Cool Project!", undefined);
    expect(result).toContain("Context for cool project.");
  });

  it("includes skills XML when skills are present", async () => {
    const home = join(tmpHome, ".scholar");
    const skillDir = join(home, "skills", "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: my-skill\ndescription: Does something.\n---\n# Content",
    );

    const result = await buildSystemContext("my project", undefined);
    expect(result).toContain("<available_skills>");
    expect(result).toContain('name="my-skill"');
  });

  it("injects onboarding prompt when AGENTS.md is missing", async () => {
    const result = await buildSystemContext("Test Project", undefined);
    expect(result).toContain("no AGENTS.md yet");
    expect(result).toContain("If they have not yet described it");
  });

  it("loads existing AGENTS.md when present", async () => {
    const home = join(tmpHome, ".scholar");
    const slug = "test-project";
    await mkdir(join(home, "projects", slug), { recursive: true });
    await writeFile(
      join(home, "projects", slug, "AGENTS.md"),
      "# Test Project\nThis is the project context.",
    );

    const result = await buildSystemContext("Test Project", undefined);
    expect(result).toContain("This is the project context.");
    expect(result).not.toContain("no AGENTS.md yet");
  });

  it("includes app-level MEMORY.md when present", async () => {
    const home = join(tmpHome, ".scholar");
    await mkdir(join(home, "app-memory"), { recursive: true });
    await writeFile(join(home, "app-memory", "MEMORY.md"), "# App Memory\nI remember things.");

    const result = await buildSystemContext("my project", undefined);
    expect(result).toContain("App Memory");
    expect(result).toContain("I remember things.");
  });

  it("includes project-level MEMORY.md when present", async () => {
    const projectDir = join(tmpHome, "my-project-folder");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "MEMORY.md"), "# Project Memory\nThis project uses Bun.");

    const result = await buildSystemContext("my project", projectDir);
    expect(result).toContain("Project Memory");
    expect(result).toContain("This project uses Bun.");
  });
});

describe("loadSkillsByContent", () => {
  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "ctx-test-"));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("returns empty string for empty names array", async () => {
    expect(await loadSkillsByContent([], undefined)).toBe("");
  });

  it("returns SKILL.md full content for a matching skill", async () => {
    const skillDir = join(tmpHome, ".scholar", "skills", "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: my-skill\ndescription: does stuff\n---\n# Instructions\nDo the thing.",
    );
    const result = await loadSkillsByContent(["my-skill"], undefined);
    expect(result).toContain("# Instructions");
    expect(result).toContain("Do the thing.");
  });

  it("returns empty string for unknown skill name", async () => {
    const result = await loadSkillsByContent(["nonexistent-skill"], undefined);
    expect(result).toBe("");
  });

  it("joins multiple skills with separator", async () => {
    for (const name of ["skill-a", "skill-b"]) {
      const dir = join(tmpHome, ".scholar", "skills", name);
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "SKILL.md"),
        `---\nname: ${name}\ndescription: does ${name}\n---\n# ${name}`,
      );
    }
    const result = await loadSkillsByContent(["skill-a", "skill-b"], undefined);
    expect(result).toContain("# skill-a");
    expect(result).toContain("# skill-b");
  });

  it("resolves skill from project folder when present", async () => {
    const globalDir = join(tmpHome, ".scholar", "skills", "proj-skill");
    await mkdir(globalDir, { recursive: true });
    await writeFile(
      join(globalDir, "SKILL.md"),
      "---\nname: proj-skill\ndescription: global version\n---\n# global",
    );

    const projectDir = "/tmp/proj-skill-test/.scholar/skills/proj-skill";
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, "SKILL.md"),
      "---\nname: proj-skill\ndescription: project version\n---\n# project",
    );

    const result = await loadSkillsByContent(["proj-skill"], "/tmp/proj-skill-test");
    expect(result).toContain("# project");
    expect(result).not.toContain("# global");

    await rm("/tmp/proj-skill-test", { recursive: true, force: true });
  });
});
