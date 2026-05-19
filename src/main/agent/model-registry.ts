import { getStaticModelMetadata } from "./providers/static-model-metadata";

export function getContextWindow(modelId: string): number {
  return getStaticModelMetadata("openai", modelId).effectiveContextWindow ?? 128_000;
}
