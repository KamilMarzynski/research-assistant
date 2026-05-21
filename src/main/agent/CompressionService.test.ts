import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompressionService, DEFAULT_RULES } from "./CompressionService";

function assertFullPath(result: { fullPath?: string }): string {
  if (!result.fullPath) {
    throw new Error("Expected fullPath to be defined");
  }
  return result.fullPath;
}

describe("CompressionService", () => {
  let tempDir: string;
  let service: CompressionService;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "compression-test-"));
    service = new CompressionService(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns raw content when under threshold", async () => {
    const raw = "short content";
    const result = await service.compress("fetch_url", raw, DEFAULT_RULES);
    expect(result.content).toBe(raw);
    expect(result.wasCompressed).toBe(false);
    expect(result.strategy).toBe("none");
    expect(result.fullPath).toBeUndefined();
  });

  it("truncates when over threshold with truncate strategy", async () => {
    const raw = "a".repeat(100);
    const rules = [{ tool: "test_tool", thresholdChars: 50, strategy: "truncate" as const }];
    const result = await service.compress("test_tool", raw, rules);

    expect(result.wasCompressed).toBe(true);
    expect(result.strategy).toBe("truncate");
    expect(result.content).toContain("a".repeat(50));
    expect(result.content).toContain("[truncated — full content saved to");
    expect(result.fullPath).toBeDefined();

    // Verify full content was saved
    const saved = readFileSync(assertFullPath(result), "utf-8");
    expect(saved).toBe(raw);
  });

  it("head-only keeps first N paragraphs", async () => {
    const paragraphs = [
      "First paragraph with enough text to be meaningful.",
      "Second paragraph that adds more content here.",
      "Third paragraph that should not appear in the output.",
    ];
    const raw = paragraphs.join("\n\n");
    const rules = [{ tool: "test_tool", thresholdChars: 120, strategy: "head-only" as const }];
    const result = await service.compress("test_tool", raw, rules);

    expect(result.wasCompressed).toBe(true);
    expect(result.strategy).toBe("head-only");
    expect(result.content).toContain("First paragraph");
    expect(result.content).toContain("Second paragraph");
    expect(result.content).not.toContain("Third paragraph");
    expect(result.content).toContain("[truncated — full content at");
    expect(result.fullPath).toBeDefined();

    const saved = readFileSync(assertFullPath(result), "utf-8");
    expect(saved).toBe(raw);
  });

  it("summarize uses callback when provided", async () => {
    const raw = "a".repeat(200);
    const summarizeFn = vi.fn().mockResolvedValue("Custom summary");
    const customService = new CompressionService(tempDir, summarizeFn);
    const rules = [{ tool: "test_tool", thresholdChars: 100, strategy: "summarize" as const }];

    const result = await customService.compress("test_tool", raw, rules);

    expect(result.wasCompressed).toBe(true);
    expect(result.strategy).toBe("summarize");
    expect(result.content).toContain("Custom summary");
    expect(result.content).toContain("Full content");
    expect(result.content).toContain(result.fullPath!);
    expect(summarizeFn).toHaveBeenCalledWith(raw, 200);
    expect(result.fullPath).toBeDefined();

    const saved = readFileSync(assertFullPath(result), "utf-8");
    expect(saved).toBe(raw);
  });

  it("summarize uses placeholder when no callback", async () => {
    const raw = "a".repeat(200);
    const rules = [{ tool: "test_tool", thresholdChars: 100, strategy: "summarize" as const }];

    const result = await service.compress("test_tool", raw, rules);

    expect(result.wasCompressed).toBe(true);
    expect(result.strategy).toBe("summarize");
    expect(result.content).toContain("Content too long (200 chars)");
    expect(result.content).toContain("Full content saved to");
    expect(result.fullPath).toBeDefined();

    const saved = readFileSync(assertFullPath(result), "utf-8");
    expect(saved).toBe(raw);
  });

  it("saves full content to compressed dir", async () => {
    const raw = "x".repeat(500);
    const rules = [{ tool: "test_tool", thresholdChars: 100, strategy: "truncate" as const }];

    const result = await service.compress("test_tool", raw, rules);

    expect(result.fullPath).toBeDefined();
    const fullPath = assertFullPath(result);
    expect(fullPath.startsWith(tempDir)).toBe(true);
    expect(fullPath.endsWith(".md")).toBe(true);

    const saved = readFileSync(fullPath, "utf-8");
    expect(saved).toBe(raw);
  });

  it("uses unique filenames with timestamps", async () => {
    const raw = "a".repeat(500);
    const rules = [{ tool: "test_tool", thresholdChars: 100, strategy: "truncate" as const }];

    const result1 = await service.compress("test_tool", raw, rules);
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    const result2 = await service.compress("test_tool", raw, rules);

    expect(result1.fullPath).not.toBe(result2.fullPath);
  });

  it("returns raw content when tool has no matching rule", async () => {
    const raw = "a".repeat(10_000);
    const result = await service.compress("unknown_tool", raw, DEFAULT_RULES);

    expect(result.wasCompressed).toBe(false);
    expect(result.strategy).toBe("none");
    expect(result.content).toBe(raw);
    expect(result.fullPath).toBeUndefined();
  });

  it("returns raw content when content length equals threshold", async () => {
    const raw = "a".repeat(100);
    const rules = [{ tool: "test_tool", thresholdChars: 100, strategy: "truncate" as const }];
    const result = await service.compress("test_tool", raw, rules);

    expect(result.wasCompressed).toBe(false);
    expect(result.strategy).toBe("none");
    expect(result.content).toBe(raw);
  });

  it("returns raw content for unknown strategy", async () => {
    const raw = "a".repeat(500);
    const rules = [{ tool: "test_tool", thresholdChars: 100, strategy: "unknown" as any }];
    const result = await service.compress("test_tool", raw, rules);

    expect(result.wasCompressed).toBe(false);
    expect(result.strategy).toBe("none");
    expect(result.content).toBe(raw);
  });
});
