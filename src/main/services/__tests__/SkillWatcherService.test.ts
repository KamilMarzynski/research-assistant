import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SkillWatcherService } from "../SkillWatcherService";

async function withTempDir(prefix: string, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = join("/tmp", `${prefix}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("SkillWatcherService", () => {
  it("emits skill:changed when a skill file is modified", async () => {
    await withTempDir("skill-watcher-test", async (dir) => {
      const skillDir = join(dir, "skills");
      await mkdir(skillDir, { recursive: true });
      const skillFile = join(skillDir, "my-skill", "SKILL.md");
      await mkdir(join(skillDir, "my-skill"), { recursive: true });
      await writeFile(
        skillFile,
        '---\nname: my-skill\ndescription: A test skill\n---\nContent here.',
      );

      const emit = vi.fn();
      const manifestPath = join(dir, "manifest.json");
      const service = new SkillWatcherService({
        skillDirs: [skillDir],
        emit,
        manifestPath,
      });

      await service.start();
      // Wait for the initial add event (if any) and let chokidar settle
      await new Promise((r) => setTimeout(r, 300));

      // Modify the file
      await writeFile(
        skillFile,
        '---\nname: my-skill\ndescription: A test skill updated\n---\nContent here updated.',
      );
      await new Promise((r) => setTimeout(r, 300));

      service.stop();

      expect(emit).toHaveBeenCalled();
      expect(emit.mock.calls.some((call) => call[0].payload.skillName === "my-skill")).toBe(true);
    });
  });

  it("does not emit when file content has not changed (hash idempotency)", async () => {
    await withTempDir("skill-watcher-idempotent", async (dir) => {
      const skillDir = join(dir, "skills");
      await mkdir(skillDir, { recursive: true });
      const skillFile = join(skillDir, "stable-skill", "SKILL.md");
      await mkdir(join(skillDir, "stable-skill"), { recursive: true });
      const content = '---\nname: stable-skill\ndescription: Stable\n---\nContent.';
      await writeFile(skillFile, content);

      const emit = vi.fn();
      const manifestPath = join(dir, "manifest.json");

      // First service instance: initial scan
      const service1 = new SkillWatcherService({
        skillDirs: [skillDir],
        emit,
        manifestPath,
      });
      await service1.start();
      await new Promise((r) => setTimeout(r, 300));
      service1.stop();

      const callCountAfterFirst = emit.mock.calls.length;

      // Second service instance: same file, should not emit again
      const service2 = new SkillWatcherService({
        skillDirs: [skillDir],
        emit,
        manifestPath,
      });
      await service2.start();
      await new Promise((r) => setTimeout(r, 300));
      service2.stop();

      expect(emit.mock.calls.length).toBe(callCountAfterFirst);
    });
  });

  it("persists manifest and reads it back on restart", async () => {
    await withTempDir("skill-watcher-manifest", async (dir) => {
      const skillDir = join(dir, "skills");
      await mkdir(skillDir, { recursive: true });
      const skillFile = join(skillDir, "persisted-skill", "SKILL.md");
      await mkdir(join(skillDir, "persisted-skill"), { recursive: true });
      const content = '---\nname: persisted-skill\ndescription: Persisted\n---\nData.';
      await writeFile(skillFile, content);

      const emit = vi.fn();
      const manifestPath = join(dir, "manifest.json");

      const service1 = new SkillWatcherService({
        skillDirs: [skillDir],
        emit,
        manifestPath,
      });
      await service1.start();
      await new Promise((r) => setTimeout(r, 300));
      service1.stop();

      expect(emit).toHaveBeenCalled();

      // Restart with new service
      const emit2 = vi.fn();
      const service2 = new SkillWatcherService({
        skillDirs: [skillDir],
        emit: emit2,
        manifestPath,
      });
      await service2.start();
      await new Promise((r) => setTimeout(r, 300));
      service2.stop();

      // No new emit because manifest already knows the hash
      expect(emit2).not.toHaveBeenCalled();
    });
  });
});
