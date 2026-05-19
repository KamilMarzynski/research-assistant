import { describe, expect, it } from "vitest";
import { getContextWindow } from "../model-registry";

describe("getContextWindow fallback wrapper", () => {
  it("returns the fallback gpt-4o context window", () => {
    expect(getContextWindow("gpt-4o-2024-11-20")).toBe(128_000);
  });

  it("returns the default fallback for unknown models", () => {
    expect(getContextWindow("unknown-model-xyz")).toBe(128_000);
  });
});
