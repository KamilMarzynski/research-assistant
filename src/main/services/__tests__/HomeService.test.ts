import "reflect-metadata";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => tmpHome,
  };
});

const { HomeService } = await import("../HomeService");

describe("HomeService", () => {
  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "home-test-"));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("ensureDirectories creates required dirs", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();

    const { access } = await import("node:fs/promises");
    await expect(access(join(tmpHome, ".research-assistant"))).resolves.toBeUndefined();
    await expect(access(join(tmpHome, ".research-assistant", "skills"))).resolves.toBeUndefined();
    await expect(
      access(join(tmpHome, ".research-assistant", "workspace")),
    ).resolves.toBeUndefined();
    await expect(access(join(tmpHome, ".research-assistant", "projects"))).resolves.toBeUndefined();
    await expect(access(join(tmpHome, ".agents", "skills"))).resolves.toBeUndefined();
  });

  it("isFirstRun returns true when config.md missing", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    expect(await svc.isFirstRun()).toBe(true);
  });

  it("isFirstRun returns false after config.md is written", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    await writeFile(join(tmpHome, ".research-assistant", "config.md"), "# Config");
    expect(await svc.isFirstRun()).toBe(false);
  });

  it("ensureWorkspaceForProject creates and returns workspace dir", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    const dir = await svc.ensureWorkspaceForProject("proj-abc");
    const { access } = await import("node:fs/promises");
    await expect(access(dir)).resolves.toBeUndefined();
    expect(dir).toContain("proj-abc");
  });

  it("ensureDirectories copies builtin skills when skills dir is empty", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    const entries = await readdir(join(tmpHome, ".research-assistant", "skills"));
    expect(entries).toContain("start_research");
    expect(entries).toContain("discover_project");
  });

  it("ensureDirectories does NOT overwrite existing skills", async () => {
    // Pre-create skills dir with an existing skill
    const skillsDir = join(tmpHome, ".research-assistant", "skills");
    await mkdir(skillsDir, { recursive: true });
    await mkdir(join(skillsDir, "my-custom-skill"), { recursive: true });
    await writeFile(join(skillsDir, "my-custom-skill", "SKILL.md"), "# Custom");

    const svc = new HomeService();
    await svc.ensureDirectories();

    // Should not copy builtin skills since dir is not empty
    const entries = await readdir(skillsDir);
    expect(entries).not.toContain("start_research");
    expect(entries).toContain("my-custom-skill");
  });
});

describe("task persistence", () => {
  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "home-test-"));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("saveTask writes JSON file to tasks/", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    const task = {
      taskId: "task-abc",
      projectId: "proj-1",
      projectName: "My Project",
      query: "research something",
      folderPath: null,
      startedAt: "2026-04-26T10:00:00.000Z",
    };
    await svc.saveTask(task);
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(
      join(tmpHome, ".research-assistant", "tasks", "task-abc.json"),
      "utf-8",
    );
    expect(JSON.parse(raw)).toEqual(task);
  });

  it("deleteTask removes the JSON file", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    const task = {
      taskId: "task-del",
      projectId: "p",
      projectName: "P",
      query: "q",
      folderPath: null,
      startedAt: "2026-04-26T10:00:00.000Z",
    };
    await svc.saveTask(task);
    await svc.deleteTask("task-del");
    const { access } = await import("node:fs/promises");
    await expect(
      access(join(tmpHome, ".research-assistant", "tasks", "task-del.json")),
    ).rejects.toThrow();
  });

  it("getInProgressTasks returns all saved tasks", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    const tasks = [
      {
        taskId: "t1",
        projectId: "p1",
        projectName: "P1",
        query: "q1",
        folderPath: null,
        startedAt: "2026-04-26T10:00:00.000Z",
      },
      {
        taskId: "t2",
        projectId: "p2",
        projectName: "P2",
        query: "q2",
        folderPath: "/some/path",
        startedAt: "2026-04-26T11:00:00.000Z",
      },
    ];
    for (const t of tasks) await svc.saveTask(t);
    const result = await svc.getInProgressTasks();
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.taskId).sort()).toEqual(["t1", "t2"]);
  });

  it("getInProgressTasks returns empty array when tasks/ dir is empty", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    expect(await svc.getInProgressTasks()).toEqual([]);
  });

  it("deleteTask is idempotent — no error on missing file", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    await expect(svc.deleteTask("nonexistent")).resolves.toBeUndefined();
  });
});

describe("builtin skills", () => {
  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "home-test-"));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("evaluate-research skill is written on ensureDirectories", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(
      join(tmpHome, ".research-assistant", "skills", "evaluate-research", "SKILL.md"),
      "utf-8",
    );
    expect(content).toContain("evaluate-research");
  });
});
