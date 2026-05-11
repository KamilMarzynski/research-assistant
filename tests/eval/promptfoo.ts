// tests/eval/promptfoo.ts
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface PromptfooResult {
  passed: boolean;
  tier1Pass: number;
  tier1Total: number;
  tier2Pass: number;
  tier2Total: number;
  tier3Score: number;
  tier3Reasoning: string;
  raw: unknown;
}

export async function runPromptfoo(
  artifactPath: string,
  configPath: string,
  judgeModel?: string,
): Promise<PromptfooResult> {
  const args = ["eval", "--config", configPath, "-o", join("reports", "promptfoo-results.json")];

  if (judgeModel) {
    args.push("--provider", judgeModel);
  }

  return new Promise((resolve, reject) => {
    execFile("npx", ["promptfoo", ...args], { cwd: process.cwd() }, async (err, stdout, stderr) => {
      if (err && !stdout.includes("results")) {
        reject(new Error(`Promptfoo failed: ${stderr}`));
        return;
      }

      try {
        const raw = JSON.parse(await readFile(join("reports", "promptfoo-results.json"), "utf-8"));
        const result = parsePromptfooResults(raw);
        resolve(result);
      } catch (parseErr) {
        reject(parseErr);
      }
    });
  });
}

function parsePromptfooResults(raw: unknown): PromptfooResult {
  const results = (raw as { results: { prompt: { provider: string; label: string }[]; pass: boolean }[] }).results ?? [];

  let tier1Pass = 0, tier1Total = 0;
  let tier2Pass = 0, tier2Total = 0;
  let tier3Score = 0;
  let tier3Reasoning = "";

  for (const r of results) {
    const label = r.prompt[0]?.label ?? "";
    const passed = r.pass;

    if (label.includes("Tier 1") || label.includes("Completeness")) {
      tier1Total++;
      if (passed) tier1Pass++;
    }
    if (label.includes("Tier 2") || label.includes("Synthesis")) {
      tier2Total++;
      if (passed) tier2Pass++;
    }
    if (label.includes("Tier 3") || label.includes("Quality")) {
      tier3Score = extractScore(r as Record<string, unknown>);
      tier3Reasoning = extractReasoning(r as Record<string, unknown>);
    }
  }

  return {
    passed: tier1Pass === tier1Total && tier2Pass === tier2Total,
    tier1Pass,
    tier1Total,
    tier2Pass,
    tier2Total,
    tier3Score,
    tier3Reasoning,
    raw,
  };
}

function extractScore(result: Record<string, unknown>): number {
  const response = String(result.response ?? "");
  const match = response.match(/(\d)\/5|score[:\s]*(\d)/i);
  return match ? parseInt(match[1] ?? match[2], 10) : 0;
}

function extractReasoning(result: Record<string, unknown>): string {
  const response = String(result.response ?? "");
  const lines = response.split("\n");
  return lines[lines.length - 1]?.trim() ?? "";
}
