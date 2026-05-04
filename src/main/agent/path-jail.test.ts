import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PathJail } from "./path-jail";

const HOME = join(homedir(), ".research-assistant");
const PROJECT_ID = "proj-123";
const PROJECT_NAME = "Test Project";
const FOLDER_PATH = "/Users/test/myproject";

describe("PathJail", () => {
  describe("with folderPath", () => {
    const jail = new PathJail(PROJECT_ID, FOLDER_PATH, PROJECT_NAME);

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

    it("allows read inside ~/.research-assistant/skills", () => {
      const p = join(HOME, "skills", "start_research", "SKILL.md");
      expect(() => jail.validate(p, "read")).not.toThrow();
    });

    it("blocks write to ~/.research-assistant/skills", () => {
      const p = join(HOME, "skills", "start_research", "SKILL.md");
      expect(() => jail.validate(p, "write")).toThrow(/read-only/);
    });

    it("allows read inside ~/.agents/skills", () => {
      const p = join(homedir(), ".agents", "skills", "myplugin", "SKILL.md");
      expect(() => jail.validate(p, "read")).not.toThrow();
    });

    it("blocks write to ~/.agents/skills", () => {
      const p = join(homedir(), ".agents", "skills", "myplugin", "SKILL.md");
      expect(() => jail.validate(p, "write")).toThrow(/read-only/);
    });

    it("allows write inside ~/.research-assistant/projects/<slug>", () => {
      const p = join(HOME, "projects", "test-project", "AGENTS.md");
      expect(() => jail.validate(p, "write")).not.toThrow();
    });

    it("allows read inside ~/.research-assistant/projects/<slug>", () => {
      const p = join(HOME, "projects", "test-project", "MEMORY.md");
      expect(() => jail.validate(p, "read")).not.toThrow();
    });

    it("blocks access outside all allowed zones", () => {
      expect(() => jail.validate("/etc/passwd", "read")).toThrow(/not allowed/);
    });

    it("blocks path traversal attempts", () => {
      const p = join(HOME, "workspace", PROJECT_ID, "../../etc/passwd");
      expect(() => jail.validate(p, "read")).toThrow(/not allowed/);
    });
  });

  describe("without folderPath", () => {
    const jail = new PathJail(PROJECT_ID, null, PROJECT_NAME);

    it("allows workspace access", () => {
      const p = join(HOME, "workspace", PROJECT_ID, "file.md");
      expect(() => jail.validate(p, "read")).not.toThrow();
    });

    it("blocks project folder access when no folder linked", () => {
      expect(() => jail.validate("/Users/test/myproject/src/index.ts", "read")).toThrow(
        /not allowed/,
      );
    });
  });

  describe("returns resolved absolute path", () => {
    const jail = new PathJail(PROJECT_ID, FOLDER_PATH, PROJECT_NAME);

    it("resolves and returns the path", () => {
      const p = join(HOME, "workspace", PROJECT_ID, "output.md");
      const result = jail.validate(p, "read");
      expect(result).toBe(p);
    });
  });
});
