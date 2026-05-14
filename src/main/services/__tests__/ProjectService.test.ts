import { access } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../../../shared/types";
import type { IProjectRepository } from "../../repositories/IProjectRepository";
import { NotFoundError } from "../errors";
import { ProjectService } from "../ProjectService";

vi.mock("node:fs/promises", () => ({
  access: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Test Project",
    slug: null,
    folderPath: null,
    projectPath: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    modelOverride: null,
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
    setModelOverride: vi.fn().mockResolvedValue(undefined),
    setProjectPath: vi.fn().mockResolvedValue(undefined),
    setSlug: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeSettingsService() {
  return {
    getSettings: vi.fn().mockResolvedValue({
      activeProvider: "openrouter",
      defaultCloudProvider: "openrouter",
      providerCredentials: {
        openrouter: { apiKey: "sk-or-test", defaultModel: "anthropic/claude_sonnet-4-5" },
      },
      langfuseEnabled: false,
      webAccessEnabled: true,
    }),
  };
}

describe("ProjectService", () => {
  let repo: IProjectRepository;
  let service: ProjectService;

  const HOME = "/tmp/.scholar";

  beforeEach(() => {
    repo = makeMockRepo();
    service = new ProjectService(repo, HOME, makeSettingsService() as never);
  });

  describe("createProject", () => {
    it("delegates to repo.create with the given name and resolved model", async () => {
      const project = makeProject({ name: "New" });
      vi.mocked(repo.create).mockResolvedValue(project);

      const result = await service.createProject("New");

      expect(repo.create).toHaveBeenCalledWith({
        name: "New",
        slug: null,
        folderPath: null,
        modelOverride: "openrouter:anthropic/claude_sonnet-4-5",
        projectPath: null,
      });
      expect(repo.setSlug).toHaveBeenCalledWith("proj-1", "new-proj1");
      expect(repo.setProjectPath).toHaveBeenCalledWith(
        "proj-1",
        "/tmp/.scholar/projects/new-proj1",
      );
      expect(result.projectPath).toBe("/tmp/.scholar/projects/new-proj1");
      expect(result.slug).toBe("new-proj1");
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

    it("cleans up projectPath after DB delete", async () => {
      vi.mocked(repo.get).mockResolvedValue(
        makeProject({
          id: "p1",
          name: "My Project",
          projectPath: "/tmp/.scholar/projects/my-project-p1",
        }),
      );

      await service.deleteProject("p1");

      expect(repo.delete).toHaveBeenCalledWith("p1");
      const { rm } = await import("node:fs/promises");
      expect(vi.mocked(rm)).toHaveBeenCalledWith("/tmp/.scholar/projects/my-project-p1", {
        recursive: true,
        force: true,
      });
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

  describe("renameProject", () => {
    it("calls repo.rename with correct args", async () => {
      vi.mocked(repo.get).mockResolvedValue(makeProject());

      await service.renameProject("proj-1", "New Name");

      expect(repo.rename).toHaveBeenCalledWith("proj-1", "New Name");
    });

    it("throws NotFoundError when project missing", async () => {
      vi.mocked(repo.get).mockResolvedValue(null);

      await expect(service.renameProject("missing", "X")).rejects.toThrow(NotFoundError);
      expect(repo.rename).not.toHaveBeenCalled();
    });
  });

  describe("unlinkFolder", () => {
    it("calls repo.unlinkFolder with correct id", async () => {
      vi.mocked(repo.get).mockResolvedValue(makeProject());

      await service.unlinkFolder("proj-1");

      expect(repo.unlinkFolder).toHaveBeenCalledWith("proj-1");
    });

    it("throws NotFoundError when project missing", async () => {
      vi.mocked(repo.get).mockResolvedValue(null);

      await expect(service.unlinkFolder("missing")).rejects.toThrow(NotFoundError);
      expect(repo.unlinkFolder).not.toHaveBeenCalled();
    });
  });
});
