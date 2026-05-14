import { describe, expect, it } from "vitest";
import { getContextWindow } from "../model-registry";

describe("getContextWindow", () => {
  it("returns 200_000 for claude-sonnet-4", () => {
    expect(getContextWindow("claude-sonnet-4-20250101")).toBe(200_000);
  });

  it("returns 200_000 for claude-3-opus", () => {
    expect(getContextWindow("claude-3-opus-20240229")).toBe(200_000);
  });

  it("returns 128_000 for gpt-4o", () => {
    expect(getContextWindow("gpt-4o-2024-11-20")).toBe(128_000);
  });

  it("returns 8_192 for gpt-4 base", () => {
    expect(getContextWindow("gpt-4-0613")).toBe(8_192);
  });

  it("returns 128_000 as default for unknown model", () => {
    expect(getContextWindow("unknown-model-xyz")).toBe(128_000);
  });
});
