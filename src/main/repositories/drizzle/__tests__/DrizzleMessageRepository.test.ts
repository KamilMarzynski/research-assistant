import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "../../../../../tests/helpers/db";
import type { DrizzleDB } from "../../../db/client";
import { DrizzleMessageRepository } from "../DrizzleMessageRepository";
import { DrizzleProjectRepository } from "../DrizzleProjectRepository";

describe("DrizzleMessageRepository", () => {
  let db: DrizzleDB;
  let repo: DrizzleMessageRepository;
  let projectId: string;

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new DrizzleMessageRepository(db);
    // Messages require an existing project (FK constraint)
    const projectRepo = new DrizzleProjectRepository(db);
    const project = await projectRepo.create({ name: "Test Project" });
    projectId = project.id;
  });

  describe("create", () => {
    it("returns a message with generated id and timestamp", async () => {
      const msg = await repo.create({ projectId, role: "user", content: "Hello" });

      expect(msg.id).toBeTypeOf("string");
      expect(msg.id).toHaveLength(36);
      expect(msg.projectId).toBe(projectId);
      expect(msg.role).toBe("user");
      expect(msg.content).toBe("Hello");
      expect(msg.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("listByProject", () => {
    it("returns messages in ascending chronological order", async () => {
      await repo.create({ projectId, role: "user", content: "First" });
      await repo.create({ projectId, role: "assistant", content: "Second" });

      const msgs = await repo.listByProject(projectId);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].content).toBe("First");
      expect(msgs[1].content).toBe("Second");
    });

    it("returns empty array for project with no messages", async () => {
      expect(await repo.listByProject(projectId)).toEqual([]);
    });

    it("only returns messages belonging to the given project", async () => {
      const projectRepo = new DrizzleProjectRepository(db);
      const other = await projectRepo.create({ name: "Other" });

      await repo.create({ projectId, role: "user", content: "Mine" });
      await repo.create({ projectId: other.id, role: "user", content: "Theirs" });

      const msgs = await repo.listByProject(projectId);
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe("Mine");
    });
  });

  describe("getRecent", () => {
    it("returns the n most recent messages in ascending order", async () => {
      await repo.create({ projectId, role: "user", content: "A" });
      await repo.create({ projectId, role: "assistant", content: "B" });
      await repo.create({ projectId, role: "user", content: "C" });

      const recent = await repo.getRecent(projectId, 2);
      expect(recent).toHaveLength(2);
      // Most recent 2 (B, C) returned in ascending order
      expect(recent[0].content).toBe("B");
      expect(recent[1].content).toBe("C");
    });

    it("returns all messages when n exceeds the total count", async () => {
      await repo.create({ projectId, role: "user", content: "Only one" });
      expect(await repo.getRecent(projectId, 10)).toHaveLength(1);
    });
  });
});
