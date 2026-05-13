import "reflect-metadata";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "../../../../../tests/helpers/db";
import type { DrizzleDB } from "../../../db/client";
import { MonotonicClock } from "../../../utils/time";
import { DrizzleArtifactRepository } from "../DrizzleArtifactRepository";
import { DrizzleProjectRepository } from "../DrizzleProjectRepository";

describe("DrizzleArtifactRepository", () => {
  let db: DrizzleDB;
  let repo: DrizzleArtifactRepository;
  let projectId: string;
  const clock = new MonotonicClock();

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new DrizzleArtifactRepository(db, clock);
    const projectRepo = new DrizzleProjectRepository(db, clock);
    const project = await projectRepo.create({
      name: "Test Project",
      folderPath: null,
      projectPath: null,
    });
    projectId = project.id;
  });

  describe("create", () => {
    it("returns an artifact with generated id and timestamp", async () => {
      const artifact = await repo.create({
        projectId,
        title: "Research Report",
        filePath: "/home/user/docs/report.md",
      });

      expect(artifact.id).toBeTypeOf("string");
      expect(artifact.id).toHaveLength(36);
      expect(artifact.projectId).toBe(projectId);
      expect(artifact.title).toBe("Research Report");
      expect(artifact.filePath).toBe("/home/user/docs/report.md");
      expect(artifact.acknowledged).toBe(false);
      expect(artifact.createdAt).toBeInstanceOf(Date);
    });

    it("persists relativePath and acknowledged when provided", async () => {
      const artifact = await repo.create({
        projectId,
        title: "Research Report",
        filePath: "/home/user/docs/report.md",
        relativePath: "docs/report.md",
        acknowledged: true,
      });

      expect(artifact.relativePath).toBe("docs/report.md");
      expect(artifact.acknowledged).toBe(true);

      const found = await repo.get(artifact.id);
      expect(found?.relativePath).toBe("docs/report.md");
      expect(found?.acknowledged).toBe(true);
    });
  });

  describe("listByProject", () => {
    it("returns all artifacts for a project", async () => {
      await repo.create({ projectId, title: "A", filePath: "/a.md" });
      await repo.create({ projectId, title: "B", filePath: "/b.md" });

      const list = await repo.listByProject(projectId);
      expect(list).toHaveLength(2);
    });

    it("returns empty array when no artifacts exist", async () => {
      expect(await repo.listByProject(projectId)).toEqual([]);
    });

    it("only returns artifacts belonging to the given project", async () => {
      const projectRepo = new DrizzleProjectRepository(db, clock);
      const other = await projectRepo.create({
        name: "Other",
        folderPath: null,
        projectPath: null,
      });

      await repo.create({ projectId, title: "Mine", filePath: "/mine.md" });
      await repo.create({ projectId: other.id, title: "Theirs", filePath: "/theirs.md" });

      const list = await repo.listByProject(projectId);
      expect(list).toHaveLength(1);
      expect(list[0].title).toBe("Mine");
    });
  });

  describe("get", () => {
    it("returns artifact by id", async () => {
      const created = await repo.create({ projectId, title: "Find Me", filePath: "/x.md" });
      const found = await repo.get(created.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
    });

    it("returns null for non-existent id", async () => {
      expect(await repo.get("ghost")).toBeNull();
    });
  });

  describe("findUnacknowledged", () => {
    it("returns only unacknowledged artifacts", async () => {
      const _ack = await repo.create({
        projectId,
        title: "Acked",
        filePath: "/a.md",
        acknowledged: true,
      });
      const unack = await repo.create({
        projectId,
        title: "Unacked",
        filePath: "/b.md",
        acknowledged: false,
      });

      const result = await repo.findUnacknowledged(projectId);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(unack.id);
    });

    it("returns empty when all are acknowledged", async () => {
      await repo.create({ projectId, title: "Acked", filePath: "/a.md", acknowledged: true });
      expect(await repo.findUnacknowledged(projectId)).toEqual([]);
    });

    it("respects limit", async () => {
      await repo.create({ projectId, title: "A", filePath: "/a.md", acknowledged: false });
      await repo.create({ projectId, title: "B", filePath: "/b.md", acknowledged: false });

      const result = await repo.findUnacknowledged(projectId, 1);
      expect(result).toHaveLength(1);
    });
  });
});
