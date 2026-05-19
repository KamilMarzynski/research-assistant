import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_WINDOW,
  getStaticModelMetadata,
  STATIC_MODEL_ENTRIES,
} from "../static-model-metadata";

describe("getStaticModelMetadata", () => {
  it("returns correct context window for an exact match", () => {
    const meta = getStaticModelMetadata("openai", "gpt-4o");
    expect(meta.effectiveContextWindow).toBe(128_000);
    expect(meta.source).toBe("static-fallback");
  });

  it("returns correct metadata via partial match", () => {
    const meta = getStaticModelMetadata("openrouter", "anthropic/claude-3-opus-20240229");
    expect(meta.effectiveContextWindow).toBe(200_000);
  });

  it("matches case-insensitively", () => {
    const meta = getStaticModelMetadata("openai", "GPT-4-TURBO");
    expect(meta.effectiveContextWindow).toBe(128_000);
  });

  it("returns default context window for unknown models", () => {
    const meta = getStaticModelMetadata("ollama", "some-unknown-model");
    expect(meta.effectiveContextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("uses first match when multiple patterns could match", () => {
    // "gpt-4" appears after "gpt-4-turbo" and "gpt-4o" in the array.
    // "gpt-4o" is first, so "gpt-4o" should win over "gpt-4" for a gpt-4o model.
    const meta = getStaticModelMetadata("openai", "gpt-4o-latest");
    expect(meta.effectiveContextWindow).toBe(128_000);

    // "gpt-4-turbo" is before "gpt-4", so turbo should win.
    const metaTurbo = getStaticModelMetadata("openai", "gpt-4-turbo-preview");
    expect(metaTurbo.effectiveContextWindow).toBe(128_000);
  });

  it("includes provider in returned metadata", () => {
    const meta = getStaticModelMetadata("ollama", "llama-3.1-8b");
    expect(meta.provider).toBe("ollama");
    expect(meta.id).toBe("llama-3.1-8b");
    expect(meta.name).toBe("llama-3.1-8b");
  });
});

describe("STATIC_MODEL_ENTRIES", () => {
  it("contains the expected well-known models", () => {
    const patterns = STATIC_MODEL_ENTRIES.map((e) => e.pattern);
    expect(patterns).toContain("gpt-4o");
    expect(patterns).toContain("claude-3-opus");
    expect(patterns).toContain("deepseek-chat");
    expect(patterns).toContain("o1");
    expect(patterns).toContain("o1-mini");
    expect(patterns).toContain("o3-mini");
  });
});
