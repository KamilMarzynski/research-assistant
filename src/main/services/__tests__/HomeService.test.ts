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

  it("does NOT overwrite existing builtin skill SKILL.md", async () => {
    const skillsDir = join(tmpHome, ".research-assistant", "skills");
    const startResearchSkillDir = join(skillsDir, "start_research");
    await mkdir(startResearchSkillDir, { recursive: true });
    await writeFile(join(startResearchSkillDir, "SKILL.md"), "# Custom overridden");

    const svc = new HomeService();
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

describe("pending tools", () => {
  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "home-test-"));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("ensureDirectories creates pending-tools dir", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    const { access } = await import("node:fs/promises");
    await expect(
      access(join(tmpHome, ".research-assistant", "pending-tools")),
    ).resolves.toBeUndefined();
  });

  it("savePendingTool writes SKILL.md", async () => {
    const svc = new HomeService();
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
    const svc = new HomeService();
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
    const svc = new HomeService();
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
    const svc = new HomeService();
    await svc.ensureDirectories();
    expect(await svc.getPendingTools()).toEqual([]);
  });

  it("getPendingTools returns saved tools", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    await svc.savePendingTool("tool-a", "# tool-a");
    await svc.savePendingTool("tool-b", "# tool-b");
    const tools = await svc.getPendingTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(["tool-a", "tool-b"]);
  });

  it("approvePendingTool moves dir to skills/", async () => {
    const svc = new HomeService();
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
    const svc = new HomeService();
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
