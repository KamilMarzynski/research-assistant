import type { Api, Model } from "@mariozechner/pi-ai";
import { getModel } from "@mariozechner/pi-ai";

/**
 * Creates a Pi model object for use in AgentSession.
 * When langfuseEnabled=true and LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY env vars are set,
 * overrides baseUrl to route through LangFuse proxy → OpenRouter.
 * Falls back silently to direct OpenRouter if keys are missing.
 */
export function createModel(modelId: string, langfuseEnabled: boolean): Model<Api> {
  const base = getModel("openrouter", modelId as never) as Model<Api> | undefined;
  if (!base) {
    throw new Error(
      `Unknown model: ${modelId}. Ensure it is registered in pi-ai's openrouter registry.`,
    );
  }

  if (!langfuseEnabled) return base;

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    console.warn("[model-factory] LangFuse keys missing — using direct OpenRouter");
    return base;
  }

  const host = (process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com").replace(/\/$/, "");

  return {
    ...base,
    baseUrl: `${host}/api/proxy/openai/v1`,
    headers: {
      ...base.headers,
      "x-langfuse-public-key": publicKey,
      "x-langfuse-secret-key": secretKey,
      "x-langfuse-baseurl": base.baseUrl,
    },
  } as Model<Api>;
}
