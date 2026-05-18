import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../../../shared/types";
import type { IProjectRepository } from "../../repositories/IProjectRepository";
import { ApprovalPolicyService } from "../ApprovalPolicyService";
import { NotFoundError } from "../errors";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Test Project",
    slug: null,
    folderPath: null,
    projectPath: null,
    modelOverride: null,
    approvalLevel: "default",
    maxRecentMessages: 20,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeRepo(): Pick<IProjectRepository, "get" | "setApprovalLevel"> {
  return {
    get: vi.fn(),
    setApprovalLevel: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ApprovalPolicyService", () => {
  let repo: Pick<IProjectRepository, "get" | "setApprovalLevel">;
  let service: ApprovalPolicyService;

  beforeEach(() => {
    repo = makeRepo();
    service = new ApprovalPolicyService(repo as IProjectRepository);
  });

  it("reads default approval level from the project record", async () => {
    vi.mocked(repo.get).mockResolvedValue(makeProject({ approvalLevel: "default" }));

    await expect(service.getLevel("proj-1")).resolves.toBe("default");
    await expect(service.shouldBypass("proj-1")).resolves.toBe(false);
  });

  it("updates cache immediately on setLevel", async () => {
    await service.setLevel("proj-1", "bypass_approvals");

    await expect(service.shouldBypass("proj-1")).resolves.toBe(true);
    expect(repo.setApprovalLevel).toHaveBeenCalledWith("proj-1", "bypass_approvals");
    expect(repo.get).not.toHaveBeenCalled();
  });

  it("caches levels after the first read", async () => {
    vi.mocked(repo.get).mockResolvedValue(makeProject({ approvalLevel: "bypass_approvals" }));

    await expect(service.getLevel("proj-1")).resolves.toBe("bypass_approvals");
    await expect(service.getLevel("proj-1")).resolves.toBe("bypass_approvals");

    expect(repo.get).toHaveBeenCalledTimes(1);
  });

  it("throws NotFoundError when the project does not exist", async () => {
    vi.mocked(repo.get).mockResolvedValue(null);

    await expect(service.getLevel("missing")).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError from setLevel when the project does not exist", async () => {
    vi.mocked(repo.setApprovalLevel).mockRejectedValue(new Error("Project not found: missing"));

    await expect(service.setLevel("missing", "bypass_approvals")).rejects.toThrow(NotFoundError);
    expect(repo.setApprovalLevel).toHaveBeenCalledWith("missing", "bypass_approvals");
  });
});
