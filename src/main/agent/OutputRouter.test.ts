import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AllowlistService } from "../services/AllowlistService";
import type { ArtifactService } from "../services/ArtifactService";
import { type OutputConvention, OutputRouter } from "./OutputRouter";
import { PathJail } from "./path-jail";

describe("OutputRouter", () => {
  let tempDir: string;
  let jail: PathJail;
  let router: OutputRouter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "output-router-test-"));
    jail = new PathJail("test-project", tempDir, "Test Project", new AllowlistService());
    router = new OutputRouter(jail);
  });

  afterEach(() => {
    // Cleanup is handled by OS temp dir cleanup, but we could add rmSync here if needed
  });

  describe("parseConventions", () => {
    it("parses valid Output location section", () => {
      const content = `# FILES.md

## Output location
- default: ~/Projects/my-app/research/
- code: ~/Projects/my-app/scripts/
- reports: ~/Projects/my-app/docs/

## Other section
Some other content.
`;
      const result = router.parseConventions(content);
      expect(result).toEqual({
        default: "~/Projects/my-app/research/",
        code: "~/Projects/my-app/scripts/",
        reports: "~/Projects/my-app/docs/",
      });
    });

    it("returns null when no Output location section", () => {
      const content = `# FILES.md

## Other section
Some other content.
`;
      const result = router.parseConventions(content);
      expect(result).toBeNull();
    });

    it("returns null when section exists but has no default key", () => {
      const content = `# FILES.md

## Output location
- code: ~/Projects/my-app/scripts/
`;
      const result = router.parseConventions(content);
      expect(result).toBeNull();
    });

    it("parses partial conventions (only default)", () => {
      const content = `# FILES.md

## Output location
- default: ~/Projects/my-app/research/
`;
      const result = router.parseConventions(content);
      expect(result).toEqual({
        default: "~/Projects/my-app/research/",
      });
    });
  });

  describe("moveFinals", () => {
    it("routes files by extension to correct destinations", async () => {
      const workspace = join(tempDir, "workspace");
      mkdirSync(workspace, { recursive: true });

      const codeDir = join(tempDir, "code");
      const reportsDir = join(tempDir, "reports");
      const defaultDir = join(tempDir, "default");

      // Create test files in workspace
      writeFileSync(join(workspace, "script.py"), "print('hello')");
      writeFileSync(join(workspace, "app.js"), "console.log('hello');");
      writeFileSync(join(workspace, "types.ts"), "type A = string;");
      writeFileSync(join(workspace, "deploy.sh"), "#!/bin/bash");
      writeFileSync(join(workspace, "report.md"), "# Report");
      writeFileSync(join(workspace, "slides.pdf"), "%PDF-1.4");
      writeFileSync(join(workspace, "data.json"), "{}");

      const conventions: OutputConvention = {
        default: defaultDir,
        code: codeDir,
        reports: reportsDir,
      };

      const result = await router.moveFinals(workspace, conventions);

      expect(result.moved.sort()).toEqual([
        "app.js",
        "data.json",
        "deploy.sh",
        "report.md",
        "script.py",
        "slides.pdf",
        "types.ts",
      ]);
      expect(result.skipped).toEqual([]);

      // Verify destinations
      expect(existsSync(join(codeDir, "script.py"))).toBe(true);
      expect(existsSync(join(codeDir, "app.js"))).toBe(true);
      expect(existsSync(join(codeDir, "types.ts"))).toBe(true);
      expect(existsSync(join(codeDir, "deploy.sh"))).toBe(true);
      expect(existsSync(join(reportsDir, "report.md"))).toBe(true);
      expect(existsSync(join(reportsDir, "slides.pdf"))).toBe(true);
      expect(existsSync(join(defaultDir, "data.json"))).toBe(true);
    });

    it("skips directories", async () => {
      const workspace = join(tempDir, "workspace");
      mkdirSync(workspace, { recursive: true });

      const defaultDir = join(tempDir, "default");

      // Create a directory in workspace
      mkdirSync(join(workspace, "subdir"), { recursive: true });
      writeFileSync(join(workspace, "file.txt"), "hello");

      const conventions: OutputConvention = {
        default: defaultDir,
      };

      const result = await router.moveFinals(workspace, conventions);

      expect(result.moved).toEqual(["file.txt"]);
      expect(result.skipped).toEqual(["subdir"]);

      expect(existsSync(join(defaultDir, "file.txt"))).toBe(true);
    });

    it("handles missing convention keys by falling back to default", async () => {
      const workspace = join(tempDir, "workspace");
      mkdirSync(workspace, { recursive: true });

      const defaultDir = join(tempDir, "default");

      writeFileSync(join(workspace, "script.py"), "print('hello')");
      writeFileSync(join(workspace, "report.md"), "# Report");

      const conventions: OutputConvention = {
        default: defaultDir,
      };

      const result = await router.moveFinals(workspace, conventions);

      expect(result.moved.sort()).toEqual(["report.md", "script.py"]);
      expect(result.skipped).toEqual([]);

      expect(existsSync(join(defaultDir, "script.py"))).toBe(true);
      expect(existsSync(join(defaultDir, "report.md"))).toBe(true);
    });

    it("skips files when destination fails jail validation", async () => {
      const workspace = join(tempDir, "workspace");
      mkdirSync(workspace, { recursive: true });

      // Use a path outside the jail zone
      const outsidePath = "/tmp/outside-jail";

      writeFileSync(join(workspace, "file.txt"), "hello");

      const conventions: OutputConvention = {
        default: outsidePath,
      };

      const result = await router.moveFinals(workspace, conventions);

      expect(result.moved).toEqual([]);
      expect(result.skipped).toEqual(["file.txt"]);
    });

    it("calls artifactService.saveArtifact for each moved file with correct fields", async () => {
      const workspace = join(tempDir, "workspace");
      mkdirSync(workspace, { recursive: true });

      const defaultDir = join(tempDir, "default");
      const codeDir = join(defaultDir, "code");
      const reportsDir = join(defaultDir, "reports");

      writeFileSync(join(workspace, "script.py"), "print('hello')");
      writeFileSync(join(workspace, "app.js"), "console.log('hello');");
      writeFileSync(join(workspace, "report.md"), "# Report");
      writeFileSync(join(workspace, "data.json"), "{}");

      const conventions: OutputConvention = {
        default: defaultDir,
        code: codeDir,
        reports: reportsDir,
      };

      const mockSaveArtifact = vi.fn().mockResolvedValue({ id: "1" });
      const mockArtifactService = {
        saveArtifact: mockSaveArtifact,
      } as unknown as ArtifactService;

      const routerWithArtifactService = new OutputRouter(jail, mockArtifactService);
      const result = await routerWithArtifactService.moveFinals(workspace, conventions);

      expect(result.moved.sort()).toEqual(["app.js", "data.json", "report.md", "script.py"]);
      expect(result.skipped).toEqual([]);

      expect(mockSaveArtifact).toHaveBeenCalledTimes(4);

      expect(mockSaveArtifact).toHaveBeenCalledWith({
        projectId: "test-project",
        title: "script.py",
        filePath: join(codeDir, "script.py"),
        relativePath: join("code", "script.py"),
        acknowledged: false,
      });

      expect(mockSaveArtifact).toHaveBeenCalledWith({
        projectId: "test-project",
        title: "app.js",
        filePath: join(codeDir, "app.js"),
        relativePath: join("code", "app.js"),
        acknowledged: false,
      });

      expect(mockSaveArtifact).toHaveBeenCalledWith({
        projectId: "test-project",
        title: "report.md",
        filePath: join(reportsDir, "report.md"),
        relativePath: join("reports", "report.md"),
        acknowledged: false,
      });

      expect(mockSaveArtifact).toHaveBeenCalledWith({
        projectId: "test-project",
        title: "data.json",
        filePath: join(defaultDir, "data.json"),
        relativePath: "data.json",
        acknowledged: false,
      });
    });

    it("does not call artifactService when no files are moved", async () => {
      const workspace = join(tempDir, "workspace");
      mkdirSync(workspace, { recursive: true });

      const outsidePath = "/tmp/outside-jail";

      writeFileSync(join(workspace, "file.txt"), "hello");

      const conventions: OutputConvention = {
        default: outsidePath,
      };

      const mockSaveArtifact = vi.fn().mockResolvedValue({ id: "1" });
      const mockArtifactService = {
        saveArtifact: mockSaveArtifact,
      } as unknown as ArtifactService;

      const routerWithArtifactService = new OutputRouter(jail, mockArtifactService);
      const result = await routerWithArtifactService.moveFinals(workspace, conventions);

      expect(result.moved).toEqual([]);
      expect(result.skipped).toEqual(["file.txt"]);
      expect(mockSaveArtifact).not.toHaveBeenCalled();
    });
  });
});
