interface ModelEntry {
  pattern: string;
  contextWindow: number;
}

const MODEL_REGISTRY: ModelEntry[] = [
  { pattern: "claude-3-opus", contextWindow: 200_000 },
  { pattern: "claude-3-5-sonnet", contextWindow: 200_000 },
  { pattern: "claude-sonnet-4", contextWindow: 200_000 },
  { pattern: "claude-3-haiku", contextWindow: 200_000 },
  { pattern: "claude-haiku-4", contextWindow: 200_000 },
  { pattern: "gpt-4o", contextWindow: 128_000 },
  { pattern: "gpt-4-turbo", contextWindow: 128_000 },
  { pattern: "gpt-4", contextWindow: 8_192 },
  { pattern: "gpt-3.5", contextWindow: 16_384 },
];

const DEFAULT_CONTEXT_WINDOW = 128_000;

export function getContextWindow(modelId: string): number {
  const entry = MODEL_REGISTRY.find((e) => modelId.includes(e.pattern));
  return entry?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}
