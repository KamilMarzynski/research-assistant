import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../../../shared/types";
import type { IProjectRepository } from "../../repositories/IProjectRepository";
import { NotFoundError } from "../errors";
import { ProjectService } from "../ProjectService";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Test Project",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeMockRepo(overrides: Partial<IProjectRepository> = {}): IProjectRepository {
  return {
    create: vi.fn().mockResolvedValue(makeProject()),
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("ProjectService", () => {
  let repo: IProjectRepository;
  let service: ProjectService;

  beforeEach(() => {
    repo = makeMockRepo();
    service = new ProjectService(repo);
  });

  describe("createProject", () => {
    it("delegates to repo.create with the given name", async () => {
      const project = makeProject({ name: "New" });
      vi.mocked(repo.create).mockResolvedValue(project);

      const result = await service.createProject("New");

      expect(repo.create).toHaveBeenCalledWith({ name: "New" });
      expect(result).toEqual(project);
    });
  });

  describe("listProjects", () => {
    it("returns the list from repo.list", async () => {
      const list = [makeProject({ id: "a" }), makeProject({ id: "b" })];
      vi.mocked(repo.list).mockResolvedValue(list);

      const result = await service.listProjects();

      expect(result).toEqual(list);
      expect(repo.list).toHaveBeenCalledOnce();
    });
  });

  describe("getProject", () => {
    it("returns the project when found", async () => {
      const project = makeProject();
      vi.mocked(repo.get).mockResolvedValue(project);

      const result = await service.getProject("proj-1");
      expect(result).toEqual(project);
    });

    it("throws NotFoundError when project does not exist", async () => {
      vi.mocked(repo.get).mockResolvedValue(null);

      await expect(service.getProject("missing")).rejects.toThrow(NotFoundError);
      await expect(service.getProject("missing")).rejects.toThrow(
        'Project with id "missing" not found',
      );
    });
  });

  describe("deleteProject", () => {
    it("deletes the project when it exists", async () => {
      vi.mocked(repo.get).mockResolvedValue(makeProject());

      await service.deleteProject("proj-1");

      expect(repo.delete).toHaveBeenCalledWith("proj-1");
    });

    it("throws NotFoundError when project does not exist", async () => {
      vi.mocked(repo.get).mockResolvedValue(null);

      await expect(service.deleteProject("ghost")).rejects.toThrow(NotFoundError);
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });
});
