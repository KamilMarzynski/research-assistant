import { access } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../../../shared/types";
import type { IProjectRepository } from "../../repositories/IProjectRepository";
import { NotFoundError } from "../errors";
import { ProjectService } from "../ProjectService";

vi.mock("node:fs/promises", () => ({ access: vi.fn().mockResolvedValue(undefined) }));

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Test Project",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    folderPath: null,
    maxRecentMessages: 20,
    ...overrides,
  };
}

function makeMockRepo(overrides: Partial<IProjectRepository> = {}): IProjectRepository {
  return {
    create: vi.fn().mockResolvedValue(makeProject()),
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
    linkFolder: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    unlinkFolder: vi.fn().mockResolvedValue(undefined),
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

      expect(repo.create).toHaveBeenCalledWith({ name: "New", folderPath: null });
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

  describe("linkFolder", () => {
    it("validates the path exists then delegates to repo", async () => {
      vi.mocked(repo.get).mockResolvedValue(makeProject());

      await service.linkFolder("proj-1", "/some/path");

      expect(access).toHaveBeenCalledWith("/some/path");
      expect(repo.linkFolder).toHaveBeenCalledWith("proj-1", "/some/path");
    });

    it("throws NotFoundError when project does not exist", async () => {
      vi.mocked(repo.get).mockResolvedValue(null);

      await expect(service.linkFolder("missing", "/some/path")).rejects.toThrow(NotFoundError);
      expect(repo.linkFolder).not.toHaveBeenCalled();
    });

    it("throws when the path does not exist on disk", async () => {
      vi.mocked(repo.get).mockResolvedValue(makeProject());
      vi.mocked(access).mockRejectedValueOnce(new Error("ENOENT"));

      await expect(service.linkFolder("proj-1", "/no/such/path")).rejects.toThrow(
        "Folder not found: /no/such/path",
      );
      expect(repo.linkFolder).not.toHaveBeenCalled();
    });
  });
});
