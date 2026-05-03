import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PathJail } from "../../path-jail";
import { createWriteFileTool } from "../file-tools";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

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

    it("rejects expected_hash for new file", async () => {
      const jail = makeJail();
      const tool = createWriteFileTool(jail, null);
      const filePath = join(tempDir, "new.txt");

      const result = await tool.execute("test-id", {
        path: filePath,
        content: "hello",
        expected_hash: "abc123",
      });

      expect(result.content[0].text).toContain("Cannot provide expected_hash for new file");
    });

    it("rejects line ranges for new file", async () => {
      const jail = makeJail();
      const tool = createWriteFileTool(jail, null);
      const filePath = join(tempDir, "new.txt");

      const result = await tool.execute("test-id", {
        path: filePath,
        content: "hello",
        start_line: 1,
      });

      expect(result.content[0].text).toContain("Line ranges not valid for new files");
    });

    it("edits existing file when hash matches", async () => {
      const jail = makeJail();
      const tool = createWriteFileTool(jail, null);
      const filePath = join(tempDir, "existing.txt");
      const originalContent = "line1\nline2\nline3";
      await writeFile(filePath, originalContent, "utf-8");

      const result = await tool.execute("test-id", {
        path: filePath,
        content: "replaced",
        expected_hash: sha256(originalContent),
      });

      expect(result.content[0].text).toContain("Written");
      const final = await readFile(filePath, "utf-8");
      expect(final).toBe("replaced");
    });

    it("blocks edit when hash mismatches", async () => {
      const jail = makeJail();
      const tool = createWriteFileTool(jail, null);
      const filePath = join(tempDir, "existing.txt");
      await writeFile(filePath, "original", "utf-8");

      const result = await tool.execute("test-id", {
        path: filePath,
        content: "new",
        expected_hash: "wronghash",
      });

      expect(result.content[0].text).toContain("Hash mismatch");
      expect(result.content[0].text).toContain("Re-read and retry");
      const final = await readFile(filePath, "utf-8");
      expect(final).toBe("original");
    });

    it("replaces single line with start_line and end_line", async () => {
      const jail = makeJail();
      const tool = createWriteFileTool(jail, null);
      const filePath = join(tempDir, "lines.txt");
      await writeFile(filePath, "a\nb\nc", "utf-8");

      const result = await tool.execute("test-id", {
        path: filePath,
        content: "X",
        start_line: 2,
        end_line: 2,
      });

      expect(result.content[0].text).toContain("Edited: (lines 2-2)");
      const final = await readFile(filePath, "utf-8");
      expect(final).toBe("a\nX\nc");
    });

    it("replaces line range", async () => {
      const jail = makeJail();
      const tool = createWriteFileTool(jail, null);
      const filePath = join(tempDir, "lines.txt");
      await writeFile(filePath, "a\nb\nc\nd", "utf-8");

      const result = await tool.execute("test-id", {
        path: filePath,
        content: "X\nY",
        start_line: 2,
        end_line: 3,
      });

      expect(result.content[0].text).toContain("Edited: (lines 2-3)");
      const final = await readFile(filePath, "utf-8");
      expect(final).toBe("a\nX\nY\nd");
    });

    it("inserts at start_line when end_line omitted", async () => {
      const jail = makeJail();
      const tool = createWriteFileTool(jail, null);
      const filePath = join(tempDir, "lines.txt");
      await writeFile(filePath, "a\nb\nc", "utf-8");

      const result = await tool.execute("test-id", {
        path: filePath,
        content: "X\nY",
        start_line: 2,
      });

      expect(result.content[0].text).toContain("Inserted: at line 2");
      const final = await readFile(filePath, "utf-8");
      expect(final).toBe("a\nX\nY\nb\nc");
    });

    it("inserts at end when start_line > file length", async () => {
      const jail = makeJail();
      const tool = createWriteFileTool(jail, null);
      const filePath = join(tempDir, "lines.txt");
      await writeFile(filePath, "a\nb", "utf-8");

      const result = await tool.execute("test-id", {
        path: filePath,
        content: "c",
        start_line: 10,
      });

      expect(result.content[0].text).toContain("Inserted: at line 10");
      const final = await readFile(filePath, "utf-8");
      expect(final).toBe("a\nb\nc");
    });
  });
});
