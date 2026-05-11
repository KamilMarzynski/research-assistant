// tests/eval/promptfoo.test.ts
import { describe, expect, it } from "vitest";

// Since promptfoo requires external CLI, test the parser only
describe("promptfoo result parser", () => {
  it("extracts score from rubric response", () => {
    const response = "Score: 4/5. Reasoning: Clear timeline analysis.";
    const match = response.match(/(\d)\/5|score[:\s]*(\d)/i);
    expect(match).not.toBeNull();
    expect(parseInt(match![1] ?? match![2], 10)).toBe(4);
  });
});
