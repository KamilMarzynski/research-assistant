import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../event-bus";
import { AllowlistService } from "../AllowlistService";
import { MemoryFileService } from "../MemoryFileService";

function createMockAllowlistService(): AllowlistService {
  const svc = Object.create(AllowlistService.prototype);
  svc.isAllowed = vi.fn().mockReturnValue({ allowed: true, needsApproval: false });
  svc.approveSession = vi.fn();
  svc.clearSession = vi.fn();
  return svc;
}

describe("MemoryFileService", () => {
  let tmpDir: string;
  let service: MemoryFileService;
  let allowlistService: AllowlistService;
  let eventBus: EventBus;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `memory-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    allowlistService = createMockAllowlistService();
    eventBus = new EventBus();
    service = new MemoryFileService(tmpDir, tmpDir, allowlistService, eventBus);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("saves memory with YAML frontmatter", async () => {
    const result = await service.saveMemory("proj-1", "philosophy", "Test", "# Hello", "app");
    const content = await readFile(result.path, "utf-8");
    expect(content).toContain('title: "Test"');
    expect(content).toContain("category: philosophy");
    expect(content).toContain("scope: app");
    expect(content).toContain("# Hello");
  });

  it("reads memories by category", async () => {
    await service.saveMemory("proj-1", "philosophy", "A", "content A", "app");
    await service.saveMemory("proj-1", "decision", "B", "content B", "app");

    const result = await service.readMemory({
      category: "philosophy",
      scope: "app",
    });
    expect(result).toContain("A");
    expect(result).not.toContain("B");
  });

  it("reads memories by query", async () => {
    await service.saveMemory("proj-1", "philosophy", "Alpha", "unique keyword xyz", "app");
    await service.saveMemory("proj-1", "decision", "Beta", "other stuff", "app");

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
    const roService = new MemoryFileService(tmpDir, readOnlyProjectDir, allowlistService, eventBus);
    const result = await roService.saveMemory("proj-1", "finding", "F", "data", "project");
    expect(result.path.startsWith(tmpDir)).toBe(true);
    await chmod(readOnlyProjectDir, 0o755);
    await rm(readOnlyProjectDir, { recursive: true, force: true });
  });

  it("uses scholarProjectPath when provided for saveMemory", async () => {
    const projectDir = join(tmpdir(), `proj-${Date.now()}`);
    await mkdir(projectDir, { recursive: true });
    const result = await service.saveMemory(
      "proj-1",
      "finding",
      "G",
      "data",
      "project",
      projectDir,
    );
    expect(result.path.startsWith(join(projectDir, "memories"))).toBe(true);
    await rm(projectDir, { recursive: true, force: true });
  });

  it("uses scholarProjectPath when provided for readMemory", async () => {
    const projectDir = join(tmpdir(), `proj-${Date.now()}`);
    await mkdir(projectDir, { recursive: true });
    await service.saveMemory("proj-1", "philosophy", "H", "project content", "project", projectDir);

    const result = await service.readMemory({ scope: "project", scholarProjectPath: projectDir });
    expect(result).toContain("H");
    expect(result).toContain("project content");
    await rm(projectDir, { recursive: true, force: true });
  });

  it("throws ApprovalRequiredError when path needs approval", async () => {
    allowlistService.isAllowed = vi.fn().mockReturnValue({ allowed: false, needsApproval: true });
    await expect(service.saveMemory("proj-1", "finding", "X", "data", "app")).rejects.toThrow(
      "Approval required",
    );
  });

  it("throws when path is outside allowed zones and does not need approval", async () => {
    allowlistService.isAllowed = vi.fn().mockReturnValue({ allowed: false, needsApproval: false });
    await expect(service.saveMemory("proj-1", "finding", "X", "data", "app")).rejects.toThrow(
      "outside allowed memory directories",
    );
  });

  it("falls back to finding for invalid category", async () => {
    const result = await service.saveMemory("proj-1", "invalid-category", "Cat", "content", "app");
    const content = await readFile(result.path, "utf-8");
    expect(content).toContain("category: finding");
  });

  it("uses untitled when title is empty", async () => {
    const result = await service.saveMemory("proj-1", "finding", "", "content", "app");
    expect(result.path.endsWith("untitled.md")).toBe(true);
  });

  it("saveMemory with project scope and no scholarProjectPath uses projectMemoryPath", async () => {
    const result = await service.saveMemory("proj-1", "finding", "NoScholar", "content", "project");
    expect(result.path.startsWith(join(tmpDir, "memories", "finding"))).toBe(true);
  });

  it("readMemory with scope=both includes both app and project memories", async () => {
    await service.saveMemory("proj-1", "philosophy", "BothA", "app content", "app");
    await service.saveMemory("proj-1", "philosophy", "BothB", "project content", "project");
    const result = await service.readMemory({ scope: "both" });
    expect(result).toContain("BothA");
    expect(result).toContain("BothB");
  });

  it("readMemory skips categories that are not directories", async () => {
    // Create a regular file inside the app memory path to simulate non-dir
    const badFile = join(tmpDir, "not-a-dir");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(badFile, "oops", "utf-8");
    const result = await service.readMemory({ scope: "app" });
    expect(result).toContain("No memories found");
  });

  it("readMemory filters out non-matching categories", async () => {
    await service.saveMemory("proj-1", "philosophy", "MatchCat", "content", "app");
    const result = await service.readMemory({ category: "decision", scope: "app" });
    expect(result).toContain("No memories found");
  });

  it("readMemory filters out non-matching queries", async () => {
    await service.saveMemory("proj-1", "philosophy", "QueryA", "alpha content", "app");
    const result = await service.readMemory({ query: "zzzzzzz", scope: "app" });
    expect(result).toContain("No memories found");
  });

  it("readMemory handles malformed frontmatter gracefully", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const catDir = join(tmpDir, "philosophy");
    await mkdir(catDir, { recursive: true });
    await writeFile(
      join(catDir, "bad.md"),
      "---\ntitle: 123\ncategory: 456\ncreated_at: 789\n---\nbody",
      "utf-8",
    );
    const result = await service.readMemory({ scope: "app" });
    expect(result).toContain("body");
  });
});
