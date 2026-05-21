import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import type { IArtifactRepository } from "../../repositories/IArtifactRepository";
import { OutputNotificationService } from "../OutputNotificationService";

function makeMockRepo(): IArtifactRepository {
  return {
    create: vi.fn().mockResolvedValue(undefined),
    listByProject: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    acknowledge: vi.fn().mockResolvedValue(undefined),
    acknowledgeAllByProject: vi.fn().mockResolvedValue(undefined),
    findUnacknowledged: vi.fn().mockResolvedValue([]),
  };
}

describe("OutputNotificationService", () => {
  it("records a write as an unacknowledged artifact", async () => {
    const repo = makeMockRepo();
    const service = new OutputNotificationService(repo);

    await service.recordWrite("proj-1", "/abs/path.md", "rel/path.md", "path.md");

    expect(repo.create).toHaveBeenCalledWith({
      projectId: "proj-1",
      title: "path.md",
      filePath: "/abs/path.md",
      relativePath: "rel/path.md",
      acknowledged: false,
    });
  });
});
