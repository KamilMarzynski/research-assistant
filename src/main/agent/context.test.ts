import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => tmpHome };
});

const { loadSkills, buildSystemContext } = await import("./context");

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
    await writeFile(
      join(home, "projects", slug, "AGENTS.md"),
      "# Context for cool project.",
    );

    const result = await buildSystemContext("proj-1", "My Cool Project!", undefined);
    expect(result).toContain("Context for cool project.");
  });
});
