import { describe, expect, it } from "vitest";
import { MemorySummaryService } from "../MemorySummaryService";

describe("MemorySummaryService", () => {
  it("summarizes when word count exceeds threshold", async () => {
    const service = new MemorySummaryService({
      summarizeFn: async (text) => `Summary: ${text.slice(0, 50)}`,
    });
    const longText = "word ".repeat(2000); // ~2000 words
    const result = await service.maybeSummarize("/tmp/memory.md", longText);
    expect(result).toBe(true);
  });

  it("does not summarize when under threshold", async () => {
    const service = new MemorySummaryService({ summarizeFn: async (text) => `Summary: ${text}` });
    const shortText = "word ".repeat(100); // ~100 words
    const result = await service.maybeSummarize("/tmp/memory.md", shortText);
    expect(result).toBe(false);
  });
});
