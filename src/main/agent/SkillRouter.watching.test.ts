import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillRouter } from "./SkillRouter";

// Real chokidar, no mocks — this tests whether filesystem watching actually works.

describe("SkillRouter – file watching (integration)", () => {
  let tmpDir: string;
  let router: SkillRouter;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "skill-router-watch-"));
  });

  afterEach(async () => {
    router?.stopWatching();
    // Small delay to let chokidar close watchers before deleting the dir
    await new Promise((r) => setTimeout(r, 50));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects a new SKILL.md and updates the index", async () => {
    router = new SkillRouter([tmpDir]);
    await router.buildIndex();
    router.startWatching();

    expect(router.toXml()).toBe("");

    const skillDir = join(tmpDir, "my-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: my-skill\ndescription: Does something useful\n---\n# My Skill",
    );

    await vi.waitFor(
      () => {
        expect(router.toXml()).toContain('name="my-skill"');
      },
      { timeout: 3000, interval: 100 },
    );
  });

  it("calls onChange when a new skill is detected", async () => {
    const onChange = vi.fn();
    router = new SkillRouter([tmpDir], onChange);
    await router.buildIndex();
    router.startWatching();

    const skillDir = join(tmpDir, "notify-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: notify-skill\ndescription: Triggers onChange\n---",
    );

    await vi.waitFor(
      () => {
        expect(onChange).toHaveBeenCalledWith(
          "notify-skill",
          expect.stringContaining("Triggers onChange"),
        );
      },
      { timeout: 3000, interval: 100 },
    );
  });

  it("picks up a skill added after watching started", async () => {
    // Pre-populate one skill
    const existingDir = join(tmpDir, "existing");
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(
      join(existingDir, "SKILL.md"),
      "---\nname: existing\ndescription: Was there already\n---",
    );

    router = new SkillRouter([tmpDir]);
    await router.buildIndex();
    router.startWatching();

    expect(router.getIndex().skills).toHaveLength(1);

    // Add a second skill mid-session
    const newDir = join(tmpDir, "late-arrival");
    mkdirSync(newDir, { recursive: true });
    writeFileSync(
      join(newDir, "SKILL.md"),
      "---\nname: late-arrival\ndescription: Added after watch started\n---",
    );

    await vi.waitFor(
      () => {
        expect(router.getIndex().skills).toHaveLength(2);
      },
      { timeout: 3000, interval: 100 },
    );

    expect(router.toXml()).toContain('name="existing"');
    expect(router.toXml()).toContain('name="late-arrival"');
  });
});
