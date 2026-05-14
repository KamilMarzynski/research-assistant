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

  it("uses firstRunPrompt instead of basePrompt when isFirstRun is true", () => {
    const result = buildSystemPrompt({
      basePrompt: "BASE",
      firstRunPrompt: "FIRST_RUN",
      memorySummary: "",
      systemContext: "",
      isFirstRun: true,
    });
    expect(result).toBe("FIRST_RUN");
  });
});
