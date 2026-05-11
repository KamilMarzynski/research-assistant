import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { generateReport } from "./report-generator";
import type { EvalResult, RunId } from "./types";

describe("generateReport", () => {
  it("writes report.md with correct structure", async () => {
    const runId: RunId = { timestamp: "2026-05-11T14-30-00", fixture: "ssb", id: "test" };
    const result: EvalResult = {
      runId: "test",
      completed: true,
      durationMs: 222000,
      artifactCount: 2,
      tier1Pass: 7,
      tier1Total: 7,
      tier2Pass: 3,
      tier2Total: 3,
      tier3Score: 4,
      tier3Reasoning: "Clear timeline analysis",
    };

    const tmpDir = join(process.cwd(), "tests", "eval", "reports", "test-run");
    await generateReport(runId, result, tmpDir);

    const report = await readFile(join(tmpDir, "report.md"), "utf-8");
    expect(report).toContain("Eval Run: ssb");
    expect(report).toContain("Tier 1 pass");
    expect(report).toContain("4/5");
  });
});
