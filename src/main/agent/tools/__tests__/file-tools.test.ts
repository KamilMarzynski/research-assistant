import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PathJail } from "../../path-jail";
import { createWriteFileTool } from "../file-tools";

describe("createWriteFileTool", () => {
  describe("metadata", () => {
    it("returns a tool with name 'write_file' and label 'Write file'", () => {
      const mockJail = { validate: (p: string) => p } as unknown as PathJail;
      const tool = createWriteFileTool(mockJail, null);
      expect(tool.name).toBe("write_file");
      expect(tool.label).toBe("Write file");
    });
  });

  describe("execute", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "file-tools-test-"));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    function makeJail(): PathJail {
      return { validate: (p: string) => p } as unknown as PathJail;
    }

    it("calls onFileWrite when writing inside the project folder", async () => {
      const onFileWrite = vi.fn();
      const projectDir = join(tempDir, "project");
      const jail = makeJail();
      const tool = createWriteFileTool(jail, projectDir, onFileWrite);

      const filePath = join(projectDir, "src", "main.ts");
      const result = await tool.execute("test-id", { path: filePath, content: "hello" });

      expect((result.content[0] as { text: string }).text).toBe(`Written: ${filePath}`);
      expect(onFileWrite).toHaveBeenCalledTimes(1);
      expect(onFileWrite).toHaveBeenCalledWith(filePath, "src/main.ts", "main.ts");
    });

    it("does not call onFileWrite when folderPath is null", async () => {
      const onFileWrite = vi.fn();
      const jail = makeJail();
      const tool = createWriteFileTool(jail, null, onFileWrite);

      const filePath = join(tempDir, "workspace", "test.txt");
      const result = await tool.execute("test-id", {
        path: filePath,
        content: "hello",
      });

      expect((result.content[0] as { text: string }).text).toBe(`Written: ${filePath}`);
      expect(onFileWrite).not.toHaveBeenCalled();
    });

    it("does not call onFileWrite when writing outside the project folder", async () => {
      const onFileWrite = vi.fn();
      const projectDir = join(tempDir, "project");
      const otherDir = join(tempDir, "other");
      const jail = makeJail();
      const tool = createWriteFileTool(jail, projectDir, onFileWrite);

      const filePath = join(otherDir, "test.txt");
      const result = await tool.execute("test-id", { path: filePath, content: "hello" });

      expect((result.content[0] as { text: string }).text).toBe(`Written: ${filePath}`);
      expect(onFileWrite).not.toHaveBeenCalled();
    });

    it("calls onFileWrite with correct relativePath for nested files", async () => {
      const onFileWrite = vi.fn();
      const projectDir = join(tempDir, "project");
      const jail = makeJail();
      const tool = createWriteFileTool(jail, projectDir, onFileWrite);

      const filePath = join(projectDir, "deeply", "nested", "file.txt");
      await tool.execute("test-id", { path: filePath, content: "nested content" });

      expect(onFileWrite).toHaveBeenCalledWith(filePath, "deeply/nested/file.txt", "file.txt");
    });

    it("handles folderPath with trailing slash", async () => {
      const onFileWrite = vi.fn();
      const projectDir = join(tempDir, "project");
      const jail = makeJail();
      const tool = createWriteFileTool(jail, `${projectDir}/`, onFileWrite);

      const filePath = join(projectDir, "file.txt");
      await tool.execute("test-id", { path: filePath, content: "hello" });

      expect(onFileWrite).toHaveBeenCalledWith(filePath, "file.txt", "file.txt");
    });
  });
});
