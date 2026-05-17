import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReadSkillTool } from "../read-skill-tool";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = join(tmpdir(), `read-skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmpHome, { recursive: true });
});

afterEach(async () => {
  await rm(tmpHome, { recursive: true, force: true });
});

async function writeSkill(scopePath: string, dirName: string, content: string): Promise<string> {
  const skillDir = join(scopePath, dirName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), content, "utf-8");
  return skillDir;
}

describe("read_skill tool", () => {
  it("returns SKILL.md body without frontmatter", async () => {
    await writeSkill(
      join(tmpHome, "skills"),
      "summarize",
      "---\nname: summarize\ndescription: Summarize documents\n---\n# Summarize\nDo it.\n",
    );

    const tool = createReadSkillTool("proj", tmpHome);
    const result = await tool.execute("call-1", { skillName: "summarize" });

    expect(result.details.scope).toBe("global");
    expect(result.details.body).toBe("# Summarize\nDo it.");
    expect(result.details.body).not.toContain("description:");
  });

  it("prefers project skill over global skill", async () => {
    await writeSkill(
      join(tmpHome, "skills"),
      "shared",
      "---\nname: shared\ndescription: Global\n---\n# Global\n",
    );
    await writeSkill(
      join(tmpHome, "projects", "proj", "skills"),
      "shared",
      "---\nname: shared\ndescription: Project\n---\n# Project\n",
    );

    const tool = createReadSkillTool("proj", tmpHome);
    const result = await tool.execute("call-1", { skillName: "shared" });

    expect(result.details.scope).toBe("project");
    expect(result.details.body).toBe("# Project");
  });

  it("falls back to directory name when frontmatter name is different", async () => {
    await writeSkill(
      join(tmpHome, "skills"),
      "directory-name",
      "---\nname: frontmatter-name\ndescription: Different\n---\n# Body\n",
    );

    const tool = createReadSkillTool("proj", tmpHome);
    const result = await tool.execute("call-1", { skillName: "directory-name" });

    expect(result.details.name).toBe("directory-name");
    expect(result.details.body).toBe("# Body");
  });

  it("falls back to directory name when frontmatter is missing", async () => {
    await writeSkill(join(tmpHome, "skills"), "no-frontmatter", "# Body without metadata\n");

    const tool = createReadSkillTool("proj", tmpHome);
    const result = await tool.execute("call-1", { skillName: "no-frontmatter" });

    expect(result.details.name).toBe("no-frontmatter");
    expect(result.details.body).toBe("# Body without metadata");
  });

  it("lists nested non-dot files except SKILL.md", async () => {
    const skillDir = await writeSkill(
      join(tmpHome, "skills"),
      "with-files",
      "---\nname: with-files\ndescription: Has files\n---\n# Body\n",
    );
    await mkdir(join(skillDir, "references"), { recursive: true });
    await mkdir(join(skillDir, ".hidden-dir"), { recursive: true });
    await writeFile(join(skillDir, "references", "guide.md"), "# Guide", "utf-8");
    await writeFile(join(skillDir, "script.sh"), "echo ok", "utf-8");
    await writeFile(join(skillDir, ".secret"), "hidden", "utf-8");
    await writeFile(join(skillDir, ".hidden-dir", "ignored.md"), "ignored", "utf-8");

    const tool = createReadSkillTool("proj", tmpHome);
    const result = await tool.execute("call-1", { skillName: "with-files" });

    expect(result.details.files).toEqual([
      { name: "references/guide.md", path: join(skillDir, "references", "guide.md") },
      { name: "script.sh", path: join(skillDir, "script.sh") },
    ]);
  });

  it("rejects invalid skill names", async () => {
    const tool = createReadSkillTool("proj", tmpHome);

    await expect(tool.execute("call-1", { skillName: "../bad" })).rejects.toThrow(
      'Invalid skillName "../bad"',
    );
  });

  it("throws clearly when skill is missing", async () => {
    const tool = createReadSkillTool("proj", tmpHome);

    await expect(tool.execute("call-1", { skillName: "missing" })).rejects.toThrow(
      'Skill "missing" not found',
    );
  });
});
