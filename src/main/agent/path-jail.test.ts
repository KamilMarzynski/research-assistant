import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AllowlistService, ApprovalRequiredError } from "../services/AllowlistService";
import { PathJail } from "./path-jail";

const HOME = join(homedir(), ".scholar");
const PROJECT_ID = "proj-123";
const PROJECT_NAME = "Test Project";
const FOLDER_PATH = "/Users/test/myproject";
const allowlistService = new AllowlistService();

describe("PathJail", () => {
  describe("with folderPath", () => {
    const jail = new PathJail(PROJECT_ID, FOLDER_PATH, PROJECT_NAME, allowlistService);

    it("allows read inside workspace", () => {
      const p = join(HOME, "workspace", PROJECT_ID, "output.md");
      expect(() => jail.validate(p, "read")).not.toThrow();
    });

    it("allows write inside workspace", () => {
      const p = join(HOME, "workspace", PROJECT_ID, "output.md");
      expect(() => jail.validate(p, "write")).not.toThrow();
    });

    it("allows read inside project folder", () => {
      const p = join(FOLDER_PATH, "src", "index.ts");
      expect(() => jail.validate(p, "read")).not.toThrow();
    });

    it("allows write inside project folder", () => {
      const p = join(FOLDER_PATH, "output.md");
      expect(() => jail.validate(p, "write")).not.toThrow();
    });

    it("allows read inside ~/.scholar/skills", () => {
      const p = join(HOME, "skills", "start_research", "SKILL.md");
      expect(() => jail.validate(p, "read")).not.toThrow();
    });

    it("allows write inside ~/.scholar/skills", () => {
      const p = join(HOME, "skills", "start_research", "SKILL.md");
      expect(() => jail.validate(p, "write")).not.toThrow();
    });

    it("allows read inside ~/.scholar/projects/<slug>/skills", () => {
      const p = join(HOME, "projects", "test-project", "skills", "my-skill", "SKILL.md");
      expect(() => jail.validate(p, "read")).not.toThrow();
    });

    it("allows write inside ~/.scholar/projects/<slug>/skills", () => {
      const p = join(HOME, "projects", "test-project", "skills", "my-skill", "SKILL.md");
      expect(() => jail.validate(p, "write")).not.toThrow();
    });

    it("allows write inside ~/.scholar/projects/<slug>", () => {
      const p = join(HOME, "projects", "test-project", "GOAL.md");
      expect(() => jail.validate(p, "write")).not.toThrow();
    });

    it("allows read inside ~/.scholar/projects/<slug>", () => {
      const p = join(HOME, "projects", "test-project", "MEMORY.md");
      expect(() => jail.validate(p, "read")).not.toThrow();
    });

    it("blocks access outside all allowed zones with ApprovalRequiredError", () => {
      expect(() => jail.validate("/etc/passwd", "read")).toThrow(ApprovalRequiredError);
    });

    it("blocks path traversal attempts with ApprovalRequiredError", () => {
      const p = join(HOME, "workspace", PROJECT_ID, "../../etc/passwd");
      expect(() => jail.validate(p, "read")).toThrow(ApprovalRequiredError);
    });
  });

  describe("without folderPath", () => {
    const jail = new PathJail(PROJECT_ID, null, PROJECT_NAME, allowlistService);

    it("allows workspace access", () => {
      const p = join(HOME, "workspace", PROJECT_ID, "file.md");
      expect(() => jail.validate(p, "read")).not.toThrow();
    });

    it("blocks project folder access when no folder linked with ApprovalRequiredError", () => {
      expect(() => jail.validate("/Users/test/myproject/src/index.ts", "read")).toThrow(
        ApprovalRequiredError,
      );
    });
  });

  describe("returns resolved absolute path", () => {
    const jail = new PathJail(PROJECT_ID, FOLDER_PATH, PROJECT_NAME, allowlistService);

    it("resolves and returns the path", () => {
      const p = join(HOME, "workspace", PROJECT_ID, "output.md");
      const result = jail.validate(p, "read");
      expect(result).toBe(p);
    });
  });

  describe("symlink handling", () => {
    let tempDir: string;
    let realZone: string;
    let symlinkZone: string;
    let jail: PathJail;

    beforeAll(() => {
      tempDir = mkdtempSync(join(tmpdir(), "path-jail-test-"));
      realZone = join(tempDir, "real_zone");
      symlinkZone = join(tempDir, "symlink_zone");

      mkdirSync(join(realZone, "subdir"), { recursive: true });
      symlinkSync(realZone, symlinkZone);

      jail = new PathJail(PROJECT_ID, symlinkZone, PROJECT_NAME, allowlistService);
    });

    afterAll(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("allows read through a symlinked zone path", () => {
      const p = join(symlinkZone, "subdir", "file.md");
      expect(() => jail.validate(p, "read")).not.toThrow();
    });

    it("allows write through a symlinked zone path", () => {
      const p = join(symlinkZone, "subdir", "file.md");
      expect(() => jail.validate(p, "write")).not.toThrow();
    });

    it("returns the normalized path for symlinked zones", () => {
      const p = join(symlinkZone, "subdir", "file.md");
      const result = jail.validate(p, "read");
      expect(result).toBe(p);
    });
  });

  describe("symlink escape prevention", () => {
    let tempDir: string;
    let realZone: string;
    let outsideDir: string;
    let jail: PathJail;

    beforeAll(() => {
      tempDir = mkdtempSync(join(tmpdir(), "path-jail-test-"));
      realZone = join(tempDir, "real_zone");
      outsideDir = join(tempDir, "outside_zone");

      mkdirSync(join(realZone, "subdir"), { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
      symlinkSync(outsideDir, join(realZone, "escape_link"));
      symlinkSync(join(realZone, "subdir"), join(realZone, "internal_link"));

      jail = new PathJail(PROJECT_ID, realZone, PROJECT_NAME, allowlistService);
    });

    afterAll(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("blocks read through a symlink pointing outside the zone", () => {
      const p = join(realZone, "escape_link", "secret.txt");
      expect(() => jail.validate(p, "read")).toThrow(/outside allowed zones/);
    });

    it("blocks write through a symlink pointing outside the zone", () => {
      const p = join(realZone, "escape_link", "secret.txt");
      expect(() => jail.validate(p, "write")).toThrow(/outside allowed zones/);
    });

    it("allows read through a symlink pointing inside the zone", () => {
      const p = join(realZone, "internal_link", "file.txt");
      expect(() => jail.validate(p, "read")).not.toThrow();
    });

    it("allows write through a symlink pointing inside the zone", () => {
      const p = join(realZone, "internal_link", "file.txt");
      expect(() => jail.validate(p, "write")).not.toThrow();
    });
  });
});
