import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryFileService } from "../MemoryFileService";

describe("MemoryFileService", () => {
  let tmpDir: string;
  let service: MemoryFileService;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `memory-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    service = new MemoryFileService(tmpDir, tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("saves memory with YAML frontmatter", async () => {
    const result = await service.saveMemory("philosophy", "Test", "# Hello", "app");
    const content = await readFile(result.path, "utf-8");
    expect(content).toContain('title: "Test"');
    expect(content).toContain("category: philosophy");
    expect(content).toContain("scope: app");
    expect(content).toContain("# Hello");
  });

  it("reads memories by category", async () => {
    await service.saveMemory("philosophy", "A", "content A", "app");
    await service.saveMemory("decision", "B", "content B", "app");

    const result = await service.readMemory({
      category: "philosophy",
      scope: "app",
    });
    expect(result).toContain("A");
    expect(result).not.toContain("B");
  });

  it("reads memories by query", async () => {
    await service.saveMemory("philosophy", "Alpha", "unique keyword xyz", "app");
    await service.saveMemory("decision", "Beta", "other stuff", "app");

    const result = await service.readMemory({ query: "xyz", scope: "app" });
    expect(result).toContain("Alpha");
    expect(result).not.toContain("Beta");
  });

  it("returns no memories found when dir is empty", async () => {
    const result = await service.readMemory({ scope: "app" });
    expect(result).toContain("No memories found");
  });

  it("falls back to app dir when project dir not writable", async () => {
    const readOnlyProjectDir = join(tmpdir(), `ro-${Date.now()}`);
    await mkdir(readOnlyProjectDir, { recursive: true });
    await chmod(readOnlyProjectDir, 0o555);
    const roService = new MemoryFileService(tmpDir, readOnlyProjectDir);
    const result = await roService.saveMemory("finding", "F", "data", "project");
    expect(result.path.startsWith(tmpDir)).toBe(true);
    await chmod(readOnlyProjectDir, 0o755);
    await rm(readOnlyProjectDir, { recursive: true, force: true });
  });
});
