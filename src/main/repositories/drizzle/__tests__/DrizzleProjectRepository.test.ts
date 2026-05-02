import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "../../../../../tests/helpers/db";
import type { DrizzleDB } from "../../../db/client";
import { DrizzleProjectRepository } from "../DrizzleProjectRepository";

describe("DrizzleProjectRepository", () => {
  let db: DrizzleDB;
  let repo: DrizzleProjectRepository;

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new DrizzleProjectRepository(db);
  });

  describe("create", () => {
    it("returns a project with generated id and timestamps", async () => {
      const project = await repo.create({ name: "My Project", folderPath: null });

      expect(project.id).toBeTypeOf("string");
      expect(project.id).toHaveLength(36); // UUID v4
      expect(project.name).toBe("My Project");
      expect(project.createdAt).toBeInstanceOf(Date);
      expect(project.updatedAt).toBeInstanceOf(Date);
    });

    it("persists the project so it appears in list()", async () => {
      await repo.create({ name: "Alpha", folderPath: null });
      await repo.create({ name: "Beta", folderPath: null });

      const list = await repo.list();
      expect(list).toHaveLength(2);
    });

    it("sets maxRecentMessages to default 20 on create", async () => {
      const project = await repo.create({ name: "Defaults", folderPath: null });
      expect(project.maxRecentMessages).toBe(20);
    });
  });

  describe("list", () => {
    it("returns empty array when no projects exist", async () => {
      expect(await repo.list()).toEqual([]);
    });

    it("returns projects ordered by createdAt descending", async () => {
      await repo.create({ name: "First", folderPath: null });
      await repo.create({ name: "Second", folderPath: null });

      const list = await repo.list();
      expect(list[0].name).toBe("Second");
      expect(list[1].name).toBe("First");
    });
  });

  describe("get", () => {
    it("returns the project by id", async () => {
      const created = await repo.create({ name: "Find Me", folderPath: null });
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
      const project = await repo.create({ name: "Delete Me", folderPath: null });
      await repo.delete(project.id);

      expect(await repo.get(project.id)).toBeNull();
    });

    it("does not throw when deleting a non-existent id", async () => {
      await expect(repo.delete("ghost-id")).resolves.toBeUndefined();
    });
  });

  describe("maxRecentMessages", () => {
    it("returns 20 as default for new projects", async () => {
      const project = await repo.create({ name: "Default Max", folderPath: null });
      expect(project.maxRecentMessages).toBe(20);
    });

    it("list() includes maxRecentMessages", async () => {
      await repo.create({ name: "Listed", folderPath: null });
      const list = await repo.list();
      expect(list[0].maxRecentMessages).toBe(20);
    });

    it("get() includes maxRecentMessages", async () => {
      const created = await repo.create({ name: "Fetched", folderPath: null });
      const found = await repo.get(created.id);
      expect(found?.maxRecentMessages).toBe(20);
    });

    it("persists a custom maxRecentMessages value", async () => {
      const created = await repo.create({
        name: "Custom",
        folderPath: null,
        maxRecentMessages: 50,
      });
      expect(created.maxRecentMessages).toBe(50);
      const found = await repo.get(created.id);
      expect(found?.maxRecentMessages).toBe(50);
    });
  });

  describe("linkFolder", () => {
    it("persists folderPath to the project row", async () => {
      const project = await repo.create({ name: "Linked", folderPath: null });
      await repo.linkFolder(project.id, "/Users/me/myproject");

      const found = await repo.get(project.id);
      expect(found?.folderPath).toBe("/Users/me/myproject");
    });

    it("returns null folderPath for newly created projects", async () => {
      const project = await repo.create({ name: "Fresh", folderPath: null });
      expect(project.folderPath).toBeNull();
    });

    it("list() includes folderPath", async () => {
      const project = await repo.create({ name: "Listed", folderPath: null });
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
      const project = await repo.create({ name: "Old Name", folderPath: null });
      await repo.rename(project.id, "New Name");

      const found = await repo.get(project.id);
      expect(found?.name).toBe("New Name");
    });

    it("throws when project does not exist", async () => {
      await expect(repo.rename("nonexistent-id", "New Name")).rejects.toThrow("Project not found");
    });
  });

  describe("unlinkFolder", () => {
    it("sets folderPath to null", async () => {
      const project = await repo.create({ name: "Linked", folderPath: null });
      await repo.linkFolder(project.id, "/some/path");
      await repo.unlinkFolder(project.id);

      const found = await repo.get(project.id);
      expect(found?.folderPath).toBeNull();
    });

    it("throws when project does not exist", async () => {
      await expect(repo.unlinkFolder("nonexistent-id")).rejects.toThrow("Project not found");
    });
  });
});
