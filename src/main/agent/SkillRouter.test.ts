import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillRouter } from "./SkillRouter";

vi.mock("chokidar", () => ({
  watch: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock("../utils/frontmatter", () => ({
  parseFrontmatter: (content: string) => {
    const name = content.match(/^name:\s*(.+)$/m)?.[1];
    const description = content.match(/^description:\s*(.+)$/m)?.[1];
    return {
      name,
      description,
    };
  },
}));

describe("SkillRouter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "skill-router-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("buildIndex", () => {
    it("scans directories, parses frontmatter, and builds index", async () => {
      const skillDir = join(tmpDir, "skills");
      const researchDir = join(skillDir, "research");
      mkdirSync(researchDir, { recursive: true });
      writeFileSync(
        join(researchDir, "SKILL.md"),
        "---\nname: research\ndescription: Performs web research\n---\n# Research Skill",
      );

      const router = new SkillRouter([skillDir]);
      const index = await router.buildIndex();

      expect(index.skills).toHaveLength(1);
      expect(index.skills[0]).toEqual({
        name: "research",
        description: "Performs web research",
        location: join(researchDir, "SKILL.md"),
      });
      expect(index.lastScan).toBeGreaterThan(0);
    });

    it("later directories override earlier on name collision", async () => {
      const dirA = join(tmpDir, "skills-a");
      const dirB = join(tmpDir, "skills-b");
      const skillDirA = join(dirA, "shared");
      const skillDirB = join(dirB, "shared");
      mkdirSync(skillDirA, { recursive: true });
      mkdirSync(skillDirB, { recursive: true });

      writeFileSync(join(skillDirA, "SKILL.md"), "---\nname: shared\ndescription: Version A\n---");
      writeFileSync(join(skillDirB, "SKILL.md"), "---\nname: shared\ndescription: Version B\n---");

      const router = new SkillRouter([dirA, dirB]);
      const index = await router.buildIndex();

      expect(index.skills).toHaveLength(1);
      expect(index.skills[0].description).toBe("Version B");
      expect(index.skills[0].location).toBe(join(skillDirB, "SKILL.md"));
    });

    it("ignores directories without SKILL.md", async () => {
      const skillDir = join(tmpDir, "skills");
      const emptyDir = join(skillDir, "empty-skill");
      mkdirSync(emptyDir, { recursive: true });
      writeFileSync(join(emptyDir, "README.md"), "# No skill here");

      const router = new SkillRouter([skillDir]);
      const index = await router.buildIndex();
      expect(index.skills).toHaveLength(0);
    });

    it("ignores skills with .disabled file", async () => {
      const skillDir = join(tmpDir, "skills");
      const disabledDir = join(skillDir, "disabled-skill");
      mkdirSync(disabledDir, { recursive: true });
      writeFileSync(
        join(disabledDir, "SKILL.md"),
        "---\nname: disabled-skill\ndescription: Should not appear\n---",
      );
      writeFileSync(join(disabledDir, ".disabled"), "");

      const router = new SkillRouter([skillDir]);
      const index = await router.buildIndex();
      expect(index.skills).toHaveLength(0);
    });

    it("ignores malformed entries missing frontmatter", async () => {
      const skillDir = join(tmpDir, "skills");
      const badDir = join(skillDir, "bad-skill");
      mkdirSync(badDir, { recursive: true });
      writeFileSync(join(badDir, "SKILL.md"), "# No frontmatter here");

      const router = new SkillRouter([skillDir]);
      const index = await router.buildIndex();
      expect(index.skills).toHaveLength(0);
    });

    it("ignores entries where readFile throws", async () => {
      const skillDir = join(tmpDir, "skills");
      const dirSkill = join(skillDir, "dir-skill");
      mkdirSync(dirSkill, { recursive: true });
      // Create a directory named SKILL.md to make readFile throw EISDIR
      mkdirSync(join(dirSkill, "SKILL.md"), { recursive: true });

      const router = new SkillRouter([skillDir]);
      const index = await router.buildIndex();
      expect(index.skills).toHaveLength(0);
    });

    it("returns empty index when no skill dirs exist", async () => {
      const router = new SkillRouter([join(tmpDir, "nonexistent")]);
      const index = await router.buildIndex();
      expect(index.skills).toHaveLength(0);
    });
  });

  describe("getIndex", () => {
    it("returns cached index without rescanning", async () => {
      const skillDir = join(tmpDir, "skills");
      const researchDir = join(skillDir, "research");
      mkdirSync(researchDir, { recursive: true });
      writeFileSync(
        join(researchDir, "SKILL.md"),
        "---\nname: research\ndescription: Performs web research\n---",
      );

      const router = new SkillRouter([skillDir]);
      const first = await router.buildIndex();
      const second = router.getIndex();
      expect(second).toBe(first);
    });
  });

  describe("toXml", () => {
    it("produces valid XML with escaped content", async () => {
      const skillDir = join(tmpDir, "skills");
      const trickyDir = join(skillDir, "tricky");
      mkdirSync(trickyDir, { recursive: true });
      writeFileSync(
        join(trickyDir, "SKILL.md"),
        '---\nname: tricky\ndescription: Uses <html> & "quotes"\n---',
      );

      const router = new SkillRouter([skillDir]);
      await router.buildIndex();
      const xml = router.toXml();

      expect(xml).toContain("<available_skills>");
      expect(xml).toContain("</available_skills>");
      expect(xml).not.toContain("read_skill");
      expect(xml).toContain('name="tricky"');
      expect(xml).toContain('description="Uses &lt;html&gt; &amp; &quot;quotes&quot;"');
      expect(xml).not.toContain("path=");
      expect(xml).not.toContain("<html>");
      expect(xml).not.toContain('"quotes"');
    });

    it("includes only skill entries inside the XML index", async () => {
      const skillDir = join(tmpDir, "skills");
      const alphaDir = join(skillDir, "alpha");
      const betaDir = join(skillDir, "beta");
      mkdirSync(alphaDir, { recursive: true });
      mkdirSync(betaDir, { recursive: true });
      writeFileSync(join(alphaDir, "SKILL.md"), "---\nname: alpha\ndescription: First\n---");
      writeFileSync(join(betaDir, "SKILL.md"), "---\nname: beta\ndescription: Second\n---");

      const router = new SkillRouter([skillDir]);
      await router.buildIndex();

      expect(router.toXml()).toBe(
        [
          "<available_skills>",
          '  <skill name="alpha" description="First" />',
          '  <skill name="beta" description="Second" />',
          "</available_skills>",
        ].join("\n"),
      );
    });

    it("returns empty string when no skills are indexed", () => {
      const router = new SkillRouter([]);
      expect(router.toXml()).toBe("");
    });
  });

  describe("loadSkill", () => {
    it("returns full SKILL.md content", async () => {
      const skillDir = join(tmpDir, "skills");
      const researchDir = join(skillDir, "research");
      mkdirSync(researchDir, { recursive: true });
      writeFileSync(
        join(researchDir, "SKILL.md"),
        "---\nname: research\ndescription: Performs web research\n---\n# Instructions\nDo the thing.",
      );

      const router = new SkillRouter([skillDir]);
      await router.buildIndex();
      const content = await router.loadSkill("research");

      expect(content).toContain("# Instructions");
      expect(content).toContain("Do the thing.");
      expect(content).toContain("name: research");
    });

    it("throws when skill is not found", async () => {
      const router = new SkillRouter([]);
      await router.buildIndex();
      await expect(router.loadSkill("missing")).rejects.toThrow(
        'Skill "missing" not found in index',
      );
    });
  });

  describe("loadSkillWithExtras", () => {
    it("returns SKILL.md + extra .md files combined", async () => {
      const skillDir = join(tmpDir, "skills");
      const researchDir = join(skillDir, "research");
      mkdirSync(researchDir, { recursive: true });
      writeFileSync(
        join(researchDir, "SKILL.md"),
        "---\nname: research\ndescription: Performs web research\n---\n# Main",
      );
      writeFileSync(join(researchDir, "extras.md"), "# Extras\nMore details here.");
      writeFileSync(join(researchDir, "another.md"), "# Another\nEven more.");

      const router = new SkillRouter([skillDir]);
      await router.buildIndex();
      const content = await router.loadSkillWithExtras("research");

      const parts = content.split("\n\n---\n\n");
      expect(parts).toHaveLength(3);
      expect(parts[0]).toContain("# Main");
      expect(parts[1]).toContain("# Another");
      expect(parts[2]).toContain("# Extras");
    });

    it("puts SKILL.md first regardless of alphabetical order", async () => {
      const skillDir = join(tmpDir, "skills");
      const researchDir = join(skillDir, "research");
      mkdirSync(researchDir, { recursive: true });
      writeFileSync(
        join(researchDir, "SKILL.md"),
        "---\nname: research\ndescription: Performs web research\n---\n# Main",
      );
      writeFileSync(join(researchDir, "aaa.md"), "# AAA");

      const router = new SkillRouter([skillDir]);
      await router.buildIndex();
      const content = await router.loadSkillWithExtras("research");

      expect(content.startsWith("---")).toBe(true);
      const mainIndex = content.indexOf("# Main");
      const aaaIndex = content.indexOf("# AAA");
      expect(mainIndex).toBeLessThan(aaaIndex);
    });

    it("throws when skill is not found", async () => {
      const router = new SkillRouter([]);
      await router.buildIndex();
      await expect(router.loadSkillWithExtras("missing")).rejects.toThrow(
        'Skill "missing" not found in index',
      );
    });
  });
});
