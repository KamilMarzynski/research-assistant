import type { ProviderModelMetadata } from "./provider-client.types";

export interface StaticModelEntry {
  pattern: string;
  contextWindow: number;
}

export const DEFAULT_CONTEXT_WINDOW = 128_000;

export function getDefaultContextWindow(): number {
  return DEFAULT_CONTEXT_WINDOW;
}

export const STATIC_MODEL_ENTRIES: StaticModelEntry[] = [
  { pattern: "gpt-4o", contextWindow: 128_000 },
  { pattern: "gpt-4o-mini", contextWindow: 128_000 },
  { pattern: "gpt-4-turbo", contextWindow: 128_000 },
  { pattern: "gpt-4", contextWindow: 8_192 },
  { pattern: "claude-3-opus", contextWindow: 200_000 },
  { pattern: "claude-3-5-sonnet", contextWindow: 200_000 },
  { pattern: "claude-3-5-haiku", contextWindow: 200_000 },
  { pattern: "gemini-1.5-pro", contextWindow: 2_000_000 },
  { pattern: "gemini-1.5-flash", contextWindow: 1_000_000 },
  { pattern: "llama-3.1-70b", contextWindow: 128_000 },
  { pattern: "llama-3.1-8b", contextWindow: 128_000 },
  { pattern: "llama-3.1-405b", contextWindow: 128_000 },
  { pattern: "qwen-2.5-72b", contextWindow: 128_000 },
  { pattern: "mistral-large", contextWindow: 128_000 },
  { pattern: "mixtral-8x22b", contextWindow: 64_000 },
  { pattern: "deepseek-chat", contextWindow: 64_000 },
  { pattern: "deepseek-coder", contextWindow: 64_000 },
  { pattern: "o1-mini", contextWindow: 128_000 },
  { pattern: "o3-mini", contextWindow: 200_000 },
  { pattern: "o1", contextWindow: 200_000 },
];

export function getStaticModelMetadata(
  provider: "ollama" | "openrouter" | "openai",
  modelId: string,
): ProviderModelMetadata {
  const normalizedId = modelId.toLowerCase();

  const match = STATIC_MODEL_ENTRIES.find((entry) =>
    normalizedId.includes(entry.pattern.toLowerCase()),
  );

  const effectiveContextWindow = match?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;

  return {
    id: modelId,
    name: modelId,
    provider,
    effectiveContextWindow,
    source: "static-fallback",
  };
}
