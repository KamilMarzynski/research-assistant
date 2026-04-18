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
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeMockRepo(overrides: Partial<IArtifactRepository> = {}): IArtifactRepository {
  return {
    create: vi.fn().mockResolvedValue(makeArtifact()),
    listByProject: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
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
      vi.mocked(repo.create).mockResolvedValue(created);

      const result = await service.saveArtifact(data);

      expect(repo.create).toHaveBeenCalledWith(data);
      expect(result).toEqual(created);
    });
  });

  describe("listArtifacts", () => {
    it("returns artifacts from repo.listByProject", async () => {
      const list = [makeArtifact({ id: "a" }), makeArtifact({ id: "b" })];
      vi.mocked(repo.listByProject).mockResolvedValue(list);

      const result = await service.listArtifacts("proj-1");

      expect(repo.listByProject).toHaveBeenCalledWith("proj-1");
      expect(result).toEqual(list);
    });
  });
});
