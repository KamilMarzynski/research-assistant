import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => tmpHome };
});

const { loadSkills, buildSystemContext, toSlug, loadSkillsByContent } = await import("./context");

describe("loadSkills", () => {
  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "ctx-test-"));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("returns empty string when no skill dirs exist", async () => {
    const result = await loadSkills(undefined);
    expect(result).toBe("");
  });

  it("returns XML with skills found in ~/.research-assistant/skills", async () => {
    const skillDir = join(tmpHome, ".research-assistant", "skills", "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: my-skill\ndescription: Does something useful.\n---\n# Content`,
    );

    const result = await loadSkills(undefined);
    expect(result).toContain("<available_skills>");
    expect(result).toContain("<name>my-skill</name>");
    expect(result).toContain("<description>Does something useful.</description>");
    expect(result).toContain("SKILL.md</location>");
  });

  it("project-level skill overrides global when same name", async () => {
    const globalDir = join(tmpHome, ".research-assistant", "skills", "shared-skill");
    const projectDir = "/tmp/myproject-ctx-test/.agents/skills/shared-skill";

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

    const result = await loadSkills("/tmp/myproject-ctx-test");
    expect(result).toContain("Project version.");
    expect(result).not.toContain("Global version.");

    await rm("/tmp/myproject-ctx-test", { recursive: true, force: true });
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

  it("returns empty string when no context files exist", async () => {
    const result = await buildSystemContext("proj-1", "my project", undefined);
    expect(result).toBe("");
  });

  it("includes config.md content when present", async () => {
    const home = join(tmpHome, ".research-assistant");
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "config.md"), "# My working style\nI prefer folders.");

    const result = await buildSystemContext("proj-1", "my project", undefined);
    expect(result).toContain("I prefer folders.");
  });

  it("includes AGENTS.md content when present", async () => {
    const home = join(tmpHome, ".research-assistant");
    const slug = "my-project";
    await mkdir(join(home, "projects", slug), { recursive: true });
    await writeFile(
      join(home, "projects", slug, "AGENTS.md"),
      "# My Project context\nThis is a TypeScript monorepo.",
    );

    const result = await buildSystemContext("proj-1", "my project", undefined);
    expect(result).toContain("TypeScript monorepo.");
  });

  it("generates correct slug from project name", async () => {
    const home = join(tmpHome, ".research-assistant");
    // "My Cool Project!" → "my-cool-project"
    const slug = "my-cool-project";
    await mkdir(join(home, "projects", slug), { recursive: true });
    await writeFile(join(home, "projects", slug, "AGENTS.md"), "# Context for cool project.");

    const result = await buildSystemContext("proj-1", "My Cool Project!", undefined);
    expect(result).toContain("Context for cool project.");
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
    const skillDir = join(tmpHome, ".research-assistant", "skills", "my-skill");
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
      const dir = join(tmpHome, ".research-assistant", "skills", name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), `# ${name}`);
    }
    const result = await loadSkillsByContent(["skill-a", "skill-b"], undefined);
    expect(result).toContain("# skill-a");
    expect(result).toContain("# skill-b");
  });
});
