import type { Api, Model } from "@mariozechner/pi-ai";
import { getModel } from "@mariozechner/pi-ai";
import type { ModelProvider } from "./model-provider";
import { isCloudProvider } from "./model-provider";

export interface ModelFactoryOptions {
  provider: ModelProvider;
  langfuseEnabled: boolean;
}

export function createModel(opts: ModelFactoryOptions): Model<Api> {
  const base = resolveBaseConfig(opts.provider);

  if (opts.langfuseEnabled && isCloudProvider(opts.provider)) {
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    if (publicKey && secretKey) {
      const host = (process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com").replace(/\/$/, "");
      return {
        ...base,
        baseUrl: `${host}/api/proxy/openai/v1`,
        headers: {
          ...base.headers,
          "x-langfuse-public-key": publicKey,
          "x-langfuse-secret-key": secretKey,
          "x-target-url": base.baseUrl,
        },
      } as Model<Api>;
    }
  }

  return base;
}

function resolveBaseConfig(provider: ModelProvider): Model<Api> {
  switch (provider.type) {
    case "openrouter": {
      const model = getModel("openrouter", provider.model as never) as Model<Api> | undefined;
      if (!model) throw new Error(`Unknown OpenRouter model: ${provider.model}`);
      return model;
    }
    case "ollama":
      return {
        model: provider.model,
        baseUrl: `${provider.host.replace(/\/$/, "")}/v1`,
        apiKey: "ollama",
      } as unknown as Model<Api>;
    case "openai":
      return {
        model: provider.model,
        baseUrl: "https://api.openai.com/v1",
        apiKey: provider.apiKey,
      } as unknown as Model<Api>;
    case "anthropic":
      throw new Error(
        "Direct Anthropic API is not OpenAI-compatible. " +
          'Use OpenRouter with model slug "anthropic/claude-*" instead.',
      );
  }
}
