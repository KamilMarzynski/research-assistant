import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "../../../../../tests/helpers/db";
import type { DrizzleDB } from "../../../db/client";
import { MonotonicClock } from "../../../utils/time";
import { DrizzleProjectRepository } from "../DrizzleProjectRepository";

describe("DrizzleProjectRepository", () => {
  let db: DrizzleDB;
  let repo: DrizzleProjectRepository;
  const clock = new MonotonicClock();

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new DrizzleProjectRepository(db, clock);
  });

  describe("create", () => {
    it("returns a project with generated id and timestamps", async () => {
      const project = await repo.create({
        name: "My Project",
        slug: null,
        folderPath: null,
        projectPath: null,
      });

      expect(project.id).toBeTypeOf("string");
      expect(project.id).toHaveLength(36); // UUID v4
      expect(project.name).toBe("My Project");
      expect(project.createdAt).toBeInstanceOf(Date);
      expect(project.updatedAt).toBeInstanceOf(Date);
    });

    it("persists the project so it appears in list()", async () => {
      await repo.create({ name: "Alpha", slug: null, folderPath: null, projectPath: null });
      await repo.create({ name: "Beta", slug: null, folderPath: null, projectPath: null });

      const list = await repo.list();
      expect(list).toHaveLength(2);
    });

    it("sets maxRecentMessages to default 20 on create", async () => {
      const project = await repo.create({
        name: "Defaults",
        slug: null,
        folderPath: null,
        projectPath: null,
      });
      expect(project.maxRecentMessages).toBe(20);
    });

    it("sets approvalLevel to default on create and persists it", async () => {
      const project = await repo.create({
        name: "Approval Defaults",
        slug: null,
        folderPath: null,
        projectPath: null,
      });

      expect(project.approvalLevel).toBe("default");

      const found = await repo.get(project.id);
      expect(found?.approvalLevel).toBe("default");
    });
  });

  describe("list", () => {
    it("returns empty array when no projects exist", async () => {
      expect(await repo.list()).toEqual([]);
    });

    it("returns projects ordered by createdAt descending", async () => {
      await repo.create({ name: "First", slug: null, folderPath: null, projectPath: null });
      await repo.create({ name: "Second", slug: null, folderPath: null, projectPath: null });

      const list = await repo.list();
      expect(list[0].name).toBe("Second");
      expect(list[1].name).toBe("First");
    });
  });

  describe("get", () => {
    it("returns the project by id", async () => {
      const created = await repo.create({
        name: "Find Me",
        slug: null,
        folderPath: null,
        projectPath: null,
      });
      const found = await repo.get(created.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe("Find Me");
    });

    it("returns null when project does not exist", async () => {
      expect(await repo.get("non-existent-id")).toBeNull();
    });
  });

  describe("delete", () => {
    it("removes the project from the database", async () => {
      const project = await repo.create({
        name: "Delete Me",
        slug: null,
        folderPath: null,
        projectPath: null,
      });
      await repo.delete(project.id);

      expect(await repo.get(project.id)).toBeNull();
    });

    it("does not throw when deleting a non-existent id", async () => {
      await expect(repo.delete("ghost-id")).resolves.toBeUndefined();
    });
  });

  describe("maxRecentMessages", () => {
    it("returns 20 as default for new projects", async () => {
      const project = await repo.create({
        name: "Default Max",
        slug: null,
        folderPath: null,
        projectPath: null,
      });
      expect(project.maxRecentMessages).toBe(20);
    });

    it("list() includes maxRecentMessages", async () => {
      await repo.create({ name: "Listed", slug: null, folderPath: null, projectPath: null });
      const list = await repo.list();
      expect(list[0].maxRecentMessages).toBe(20);
    });

    it("get() includes maxRecentMessages", async () => {
      const created = await repo.create({
        name: "Fetched",
        slug: null,
        folderPath: null,
        projectPath: null,
      });
      const found = await repo.get(created.id);
      expect(found?.maxRecentMessages).toBe(20);
    });

    it("persists a custom maxRecentMessages value", async () => {
      const created = await repo.create({
        name: "Custom",
        slug: null,
        folderPath: null,
        projectPath: null,
        maxRecentMessages: 50,
      });
      expect(created.maxRecentMessages).toBe(50);
      const found = await repo.get(created.id);
      expect(found?.maxRecentMessages).toBe(50);
    });
  });

  describe("linkFolder", () => {
    it("persists folderPath to the project row", async () => {
      const project = await repo.create({
        name: "Linked",
        slug: null,
        folderPath: null,
        projectPath: null,
      });
      await repo.linkFolder(project.id, "/Users/me/myproject");

      const found = await repo.get(project.id);
      expect(found?.folderPath).toBe("/Users/me/myproject");
    });

    it("returns null folderPath for newly created projects", async () => {
      const project = await repo.create({
        name: "Fresh",
        slug: null,
        folderPath: null,
        projectPath: null,
      });
      expect(project.folderPath).toBeNull();
    });

    it("list() includes folderPath", async () => {
      const project = await repo.create({
        name: "Listed",
        slug: null,
        folderPath: null,
        projectPath: null,
      });
      await repo.linkFolder(project.id, "/some/path");
      const list = await repo.list();
      expect(list[0].folderPath).toBe("/some/path");
    });

    it("throws when project does not exist", async () => {
      await expect(repo.linkFolder("nonexistent-id", "/some/path")).rejects.toThrow(
        "Project not found",
      );
    });
  });

  describe("rename", () => {
    it("updates project name and updatedAt", async () => {
      const project = await repo.create({
        name: "Old Name",
        slug: null,
        folderPath: null,
        projectPath: null,
      });
      await repo.rename(project.id, "New Name");

      const found = await repo.get(project.id);
      expect(found?.name).toBe("New Name");
    });

    it("throws when project does not exist", async () => {
      await expect(repo.rename("nonexistent-id", "New Name")).rejects.toThrow("Project not found");
    });
  });

  describe("setModelOverride", () => {
    it("persists modelOverride and get() returns it", async () => {
      const project = await repo.create({
        name: "Model Me",
        slug: null,
        folderPath: null,
        projectPath: null,
      });
      await repo.setModelOverride(project.id, "ollama:llama3.1");

      const found = await repo.get(project.id);
      expect(found?.modelOverride).toBe("ollama:llama3.1");
    });

    it("clears modelOverride when set to null", async () => {
      const project = await repo.create({
        name: "Clear Me",
        slug: null,
        folderPath: null,
        projectPath: null,
      });
      await repo.setModelOverride(project.id, "openrouter:anthropic/claude-3.5-sonnet");
      await repo.setModelOverride(project.id, null);

      const found = await repo.get(project.id);
      expect(found?.modelOverride).toBeNull();
    });

    it("throws when project does not exist", async () => {
      await expect(repo.setModelOverride("nonexistent-id", "ollama:test")).rejects.toThrow(
        "Project not found",
      );
    });
  });

  describe("setSlug", () => {
    it("persists slug and get() returns it", async () => {
      const project = await repo.create({
        name: "Slug Me",
        slug: null,
        folderPath: null,
        projectPath: null,
      });
      await repo.setSlug(project.id, "slug-me-abc123");

      const found = await repo.get(project.id);
      expect(found?.slug).toBe("slug-me-abc123");
    });

    it("throws when project does not exist", async () => {
      await expect(repo.setSlug("nonexistent-id", "test-slug")).rejects.toThrow(
        "Project not found",
      );
    });
  });

  describe("setApprovalLevel", () => {
    it("persists changed approvalLevel across get() and list()", async () => {
      const project = await repo.create({
        name: "Approval Change",
        slug: null,
        folderPath: null,
        projectPath: null,
      });

      await repo.setApprovalLevel(project.id, "bypass_approvals");

      const found = await repo.get(project.id);
      const list = await repo.list();

      expect(found?.approvalLevel).toBe("bypass_approvals");
      expect(list.find((item) => item.id === project.id)?.approvalLevel).toBe("bypass_approvals");
    });

    it("throws when project does not exist", async () => {
      await expect(repo.setApprovalLevel("nonexistent-id", "bypass_approvals")).rejects.toThrow(
        "Project not found",
      );
    });
  });

  describe("unlinkFolder", () => {
    it("clears folderPath", async () => {
      const project = await repo.create({
        name: "Unlink Me",
        slug: null,
        folderPath: "/some/path",
        projectPath: null,
      });
      await repo.unlinkFolder(project.id);

      const found = await repo.get(project.id);
      expect(found?.folderPath).toBeNull();
    });

    it("throws when project does not exist", async () => {
      await expect(repo.unlinkFolder("nonexistent-id")).rejects.toThrow("Project not found");
    });
  });

  describe("setProjectPath", () => {
    it("persists projectPath", async () => {
      const project = await repo.create({
        name: "Path Me",
        slug: null,
        folderPath: null,
        projectPath: null,
      });
      await repo.setProjectPath(project.id, "/new/path");

      const found = await repo.get(project.id);
      expect(found?.projectPath).toBe("/new/path");
    });

    it("throws when project does not exist", async () => {
      await expect(repo.setProjectPath("nonexistent-id", "/new/path")).rejects.toThrow(
        "Project not found",
      );
    });
  });
});
