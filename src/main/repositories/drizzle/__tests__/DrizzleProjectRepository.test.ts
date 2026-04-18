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
      const project = await repo.create({ name: "My Project" });

      expect(project.id).toBeTypeOf("string");
      expect(project.id).toHaveLength(36); // UUID v4
      expect(project.name).toBe("My Project");
      expect(project.createdAt).toBeInstanceOf(Date);
      expect(project.updatedAt).toBeInstanceOf(Date);
    });

    it("persists the project so it appears in list()", async () => {
      await repo.create({ name: "Alpha" });
      await repo.create({ name: "Beta" });

      const list = await repo.list();
      expect(list).toHaveLength(2);
    });
  });

  describe("list", () => {
    it("returns empty array when no projects exist", async () => {
      expect(await repo.list()).toEqual([]);
    });

    it("returns projects ordered by createdAt descending", async () => {
      await repo.create({ name: "First" });
      await repo.create({ name: "Second" });

      const list = await repo.list();
      expect(list[0].name).toBe("Second");
      expect(list[1].name).toBe("First");
    });
  });

  describe("get", () => {
    it("returns the project by id", async () => {
      const created = await repo.create({ name: "Find Me" });
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
      const project = await repo.create({ name: "Delete Me" });
      await repo.delete(project.id);

      expect(await repo.get(project.id)).toBeNull();
    });

    it("does not throw when deleting a non-existent id", async () => {
      await expect(repo.delete("ghost-id")).resolves.toBeUndefined();
    });
  });
});
