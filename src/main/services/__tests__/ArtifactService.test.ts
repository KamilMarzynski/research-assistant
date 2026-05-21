import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact } from "../../../shared/types";
import type { IArtifactRepository } from "../../repositories/IArtifactRepository";
import { ArtifactService } from "../ArtifactService";

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "art-1",
    projectId: "proj-1",
    title: "Report",
    filePath: "/docs/report.md",
    acknowledged: false,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeMockRepo(overrides: Partial<IArtifactRepository> = {}): IArtifactRepository {
  return {
    create: vi.fn().mockResolvedValue(makeArtifact()),
    listByProject: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    acknowledge: vi.fn().mockResolvedValue(undefined),
    acknowledgeAllByProject: vi.fn().mockResolvedValue(undefined),
    findUnacknowledged: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("ArtifactService", () => {
  let repo: IArtifactRepository;
  let service: ArtifactService;

  beforeEach(() => {
    repo = makeMockRepo();
    service = new ArtifactService(repo);
  });

  describe("saveArtifact", () => {
    it("delegates to repo.create and returns the artifact", async () => {
      const data = { projectId: "proj-1", title: "My Report", filePath: "/x.md" };
      const created = makeArtifact(data);
      (repo.create as ReturnType<typeof vi.fn>).mockResolvedValue(created);

      const result = await service.saveArtifact(data);

      expect(repo.create).toHaveBeenCalledWith(data);
      expect(result).toEqual(created);
    });
  });

  describe("listUnacknowledged", () => {
    it("delegates to repo.findUnacknowledged", async () => {
      const list = [makeArtifact({ id: "a", acknowledged: false })];
      (repo.findUnacknowledged as ReturnType<typeof vi.fn>).mockResolvedValue(list);

      const result = await service.listUnacknowledged("proj-1");

      expect(repo.findUnacknowledged).toHaveBeenCalledWith("proj-1", 50);
      expect(result).toEqual(list);
    });
  });

  describe("acknowledge", () => {
    it("delegates to repo.acknowledge", async () => {
      await service.acknowledge("proj-1", "art-1");
      expect(repo.acknowledge).toHaveBeenCalledWith("art-1");
    });
  });

  describe("acknowledgeAll", () => {
    it("delegates to repo.acknowledgeAllByProject", async () => {
      await service.acknowledgeAll("proj-1");
      expect(repo.acknowledgeAllByProject).toHaveBeenCalledWith("proj-1");
    });
  });
});
