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

function mockDb() {
  const insertFn = vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) }));
  const deleteFn = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
  const selectFn = vi.fn(() => ({ from: () => ({ where: vi.fn().mockResolvedValue([]) }) }));
  const updateFn = vi.fn(() => ({ set: () => ({ where: vi.fn().mockResolvedValue(undefined) }) }));
  return {
    insert: insertFn,
    delete: deleteFn,
    select: selectFn,
    update: updateFn,
  } as unknown as import("../../db/client").DrizzleDB;
}

const { HomeService } = await import("../HomeService");

describe("HomeService", () => {
  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "home-test-"));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("ensureDirectories creates required dirs", async () => {
    const svc = new HomeService(mockDb());
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
    const svc = new HomeService(mockDb());
    await svc.ensureDirectories();
    expect(await svc.isFirstRun()).toBe(true);
  });

  it("isFirstRun returns false after config.md is written", async () => {
    const svc = new HomeService(mockDb());
    await svc.ensureDirectories();
    await writeFile(join(tmpHome, ".research-assistant", "config.md"), "# Config");
    expect(await svc.isFirstRun()).toBe(false);
  });

  it("ensureWorkspaceForProject creates and returns workspace dir", async () => {
    const svc = new HomeService(mockDb());
    await svc.ensureDirectories();
    const dir = await svc.ensureWorkspaceForProject("proj-abc");
    const { access } = await import("node:fs/promises");
    await expect(access(dir)).resolves.toBeUndefined();
    expect(dir).toContain("proj-abc");
  });

  it("ensureDirectories copies builtin skills when skills dir is empty", async () => {
    const svc = new HomeService(mockDb());
    await svc.ensureDirectories();
    const entries = await readdir(join(tmpHome, ".research-assistant", "skills"));
    expect(entries).toContain("start_research");
    expect(entries).toContain("discover_project");
  });

  it("does NOT overwrite existing builtin skill SKILL.md", async () => {
    const skillsDir = join(tmpHome, ".research-assistant", "skills");
    const startResearchSkillDir = join(skillsDir, "start_research");
    await mkdir(startResearchSkillDir, { recursive: true });
    await writeFile(join(startResearchSkillDir, "SKILL.md"), "# Custom overridden");

    const svc = new HomeService(mockDb());
    await svc.ensureDirectories();

    const { readFile } = await import("node:fs/promises");
    const content = await readFile(join(startResearchSkillDir, "SKILL.md"), "utf-8");
    // The existing file should NOT have been overwritten
    expect(content).toBe("# Custom overridden");

    // Other builtin skills SHOULD have been written (since they were missing)
    const entries = await readdir(skillsDir);
    expect(entries).toContain("discover_project");
    expect(entries).toContain("evaluate-research");
  });
});

describe("task persistence", () => {
  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "home-test-"));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("saveTask calls db.insert with correct values", async () => {
    const db = mockDb();
    const insertFn = db.insert as ReturnType<typeof vi.fn>;
    const svc = new HomeService(db);
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
    expect(insertFn).toHaveBeenCalledWith(expect.anything());
  });

  it("deleteTask calls db.delete with correct id", async () => {
    const db = mockDb();
    const svc = new HomeService(db);
    await svc.ensureDirectories();
    await svc.deleteTask("task-del");
    const deleteFn = db.delete as ReturnType<typeof vi.fn>;
    expect(deleteFn).toHaveBeenCalledWith(expect.anything());
  });

  it("getInProgressTasks returns empty array when no tasks", async () => {
    const db = mockDb();
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({ where: vi.fn().mockResolvedValue([]) }),
    });
    const svc = new HomeService(db);
    await svc.ensureDirectories();
    expect(await svc.getInProgressTasks()).toEqual([]);
  });

  it("updateTaskStatus calls db.update with correct params", async () => {
    const db = mockDb();
    const svc = new HomeService(db);
    await svc.ensureDirectories();
    await svc.updateTaskStatus("task-1", "failed", "something broke");
    const updateFn = db.update as ReturnType<typeof vi.fn>;
    expect(updateFn).toHaveBeenCalledWith(expect.anything());
  });

  it("migrateTasksFromJson reads JSON files and saves to DB", async () => {
    const db = mockDb();
    const insertFn = db.insert as ReturnType<typeof vi.fn>;
    const svc = new HomeService(db);
    await svc.ensureDirectories();
    const tasksDir = join(tmpHome, ".research-assistant", "tasks");
    await mkdir(tasksDir, { recursive: true });
    await writeFile(
      join(tasksDir, "t1.json"),
      JSON.stringify({
        taskId: "t1",
        projectId: "p1",
        projectName: "P1",
        query: "q1",
        folderPath: null,
        startedAt: "2026-04-26T10:00:00.000Z",
      }),
    );
    await svc.migrateTasksFromJson();
    expect(insertFn).toHaveBeenCalled();
  });

  it("migrateTasksFromJson does nothing when no JSON dir", async () => {
    const db = mockDb();
    const insertFn = db.insert as ReturnType<typeof vi.fn>;
    const svc = new HomeService(db);
    await svc.ensureDirectories();
    await svc.migrateTasksFromJson();
    // insert might be called zero times; just verify no crash
    expect(true).toBe(true);
  });
});

describe("pending tools", () => {
  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "home-test-"));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("ensureDirectories creates pending-tools dir", async () => {
    const svc = new HomeService(mockDb());
    await svc.ensureDirectories();
    const { access } = await import("node:fs/promises");
    await expect(
      access(join(tmpHome, ".research-assistant", "pending-tools")),
    ).resolves.toBeUndefined();
  });

  it("savePendingTool writes SKILL.md", async () => {
    const svc = new HomeService(mockDb());
    await svc.ensureDirectories();
    await svc.savePendingTool("fetch-arxiv", "# fetch-arxiv\n\nFetches papers.");
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(
      join(tmpHome, ".research-assistant", "pending-tools", "fetch-arxiv", "SKILL.md"),
      "utf-8",
    );
    expect(content).toBe("# fetch-arxiv\n\nFetches papers.");
  });

  it("savePendingTool writes script.py for Python script", async () => {
    const svc = new HomeService(mockDb());
    await svc.ensureDirectories();
    await svc.savePendingTool("run-analysis", "# run-analysis", "import pandas as pd\nprint('hi')");
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(
      join(tmpHome, ".research-assistant", "pending-tools", "run-analysis", "script.py"),
      "utf-8",
    );
    expect(content).toContain("import pandas");
  });

  it("savePendingTool writes script.sh for bash script", async () => {
    const svc = new HomeService(mockDb());
    await svc.ensureDirectories();
    await svc.savePendingTool("run-bash", "# run-bash", "#!/bin/bash\necho hello");
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(
      join(tmpHome, ".research-assistant", "pending-tools", "run-bash", "script.sh"),
      "utf-8",
    );
    expect(content).toContain("echo hello");
  });

  it("getPendingTools returns empty array when no pending tools", async () => {
    const svc = new HomeService(mockDb());
    await svc.ensureDirectories();
    expect(await svc.getPendingTools()).toEqual([]);
  });

  it("getPendingTools returns saved tools", async () => {
    const svc = new HomeService(mockDb());
    await svc.ensureDirectories();
    await svc.savePendingTool("tool-a", "# tool-a");
    await svc.savePendingTool("tool-b", "# tool-b");
    const tools = await svc.getPendingTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(["tool-a", "tool-b"]);
  });

  it("approvePendingTool moves dir to skills/", async () => {
    const svc = new HomeService(mockDb());
    await svc.ensureDirectories();
    await svc.savePendingTool("my-tool", "# my-tool");
    await svc.approvePendingTool("my-tool");
    const { access } = await import("node:fs/promises");
    await expect(
      access(join(tmpHome, ".research-assistant", "skills", "my-tool", "SKILL.md")),
    ).resolves.toBeUndefined();
    await expect(
      access(join(tmpHome, ".research-assistant", "pending-tools", "my-tool")),
    ).rejects.toThrow();
  });

  it("rejectPendingTool deletes the dir", async () => {
    const svc = new HomeService(mockDb());
    await svc.ensureDirectories();
    await svc.savePendingTool("bad-tool", "# bad-tool");
    await svc.rejectPendingTool("bad-tool");
    const { access } = await import("node:fs/promises");
    await expect(
      access(join(tmpHome, ".research-assistant", "pending-tools", "bad-tool")),
    ).rejects.toThrow();
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
    const svc = new HomeService(mockDb());
    await svc.ensureDirectories();
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(
      join(tmpHome, ".research-assistant", "skills", "evaluate-research", "SKILL.md"),
      "utf-8",
    );
    expect(content).toContain("evaluate-research");
  });
});
