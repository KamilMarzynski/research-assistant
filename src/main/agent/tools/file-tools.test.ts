import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PathJail } from "../path-jail";
import { createReadFileTool } from "./file-tools";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "file-tools-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const mockJail = {
  validate: (path: string, _mode: "read" | "write") => path,
} as unknown as PathJail;

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

describe("createReadFileTool", () => {
  it("reads a small text file and returns structured details", async () => {
    const tool = createReadFileTool(mockJail);
    const filePath = join(tempDir, "hello.txt");
    const content = "Hello\nWorld\n";
    await writeFile(filePath, content, "utf-8");

    const result = await tool.execute("call-1", { path: filePath });

    expect(result.content[0].type).toBe("text");
    expect(result.details).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: expect above confirmed defined
    const details = result.details!;
    expect(details.content).toBe("Hello\nWorld");
    expect(details.mimeType).toBe("text/plain");
    expect(details.truncated).toBe(false);
    expect(details.totalLines).toBe(2);
    expect(details.lineCount).toBe(2);
    expect(details.fileHash).toBe(sha256(Buffer.from(content, "utf-8")));
    expect(details.hint).toBe("");
  });

  it("strips trailing \\r from lines", async () => {
    const tool = createReadFileTool(mockJail);
    const filePath = join(tempDir, "crlf.txt");
    await writeFile(filePath, "line1\r\nline2\r\n", "utf-8");

    const result = await tool.execute("call-1", { path: filePath });

    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.content).toBe("line1\nline2");
    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.totalLines).toBe(2);
  });

  it("handles single-line file without trailing newline", async () => {
    const tool = createReadFileTool(mockJail);
    const filePath = join(tempDir, "single.txt");
    await writeFile(filePath, "only line", "utf-8");

    const result = await tool.execute("call-1", { path: filePath });

    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.content).toBe("only line");
    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.totalLines).toBe(1);
    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.lineCount).toBe(1);
  });

  it("paginates with startLine and maxLines", async () => {
    const tool = createReadFileTool(mockJail);
    const filePath = join(tempDir, "page.txt");
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    await writeFile(filePath, `${lines.join("\n")}\n`, "utf-8");

    const result = await tool.execute("call-1", { path: filePath, startLine: 3, maxLines: 4 });

    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.content).toBe("line 3\nline 4\nline 5\nline 6");
    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.totalLines).toBe(10);
    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.lineCount).toBe(4);
    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.hint).toContain("startLine=7");
  });

  it("returns placeholder for binary files", async () => {
    const tool = createReadFileTool(mockJail);
    const filePath = join(tempDir, "image.png");
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await writeFile(filePath, buffer);

    const result = await tool.execute("call-1", { path: filePath });

    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.mimeType).toBe("image/png");
    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.content).toContain("Binary file");
    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.totalLines).toBe(0);
    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.lineCount).toBe(0);
    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.truncated).toBe(false);
    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.hint).toContain("specialized tool");
  });

  it("hard-truncates content exceeding 500KB", async () => {
    const tool = createReadFileTool(mockJail);
    const filePath = join(tempDir, "huge.txt");
    const bigLine = "x".repeat(2000);
    const lines = Array.from({ length: 300 }, () => bigLine);
    await writeFile(filePath, lines.join("\n"), "utf-8");

    const result = await tool.execute("call-1", { path: filePath });

    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.truncated).toBe(true);
    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.hint).toContain("500KB");
    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    const byteLength = Buffer.byteLength(result.details!.content, "utf-8");
    expect(byteLength).toBeLessThanOrEqual(500 * 1024);
  });

  it("detects mime type by extension", async () => {
    const tool = createReadFileTool(mockJail);
    const cases = [
      { ext: "test.js", mime: "text/javascript" },
      { ext: "test.ts", mime: "text/typescript" },
      { ext: "test.json", mime: "application/json" },
      { ext: "test.md", mime: "text/markdown" },
      { ext: "test.html", mime: "text/html" },
      { ext: "test.css", mime: "text/css" },
      { ext: "test.py", mime: "text/x-python" },
      { ext: "test.jpg", mime: "image/jpeg" },
      { ext: "test.pdf", mime: "application/pdf" },
      { ext: "test.zip", mime: "application/zip" },
      { ext: "test.unknown", mime: "application/octet-stream" },
    ];

    for (const { ext, mime } of cases) {
      const filePath = join(tempDir, ext);
      await writeFile(filePath, "content", "utf-8");
      const result = await tool.execute("call-1", { path: filePath });
      // biome-ignore lint/style/noNonNullAssertion: execute always returns details
      expect(result.details!.mimeType).toBe(mime);
    }
  });

  it("defaults startLine to 1 and maxLines to 500", async () => {
    const tool = createReadFileTool(mockJail);
    const filePath = join(tempDir, "default.txt");
    const lines = Array.from({ length: 600 }, (_, i) => `line ${i + 1}`);
    await writeFile(filePath, lines.join("\n"), "utf-8");

    const result = await tool.execute("call-1", { path: filePath });

    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.lineCount).toBe(500);
    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.totalLines).toBe(600);
    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.hint).toContain("startLine=501");
  });

  it("uses startLine=1 when startLine is less than 1", async () => {
    const tool = createReadFileTool(mockJail);
    const filePath = join(tempDir, "underflow.txt");
    await writeFile(filePath, "a\nb\nc\n", "utf-8");

    const result = await tool.execute("call-1", { path: filePath, startLine: 0 });

    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.content).toBe("a\nb\nc");
    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.lineCount).toBe(3);
  });

  it("returns empty content when startLine is beyond totalLines", async () => {
    const tool = createReadFileTool(mockJail);
    const filePath = join(tempDir, "overflow.txt");
    await writeFile(filePath, "a\nb\n", "utf-8");

    const result = await tool.execute("call-1", { path: filePath, startLine: 10 });

    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.content).toBe("");
    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.lineCount).toBe(0);
    // biome-ignore lint/style/noNonNullAssertion: execute always returns details
    expect(result.details!.totalLines).toBe(2);
  });
});
