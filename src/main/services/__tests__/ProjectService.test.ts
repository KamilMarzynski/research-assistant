import { access } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalLevel, Project } from "../../../shared/types";
import type { IProjectRepository } from "../../repositories/IProjectRepository";
import type { ApprovalPolicyService } from "../ApprovalPolicyService";
import { NotFoundError } from "../errors";
import {
  type ProjectApprovalResolutionResult,
  type ProjectApprovalResolver,
  ProjectService,
} from "../ProjectService";

vi.mock("electron", () => ({
  dialog: { showErrorBox: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn((value: string) => Buffer.from(value)),
    decryptString: vi.fn((value: Buffer) => value.toString()),
  },
}));

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
    approvalLevel: "default",
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
    setApprovalLevel: vi.fn().mockResolvedValue(undefined),
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

function makeApprovalPolicyService(): Pick<ApprovalPolicyService, "setLevel"> {
  return {
    setLevel: vi.fn().mockResolvedValue(undefined),
  };
}

function makeApprovalResolver(): ProjectApprovalResolver {
  return {
    resolvePendingApprovals: vi
      .fn<() => Promise<ProjectApprovalResolutionResult>>()
      .mockResolvedValue({ status: "unsupported" }),
  };
}

describe("ProjectService", () => {
  let repo: IProjectRepository;
  let service: ProjectService;
  let approvalPolicyService: Pick<ApprovalPolicyService, "setLevel">;
  let approvalResolver: ProjectApprovalResolver;

  const HOME = "/tmp/.scholar";

  beforeEach(() => {
    repo = makeMockRepo();
    approvalPolicyService = makeApprovalPolicyService();
    approvalResolver = makeApprovalResolver();
    service = new ProjectService(
      repo,
      HOME,
      makeSettingsService() as never,
      approvalPolicyService as ApprovalPolicyService,
    );
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
        approvalLevel: "default",
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

    it("creates projects with default approval level", async () => {
      await service.createProject("New");

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalLevel: "default" satisfies ApprovalLevel,
        }),
      );
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

  describe("setApprovalLevel", () => {
    it("updates approval level through the approval policy service", async () => {
      vi.mocked(repo.get).mockResolvedValue(makeProject());

      await service.setApprovalLevel("proj-1", "bypass_approvals");

      expect(approvalPolicyService.setLevel).toHaveBeenCalledWith("proj-1", "bypass_approvals");
      expect(repo.setApprovalLevel).not.toHaveBeenCalled();
    });

    it("throws NotFoundError when project missing", async () => {
      vi.mocked(approvalPolicyService.setLevel).mockRejectedValue(
        new NotFoundError("Project", "missing"),
      );

      await expect(service.setApprovalLevel("missing", "bypass_approvals")).rejects.toThrow(
        NotFoundError,
      );
      expect(approvalPolicyService.setLevel).toHaveBeenCalledWith("missing", "bypass_approvals");
    });
  });

  describe("transitionApprovalLevel", () => {
    it("returns without resolution work for default approval level", async () => {
      const result = await service.transitionApprovalLevel("proj-1", "default", approvalResolver);

      expect(approvalPolicyService.setLevel).toHaveBeenCalledWith("proj-1", "default");
      expect(approvalResolver.resolvePendingApprovals).not.toHaveBeenCalled();
      expect(result).toEqual({
        approvalLevel: "default",
        approvalsAutoResolved: false,
        resolution: null,
      });
    });

    it("delegates approval resolution when switching to bypass_approvals", async () => {
      vi.mocked(approvalResolver.resolvePendingApprovals).mockResolvedValue({
        status: "resolved",
        resolvedCount: 2,
      });

      const result = await service.transitionApprovalLevel(
        "proj-1",
        "bypass_approvals",
        approvalResolver,
      );

      expect(approvalPolicyService.setLevel).toHaveBeenCalledWith("proj-1", "bypass_approvals");
      expect(approvalResolver.resolvePendingApprovals).toHaveBeenCalledWith("proj-1");
      expect(result).toEqual({
        approvalLevel: "bypass_approvals",
        approvalsAutoResolved: true,
        resolution: { status: "resolved", resolvedCount: 2 },
      });
    });

    it("returns a failure result when resolver work fails after persistence", async () => {
      vi.mocked(approvalResolver.resolvePendingApprovals).mockRejectedValue(new Error("boom"));

      const result = await service.transitionApprovalLevel(
        "proj-1",
        "bypass_approvals",
        approvalResolver,
      );

      expect(approvalPolicyService.setLevel).toHaveBeenCalledWith("proj-1", "bypass_approvals");
      expect(approvalResolver.resolvePendingApprovals).toHaveBeenCalledWith("proj-1");
      expect(result).toEqual({
        approvalLevel: "bypass_approvals",
        approvalsAutoResolved: false,
        resolution: { status: "failed", error: "boom" },
      });
    });
  });
});
