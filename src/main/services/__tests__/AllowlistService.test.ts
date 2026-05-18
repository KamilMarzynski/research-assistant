import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpHome: string;

vi.mock("node:os", () => ({
  tmpdir: () => "/tmp",
  homedir: () => tmpHome,
}));

const { AllowlistService, ApprovalRequiredError } = await import("../AllowlistService");

describe("AllowlistService", () => {
  let service: InstanceType<typeof AllowlistService>;

  beforeEach(() => {
    service = new AllowlistService();
  });

  describe("isAllowed", () => {
    it("allows paths in existing zones", () => {
      const zone = "/home/user/workspace";
      const result = service.isAllowed("proj-1", "/home/user/workspace/file.txt", "read", [zone]);
      expect(result).toEqual({ allowed: true, needsApproval: false });
    });

    it("allows exact zone paths", () => {
      const zone = "/home/user/workspace";
      const result = service.isAllowed("proj-1", "/home/user/workspace", "read", [zone]);
      expect(result).toEqual({ allowed: true, needsApproval: false });
    });

    it("requires approval for external paths", () => {
      const zone = "/home/user/workspace";
      const result = service.isAllowed("proj-1", "/etc/passwd", "read", [zone]);
      expect(result).toEqual({ allowed: false, needsApproval: true });
    });

    it("requires approval for paths outside existing zones", () => {
      const zones = ["/home/user/workspace", "/home/user/project"];
      const result = service.isAllowed("proj-1", "/tmp/external-file.txt", "write", zones);
      expect(result).toEqual({ allowed: false, needsApproval: true });
    });
  });

  describe("approveSession", () => {
    it("adds read approval for the same path and mode", () => {
      service.approveSession("proj-1", "/tmp/allowed.txt", "read");
      const result = service.isAllowed("proj-1", "/tmp/allowed.txt", "read", []);
      expect(result).toEqual({ allowed: true, needsApproval: false });
    });

    it("does not let a read approval imply write access", () => {
      service.approveSession("proj-1", "/tmp/allowed.txt", "read");

      const result = service.isAllowed("proj-1", "/tmp/allowed.txt", "write", []);
      expect(result).toEqual({ allowed: false, needsApproval: true });
    });

    it("lets a write approval imply read access", () => {
      service.approveSession("proj-1", "/tmp/allowed.txt", "write");

      expect(service.isAllowed("proj-1", "/tmp/allowed.txt", "write", [])).toEqual({
        allowed: true,
        needsApproval: false,
      });
      expect(service.isAllowed("proj-1", "/tmp/allowed.txt", "read", [])).toEqual({
        allowed: true,
        needsApproval: false,
      });
    });

    it("handles multiple paths for same project", () => {
      service.approveSession("proj-1", "/tmp/file-a.txt", "read");
      service.approveSession("proj-1", "/tmp/file-b.txt", "write");

      expect(service.isAllowed("proj-1", "/tmp/file-a.txt", "read", [])).toEqual({
        allowed: true,
        needsApproval: false,
      });
      expect(service.isAllowed("proj-1", "/tmp/file-b.txt", "write", [])).toEqual({
        allowed: true,
        needsApproval: false,
      });
    });

    it("isolates allowlists between projects", () => {
      service.approveSession("proj-1", "/tmp/proj1-file.txt", "read");

      expect(service.isAllowed("proj-2", "/tmp/proj1-file.txt", "read", [])).toEqual({
        allowed: false,
        needsApproval: true,
      });
    });
  });

  describe("clearSession", () => {
    it("removes project session allowlist", () => {
      service.approveSession("proj-1", "/tmp/allowed.txt", "read");
      service.clearSession("proj-1");

      const result = service.isAllowed("proj-1", "/tmp/allowed.txt", "read", []);
      expect(result).toEqual({ allowed: false, needsApproval: true });
    });

    it("does not affect other projects when clearing one", () => {
      service.approveSession("proj-1", "/tmp/proj1-file.txt", "read");
      service.approveSession("proj-2", "/tmp/proj2-file.txt", "read");

      service.clearSession("proj-1");

      expect(service.isAllowed("proj-1", "/tmp/proj1-file.txt", "read", [])).toEqual({
        allowed: false,
        needsApproval: true,
      });
      expect(service.isAllowed("proj-2", "/tmp/proj2-file.txt", "read", [])).toEqual({
        allowed: true,
        needsApproval: false,
      });
    });
  });

  describe("getGlobalAllowlist", () => {
    beforeEach(async () => {
      tmpHome = await mkdtemp(join(tmpdir(), "allowlist-test-"));
    });

    afterEach(async () => {
      await rm(tmpHome, { recursive: true, force: true });
    });

    it("parses config.md allowed paths section", async () => {
      const home = join(tmpHome, ".scholar");
      await mkdir(home, { recursive: true });
      await writeFile(
        join(home, "config.md"),
        `# Config

## Allowed paths
- /global/path/one
- /global/path/two

## Another section
Some content.
`,
      );

      const paths = await service.getGlobalAllowlist();
      expect(paths).toContain(resolve("/global/path/one"));
      expect(paths).toContain(resolve("/global/path/two"));
      expect(paths).toHaveLength(2);
    });

    it("returns empty array when config.md is missing", async () => {
      const paths = await service.getGlobalAllowlist();
      expect(paths).toEqual([]);
    });

    it("returns empty array when no Allowed paths section exists", async () => {
      const home = join(tmpHome, ".scholar");
      await mkdir(home, { recursive: true });
      await writeFile(
        join(home, "config.md"),
        `# Config

## Another section
Some content.
`,
      );

      const paths = await service.getGlobalAllowlist();
      expect(paths).toEqual([]);
    });
  });

  describe("getProjectAllowlist", () => {
    beforeEach(async () => {
      tmpHome = await mkdtemp(join(tmpdir(), "allowlist-test-"));
    });

    afterEach(async () => {
      await rm(tmpHome, { recursive: true, force: true });
    });

    it("parses AGENTS.md allowed paths section", async () => {
      const agentsMdPath = join(tmpHome, "AGENTS.md");
      await writeFile(
        agentsMdPath,
        `# AGENTS.md

## Allowed paths
- /project/path/alpha
- /project/path/beta

## Tools
Some tools.
`,
      );

      const paths = await service.getProjectAllowlist(agentsMdPath);
      expect(paths).toContain(resolve("/project/path/alpha"));
      expect(paths).toContain(resolve("/project/path/beta"));
      expect(paths).toHaveLength(2);
    });

    it("returns empty array when AGENTS.md is missing", async () => {
      const paths = await service.getProjectAllowlist(join(tmpHome, "nonexistent", "AGENTS.md"));
      expect(paths).toEqual([]);
    });

    it("returns empty array when no Allowed paths section exists", async () => {
      const agentsMdPath = join(tmpHome, "AGENTS.md");
      await writeFile(
        agentsMdPath,
        `# AGENTS.md

## Context
Some context.
`,
      );

      const paths = await service.getProjectAllowlist(agentsMdPath);
      expect(paths).toEqual([]);
    });
  });

  describe("ApprovalRequiredError", () => {
    it("has correct name and properties", () => {
      const err = new ApprovalRequiredError("/some/path", "write");
      expect(err.name).toBe("ApprovalRequiredError");
      expect(err.path).toBe("/some/path");
      expect(err.mode).toBe("write");
      expect(err.message).toBe('Approval required for write on "/some/path"');
    });
  });
});
