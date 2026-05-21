import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../system-prompt-builder";

describe("buildSystemPrompt", () => {
  it("joins non-empty parts with double newline", () => {
    const result = buildSystemPrompt({
      basePrompt: "BASE",
      memorySummary: "MEMORY",
      systemContext: "CONTEXT",
    });
    expect(result).toBe("BASE\n\nMEMORY\n\nCONTEXT");
  });

  it("omits empty parts", () => {
    const result = buildSystemPrompt({
      basePrompt: "BASE",
      memorySummary: "",
      systemContext: undefined,
    });
    expect(result).toBe("BASE");
  });

  it("returns the single base prompt regardless of project setup state", () => {
    const out = buildSystemPrompt({ basePrompt: "BASE", memorySummary: "MEM" });
    expect(out).toContain("BASE");
    expect(out).toContain("MEM");
  });

  it("does not accept firstRunPrompt", () => {
    // TypeScript-level assertion: the field should not exist on the type.
    // Runtime: passing an extra unknown field should not change output.
    const out = buildSystemPrompt({
      basePrompt: "BASE",
      // @ts-expect-error firstRunPrompt is no longer on SystemPromptContext
      firstRunPrompt: "FIRST",
    });
    expect(out).toContain("BASE");
    expect(out).not.toContain("FIRST");
  });

  it("does not accept isFirstRun", () => {
    const out = buildSystemPrompt({
      basePrompt: "BASE",
      // @ts-expect-error isFirstRun is no longer on SystemPromptContext
      isFirstRun: true,
    });
    expect(out).toContain("BASE");
  });
});
