export type MetadataSource = "provider-api" | "provider-runtime" | "pi-ai" | "static-fallback";

export interface ProviderModelMetadata {
  id: string;
  name: string;
  provider: "ollama" | "openrouter" | "openai";
  maxContextWindow?: number;
  effectiveContextWindow?: number;
  maxOutputTokens?: number;
  source: MetadataSource;
}

export interface ModelProviderClient {
  listModels(): Promise<ProviderModelMetadata[]>;
  getModelMetadata(modelId: string): Promise<ProviderModelMetadata | null>;
}
