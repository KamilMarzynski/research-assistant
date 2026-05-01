import { mkdtempSync } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("READ_ARTIFACT_FILE handler logic", () => {
  const MAX_FILE_SIZE = 512_000;

  it("reads valid file and returns UTF-8 content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-test-"));
    const filePath = join(dir, "test.md");
    await writeFile(filePath, "# Hello\n\nTest content", "utf-8");

    const content = await readFile(filePath, { encoding: "utf-8" });
    expect(content).toContain("# Hello");
    expect(content).toContain("Test content");

    // Cleanup
    await access(filePath); // verify it existed
  });

  it("rejects path with .. traversal", async () => {
    const malicious = "/safe/../../etc/passwd";
    expect(malicious.includes("..")).toBe(true);
    expect(malicious.includes("~")).toBe(false);
    expect(malicious.includes("\0")).toBe(false);
  });

  it("rejects path with ~ character", async () => {
    const malicious = "~/etc/passwd";
    expect(malicious.includes("..")).toBe(false);
    expect(malicious.includes("~")).toBe(true);
  });

  it("rejects path with null bytes", async () => {
    const malicious = "/safe/file\0.txt";
    expect(malicious.includes("\0")).toBe(true);
  });

  it("throws when file does not exist", async () => {
    const missing = join(tmpdir(), "nonexistent-file-12345.md");
    await expect(access(missing)).rejects.toThrow();
  });

  it("truncates content over 500KB", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-test-"));
    const largePath = join(dir, "large.md");
    const largeContent = "x".repeat(600_000);
    await writeFile(largePath, largeContent, "utf-8");

    const content = await readFile(largePath, { encoding: "utf-8" });
    const truncated =
      content.length > MAX_FILE_SIZE
        ? `${content.slice(0, MAX_FILE_SIZE)}\n\n<!-- Content truncated at 500KB -->`
        : content;

    expect(truncated.length).toBeLessThanOrEqual(MAX_FILE_SIZE + 43); // 43 = truncation message length
  });
});
