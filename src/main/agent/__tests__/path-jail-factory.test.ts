import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "../../../shared/types";
import { PathJailFactory } from "../path-jail-factory";

const mockAllowlist = { isAllowed: vi.fn(() => ({ allowed: true })) } as any;

describe("PathJailFactory", () => {
  const baseProject: Project = {
    id: "proj-1",
    name: "My Project",
    slug: "my-project-abc123",
    folderPath: "/home/user/myproject",
    projectPath: "/home/user/.scholar/projects/my-project-abc123",
    modelOverride: null,
    maxRecentMessages: 50,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("creates PathJail with projectPath not projectName", () => {
    const factory = new PathJailFactory(mockAllowlist);
    const jail = factory.create(baseProject);
    expect(jail.projectId).toBe("proj-1");
    // Path inside projectPath should not throw
    expect(() => jail.validate(join(baseProject.projectPath!, "output.md"), "write")).not.toThrow();
  });

  it("falls back to slug-based path when projectPath is null", () => {
    const factory = new PathJailFactory(mockAllowlist);
    const project = { ...baseProject, projectPath: null };
    expect(() => factory.create(project)).not.toThrow();
  });

  it("uses slug in fallback path when projectPath is null", () => {
    const factory = new PathJailFactory(mockAllowlist);
    const project = { ...baseProject, projectPath: null };
    const jail = factory.create(project);
    // Should not have built a jail using the project name as a path
    expect(jail.projectId).toBe("proj-1");
  });

  it("falls back to id when both projectPath and slug are null", () => {
    const factory = new PathJailFactory(mockAllowlist);
    const project = { ...baseProject, projectPath: null, slug: null };
    expect(() => factory.create(project)).not.toThrow();
    const jail = factory.create(project);
    expect(jail.projectId).toBe("proj-1");
  });
});
