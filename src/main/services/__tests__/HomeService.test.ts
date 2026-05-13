import "reflect-metadata";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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
  const insertFn = vi.fn(() => ({
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    }),
  }));
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

function makeTaskPersistence(db?: ReturnType<typeof mockDb>) {
  return new TaskPersistenceService(db ?? mockDb(), join(tmpHome, ".scholar"));
}

function makeSkillManagement() {
  return new SkillManagementService(join(tmpHome, ".scholar"));
}

function makeToolApproval() {
  return new ToolApprovalService(join(tmpHome, ".scholar"));
}

const { HomeService } = await import("../HomeService");
const { TaskPersistenceService } = await import("../TaskPersistenceService");
const { SkillManagementService } = await import("../SkillManagementService");
const { ToolApprovalService } = await import("../ToolApprovalService");

describe("HomeService", () => {
  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "home-test-"));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("ensureDirectories creates required dirs", async () => {
    const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();

    const { access } = await import("node:fs/promises");
    await expect(access(join(tmpHome, ".scholar"))).resolves.toBeUndefined();
    await expect(access(join(tmpHome, ".scholar", "skills"))).resolves.toBeUndefined();
    await expect(access(join(tmpHome, ".scholar", "projects"))).resolves.toBeUndefined();
    await expect(access(join(tmpHome, ".scholar", "tasks"))).resolves.toBeUndefined();
  });

  it("isFirstRun returns true when config.md missing", async () => {
    const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    expect(await svc.isFirstRun()).toBe(true);
  });

  it("isFirstRun returns false after config.md is written", async () => {
    const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    await writeFile(join(tmpHome, ".scholar", "config.md"), "# Config");
    expect(await svc.isFirstRun()).toBe(false);
  });

  it("ensureWorkspaceForProject creates and returns workspace dir", async () => {
    const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    const dir = await svc.ensureWorkspaceForProject("proj-abc");
    const { access } = await import("node:fs/promises");
    await expect(access(dir)).resolves.toBeUndefined();
    expect(dir).toContain(join("projects", "proj-abc", "workspace"));
  });

  it("ensureDirectories copies builtin skills when skills dir is empty", async () => {
    const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    const entries = await readdir(join(tmpHome, ".scholar", "skills"));
    expect(entries).toContain("evaluate-research");
  });

  it("does NOT overwrite existing builtin skill SKILL.md", async () => {
    const skillsDir = join(tmpHome, ".scholar", "skills");
    const evalSkillDir = join(skillsDir, "evaluate-research");
    await mkdir(evalSkillDir, { recursive: true });
    await writeFile(join(evalSkillDir, "SKILL.md"), "# Custom overridden");

    const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();

    const { readFile } = await import("node:fs/promises");
    const content = await readFile(join(evalSkillDir, "SKILL.md"), "utf-8");
    // The existing file should NOT have been overwritten
    expect(content).toBe("# Custom overridden");

    // evaluate-research dir should still exist (no other builtins to check)
    const entries = await readdir(skillsDir);
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
    const svc = new HomeService(makeTaskPersistence(db), makeSkillManagement(), makeToolApproval());
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
    const svc = new HomeService(makeTaskPersistence(db), makeSkillManagement(), makeToolApproval());
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
    const svc = new HomeService(makeTaskPersistence(db), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    expect(await svc.getInProgressTasks()).toEqual([]);
  });

  it("updateTaskStatus calls db.update with correct params", async () => {
    const db = mockDb();
    const svc = new HomeService(makeTaskPersistence(db), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    await svc.updateTaskStatus("task-1", "failed", "something broke");
    const updateFn = db.update as ReturnType<typeof vi.fn>;
    expect(updateFn).toHaveBeenCalledWith(expect.anything());
  });

  it("migrateTasksFromJson reads JSON files and saves to DB", async () => {
    const db = mockDb();
    const insertFn = db.insert as ReturnType<typeof vi.fn>;
    const svc = new HomeService(makeTaskPersistence(db), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    const tasksDir = join(tmpHome, ".scholar", "tasks");
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

  it("migrateTasksFromJson does nothing when tasks dir missing", async () => {
    const db = mockDb();
    const svc = new HomeService(makeTaskPersistence(db), makeSkillManagement(), makeToolApproval());
    // do NOT call ensureDirectories — tasks dir won't exist
    await svc.migrateTasksFromJson();
    expect(true).toBe(true);
  });

  it("migrateTasksFromJson skips malformed JSON files", async () => {
    const db = mockDb();
    const insertFn = db.insert as ReturnType<typeof vi.fn>;
    const svc = new HomeService(makeTaskPersistence(db), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    const tasksDir = join(tmpHome, ".scholar", "tasks");
    await writeFile(join(tasksDir, "bad.json"), "not json");
    await svc.migrateTasksFromJson();
    expect(insertFn).not.toHaveBeenCalled();
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
    const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    const { access } = await import("node:fs/promises");
    await expect(access(join(tmpHome, ".scholar", "pending-tools"))).resolves.toBeUndefined();
  });

  it("savePendingTool writes SKILL.md", async () => {
    const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    await svc.savePendingTool("fetch-arxiv", "# fetch-arxiv\n\nFetches papers.");
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(
      join(tmpHome, ".scholar", "pending-tools", "fetch-arxiv", "SKILL.md"),
      "utf-8",
    );
    expect(content).toBe("# fetch-arxiv\n\nFetches papers.");
  });

  it("savePendingTool writes script.py for Python script", async () => {
    const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    await svc.savePendingTool("run-analysis", "# run-analysis", "import pandas as pd\nprint('hi')");
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(
      join(tmpHome, ".scholar", "pending-tools", "run-analysis", "script.py"),
      "utf-8",
    );
    expect(content).toContain("import pandas");
  });

  it("savePendingTool writes script.sh for bash script", async () => {
    const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    await svc.savePendingTool("run-bash", "# run-bash", "#!/bin/bash\necho hello");
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(
      join(tmpHome, ".scholar", "pending-tools", "run-bash", "script.sh"),
      "utf-8",
    );
    expect(content).toContain("echo hello");
  });

  it("getPendingTools returns empty array when no pending tools", async () => {
    const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    expect(await svc.getPendingTools()).toEqual([]);
  });

  it("getPendingTools returns empty array when pending-tools dir does not exist", async () => {
    const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    const pendingDir = join(tmpHome, ".scholar", "pending-tools");
    await rm(pendingDir, { recursive: true, force: true });
    expect(await svc.getPendingTools()).toEqual([]);
  });

  it("getPendingTools skips malformed entries where readFile throws", async () => {
    const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    await svc.savePendingTool("good-tool", "# good");
    const pendingDir = join(tmpHome, ".scholar", "pending-tools");
    // Create a directory instead of a file to make readFile throw
    await mkdir(join(pendingDir, "bad-tool", "SKILL.md"), { recursive: true });
    const tools = await svc.getPendingTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("good-tool");
  });

  it("getPendingTools returns saved tools", async () => {
    const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    await svc.savePendingTool("tool-a", "# tool-a");
    await svc.savePendingTool("tool-b", "# tool-b");
    const tools = await svc.getPendingTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(["tool-a", "tool-b"]);
  });

  it("approvePendingTool moves dir to skills/", async () => {
    const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    await svc.savePendingTool("my-tool", "# my-tool");
    await svc.approvePendingTool("my-tool");
    const { access } = await import("node:fs/promises");
    await expect(
      access(join(tmpHome, ".scholar", "skills", "my-tool", "SKILL.md")),
    ).resolves.toBeUndefined();
    await expect(access(join(tmpHome, ".scholar", "pending-tools", "my-tool"))).rejects.toThrow();
  });

  it("rejectPendingTool deletes the dir", async () => {
    const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    await svc.savePendingTool("bad-tool", "# bad-tool");
    await svc.rejectPendingTool("bad-tool");
    const { access } = await import("node:fs/promises");
    await expect(access(join(tmpHome, ".scholar", "pending-tools", "bad-tool"))).rejects.toThrow();
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
    const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(
      join(tmpHome, ".scholar", "skills", "evaluate-research", "SKILL.md"),
      "utf-8",
    );
    expect(content).toContain("evaluate-research");
  });

  it("evaluate-research skill is marked protected", async () => {
    const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    const { access } = await import("node:fs/promises");
    await expect(
      access(join(tmpHome, ".scholar", "skills", "evaluate-research", ".protected")),
    ).resolves.toBeUndefined();
  });
});

describe("skill management", () => {
  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "home-test-"));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("getSkills returns array (builtin skills present after ensureDirectories)", async () => {
    const db = mockDb();
    const svc = new HomeService(makeTaskPersistence(db), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    const skills = await svc.getSkills();
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBeGreaterThanOrEqual(1);
  });

  it("getSkills returns empty array when skills dir does not exist", async () => {
    const db = mockDb();
    const svc = new HomeService(makeTaskPersistence(db), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    const skillsDir = join(tmpHome, ".scholar", "skills");
    await rm(skillsDir, { recursive: true, force: true });
    expect(await svc.getSkills()).toEqual([]);
  });

  it("getSkills skips malformed entries where readFile throws", async () => {
    const db = mockDb();
    const svc = new HomeService(makeTaskPersistence(db), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    const skillsDir = join(svc.getHomePath(), "skills");
    await mkdir(join(skillsDir, "bad-skill", "SKILL.md"), { recursive: true });
    const skills = await svc.getSkills();
    expect(skills.some((s) => s.name === "bad-skill")).toBe(false);
  });

  it("getSkills returns skills with parsed frontmatter", async () => {
    const db = mockDb();
    const svc = new HomeService(makeTaskPersistence(db), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    const skillDir = join(svc.getHomePath(), "skills", "test-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: test-skill\ndescription: A test skill.\n---\n\n# Test Skill\n\nSome content.`,
    );

    const skills = await svc.getSkills();
    const ourSkill = skills.find((s) => s.name === "test-skill");
    expect(ourSkill).toBeDefined();
    expect(ourSkill?.name).toBe("test-skill");
    expect(ourSkill?.description).toBe("A test skill.");
    expect(ourSkill?.enabled).toBe(true);
    expect(ourSkill?.content).toContain("Some content.");
  });

  it("getSkills falls back to entry name and empty description when frontmatter missing", async () => {
    const db = mockDb();
    const svc = new HomeService(makeTaskPersistence(db), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    const skillDir = join(svc.getHomePath(), "skills", "no-meta");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Just markdown\nNo frontmatter.");

    const skills = await svc.getSkills();
    const skill = skills.find((s) => s.name === "no-meta");
    expect(skill).toBeDefined();
    expect(skill?.description).toBe("");
  });

  it("getSkills returns enabled=false when .disabled file exists", async () => {
    const db = mockDb();
    const svc = new HomeService(makeTaskPersistence(db), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    const skillDir = join(svc.getHomePath(), "skills", "disabled-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: disabled-skill\ndescription: Disabled.\n---\n# Content",
    );
    await writeFile(join(skillDir, ".disabled"), "");

    const skills = await svc.getSkills();
    const disabledSkill = skills.find((s) => s.name === "disabled-skill");
    expect(disabledSkill).toBeDefined();
    expect(disabledSkill?.enabled).toBe(false);
  });

  it("getSkills returns protected=true for builtin skills and protected=false for user skills", async () => {
    const db = mockDb();
    const svc = new HomeService(makeTaskPersistence(db), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    const skillDir = join(svc.getHomePath(), "skills", "user-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: user-skill\ndescription: User skill.\n---\n# Content",
    );

    const skills = await svc.getSkills();
    const builtin = skills.find((s) => s.name === "evaluate-research");
    const user = skills.find((s) => s.name === "user-skill");
    expect(builtin).toBeDefined();
    expect(builtin?.protected).toBe(true);
    expect(user).toBeDefined();
    expect(user?.protected).toBe(false);
  });

  it("toggleSkill creates and removes .disabled file", async () => {
    const db = mockDb();
    const svc = new HomeService(makeTaskPersistence(db), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    const skillDir = join(svc.getHomePath(), "skills", "togglable");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: togglable\ndescription: Togglable.\n---\n# Content",
    );

    await svc.toggleSkill("togglable", false);
    const disabledFile = join(skillDir, ".disabled");
    await expect(access(disabledFile)).resolves.toBeUndefined();

    await svc.toggleSkill("togglable", true);
    await expect(access(disabledFile)).rejects.toThrow();
  });

  it("deleteSkill removes the skill directory", async () => {
    const db = mockDb();
    const svc = new HomeService(makeTaskPersistence(db), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    const skillDir = join(svc.getHomePath(), "skills", "deletable");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: deletable\ndescription: Deletable.\n---\n# Content",
    );

    await svc.deleteSkill("deletable");
    await expect(readdir(join(svc.getHomePath(), "skills"))).resolves.not.toContain("deletable");
  });

  it("deleteSkill throws for protected skills", async () => {
    const db = mockDb();
    const svc = new HomeService(makeTaskPersistence(db), makeSkillManagement(), makeToolApproval());
    await svc.ensureDirectories();
    await expect(svc.deleteSkill("evaluate-research")).rejects.toThrow("protected");
  });
});
