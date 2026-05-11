import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvalResult, RunId } from "./types";

export async function generateReport(
  runId: RunId,
  result: EvalResult,
  outputDir: string,
): Promise<void> {
  const report = `# Eval Run: ${runId.fixture} @ ${runId.timestamp}

## Summary
| Metric | Value |
|--------|-------|
| Task completed | ${result.completed ? "✅" : "❌"} ${result.durationMs}ms |
| Artifact count | ${result.artifactCount} |
| Tier 1 pass | ${result.tier1Pass}/${result.tier1Total} |
| Tier 2 pass | ${result.tier2Pass}/${result.tier2Total} |
| Tier 3 score | ${result.tier3Score}/5 — "${result.tier3Reasoning}" |

## Tier 1 — Completeness
- ${result.tier1Pass >= 5 ? "✅" : "❌"} Contains key terms (solid-state, 2030, Toyota, QuantumScape, CATL, ceramic separator)
- ${result.tier1Pass >= 6 ? "✅" : "❌"} Has clear structure (title, summary, sources)

## Tier 2 — Cross-Source Synthesis
- ${result.tier2Pass >= 1 ? "✅" : "❌"} Reconciles conflicting timeline claims
- ${result.tier2Pass >= 2 ? "✅" : "❌"} Identifies ceramic separator as blocker
- ${result.tier2Pass >= 3 ? "✅" : "❌"} References CSV data or analysis

## Tier 3 — Actionable Quality
- Score: ${result.tier3Score}/5
- Reasoning: "${result.tier3Reasoning}"

## Full Output
See \`04-artifacts/\` and \`05-promptfoo/results.json\`
`;

  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "report.md"), report, "utf-8");
}
