import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "../../../../../tests/helpers/db";
import type { DrizzleDB } from "../../../db/client";
import { MonotonicClock } from "../../../utils/time";
import { DrizzleMessageRepository } from "../DrizzleMessageRepository";
import { DrizzleProjectRepository } from "../DrizzleProjectRepository";

describe("DrizzleMessageRepository", () => {
  let db: DrizzleDB;
  let repo: DrizzleMessageRepository;
  let projectId: string;
  const clock = new MonotonicClock();

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new DrizzleMessageRepository(db, clock);
    // Messages require an existing project (FK constraint)
    const projectRepo = new DrizzleProjectRepository(db, clock);
    const project = await projectRepo.create({
      name: "Test Project",
      slug: null,
      folderPath: null,
      projectPath: null,
    });
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

    it("stores and returns toolCalls when provided", async () => {
      const toolCalls = [
        {
          toolCallId: "tc-1",
          toolName: "web_search",
          description: "Searching",
          status: "done" as const,
        },
      ];
      const msg = await repo.create({ projectId, role: "assistant", content: "Answer", toolCalls });

      expect(msg.toolCalls).toEqual(toolCalls);
    });

    it("returns undefined toolCalls when not provided", async () => {
      const msg = await repo.create({ projectId, role: "user", content: "Hello" });
      expect(msg.toolCalls).toBeUndefined();
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
      const projectRepo = new DrizzleProjectRepository(db, clock);
      const other = await projectRepo.create({
        name: "Other",
        slug: null,
        folderPath: null,
        projectPath: null,
      });

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

  describe("deleteMessage", () => {
    it("removes the message from the database", async () => {
      const msg = await repo.create({ projectId, role: "user", content: "Delete me" });
      await repo.deleteMessage(msg.id);
      const remaining = await repo.listByProject(projectId);
      expect(remaining).toHaveLength(0);
    });

    it("does not throw when id does not exist", async () => {
      await expect(repo.deleteMessage("non-existent-id")).resolves.toBeUndefined();
    });
  });

  describe("updateContent with toolCalls", () => {
    it("persists toolCalls when provided to updateContent", async () => {
      const msg = await repo.create({ projectId, role: "assistant", content: "Initial" });
      const toolCalls = [
        {
          toolCallId: "tc-1",
          toolName: "web_search",
          description: "Searching",
          status: "done" as const,
        },
        {
          toolCallId: "tc-2",
          toolName: "read_file",
          description: "Reading",
          status: "error" as const,
        },
      ];
      await repo.updateContent(msg.id, "Updated", toolCalls);
      const [updated] = await repo.listByProject(projectId);
      expect(updated?.content).toBe("Updated");
      expect(updated?.toolCalls).toEqual(toolCalls);
    });

    it("does not overwrite existing toolCalls when none provided to updateContent", async () => {
      const toolCalls = [
        {
          toolCallId: "tc-1",
          toolName: "web_search",
          description: "Searching",
          status: "done" as const,
        },
      ];
      const msg = await repo.create({
        projectId,
        role: "assistant",
        content: "Initial",
        toolCalls,
      });
      await repo.updateContent(msg.id, "Updated");
      const [updated] = await repo.listByProject(projectId);
      expect(updated?.content).toBe("Updated");
      expect(updated?.toolCalls).toEqual(toolCalls);
    });
  });

  describe("listByProject with toolCalls", () => {
    it("returns toolCalls on messages that have them", async () => {
      const toolCalls = [
        {
          toolCallId: "tc-1",
          toolName: "web_search",
          description: "Searching",
          status: "done" as const,
        },
      ];
      await repo.create({ projectId, role: "user", content: "Question" });
      await repo.create({ projectId, role: "assistant", content: "Answer", toolCalls });

      const msgs = await repo.listByProject(projectId);
      expect(msgs[0]?.toolCalls).toBeUndefined();
      expect(msgs[1]?.toolCalls).toEqual(toolCalls);
    });
  });

  describe("segments round-trip", () => {
    it("persists and parses segments round-trip", async () => {
      const segments = [
        { type: "text" as const, content: "Looking at the schema." },
        {
          type: "activity" as const,
          toolCallId: "tc-1",
          toolName: "read_file",
          description: "Read schema.ts",
          status: "done" as const,
        },
        { type: "text" as const, content: "Schema has no ordering field." },
      ] satisfies import("../../../../shared/types").MessageSegment[];

      const created = await repo.create({
        projectId,
        role: "assistant",
        content: "Looking at the schema. Schema has no ordering field.",
        segments,
      });

      expect(created.segments).toEqual(segments);

      const fetched = await repo.listByProject(projectId);
      expect(fetched.at(-1)?.segments).toEqual(segments);
    });

    it("updateContent persists segments when provided", async () => {
      const created = await repo.create({ projectId, role: "assistant", content: "initial" });

      const segments = [
        { type: "text" as const, content: "final" },
      ] satisfies import("../../../../shared/types").MessageSegment[];

      await repo.updateContent(created.id, "final", undefined, segments);

      const fetched = await repo.listByProject(projectId);
      expect(fetched[0].segments).toEqual(segments);
    });

    it("returns undefined segments for rows where column is null (legacy rows)", async () => {
      await repo.create({ projectId, role: "assistant", content: "legacy" });
      const fetched = await repo.listByProject(projectId);
      expect(fetched[0].segments).toBeUndefined();
    });
  });
});
