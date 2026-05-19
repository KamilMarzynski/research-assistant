# Model Context Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace static model-context guessing with provider-aware metadata resolution so Ollama, OpenRouter, and OpenAI use accurate context windows with deterministic fallback behavior.

**Architecture:** Add a small provider metadata subsystem under `src/main/agent/providers/` with one client per provider and a `ModelMetadataService` that applies cache and fallback rules. Keep `createModel()` synchronous by resolving metadata only at existing async boundaries (`chat-handlers` and `createWorkerAgent`) and passing the resolved metadata into both runtime pruning and model construction.

**Tech Stack:** TypeScript, Electron IPC, Vitest, Zod v4, `@mariozechner/pi-ai`.

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/main/agent/providers/provider-client.types.ts` | Shared provider metadata types and interface |
| Create | `src/main/agent/providers/static-model-metadata.ts` | Small fallback dataset and helpers |
| Create | `src/main/agent/providers/OpenRouterProviderClient.ts` | OpenRouter list/model metadata parsing |
| Create | `src/main/agent/providers/OpenAiProviderClient.ts` | OpenAI model listing and existence checks |
| Create | `src/main/agent/providers/OllamaProviderClient.ts` | Ollama runtime and model-detail metadata resolution |
| Create | `src/main/agent/providers/ModelMetadataService.ts` | Cache, provider-client selection, fallback ordering |
| Create | `src/main/agent/providers/__tests__/OpenRouterProviderClient.test.ts` | OpenRouter parsing tests |
| Create | `src/main/agent/providers/__tests__/OpenAiProviderClient.test.ts` | OpenAI provider behavior tests |
| Create | `src/main/agent/providers/__tests__/OllamaProviderClient.test.ts` | Ollama runtime-vs-show parsing tests |
| Create | `src/main/agent/providers/__tests__/ModelMetadataService.test.ts` | Cache and fallback-order tests |
| Modify | `src/main/agent/model-discovery.ts` | Return rich provider metadata instead of `{ id, name }` only |
| Modify | `src/main/agent/model-factory.ts` | Accept optional resolved metadata for dynamic models |
| Modify | `src/main/agent/MessagePipeline.ts` | Use resolved effective context window for pruning |
| Modify | `src/main/agent/session.ts` | Accept optional resolved metadata in session options |
| Modify | `src/main/agent/worker-agent.ts` | Resolve provider metadata before constructing worker agents |
| Modify | `src/main/agent/model-registry.ts` | Reduce to fallback-only helpers or re-export fallback helpers |
| Modify | `src/main/agent/__tests__/model-discovery.test.ts` | Update discovery expectations to richer model objects |
| Modify | `src/main/agent/__tests__/model-factory.test.ts` | Verify metadata-fed context windows |
| Modify | `src/main/agent/__tests__/model-registry.test.ts` | Replace/remove static-registry-primary assertions |
| Modify | `src/main/agent/session.test.ts` | Cover session plumbing for resolved metadata |
| Modify | `src/main/ipc/settings-handlers.ts` | Return metadata-rich provider model responses |
| Modify | `src/main/ipc/__tests__/settings-handlers.test.ts` | Cover richer response shape or helper extraction |
| Modify | `src/main/ipc/chat-handlers.ts` | Pre-resolve metadata before creating `AgentSession` |
| Modify | `src/main/ipc-validation.ts` | Keep request schema; no new fields required |
| Modify | `src/shared/ipc-types.ts` | Extend provider model response shape |

---

## Task 1: Add shared provider metadata types and fallback dataset

**Files:**
- Create: `src/main/agent/providers/provider-client.types.ts`
- Create: `src/main/agent/providers/static-model-metadata.ts`

- [ ] **Step 1: Create the shared types file**

Create `src/main/agent/providers/provider-client.types.ts`:

```ts
export type MetadataSource =
  | "provider-api"
  | "provider-runtime"
  | "pi-ai"
  | "static-fallback";

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
```

- [ ] **Step 2: Create the static fallback dataset**

Create `src/main/agent/providers/static-model-metadata.ts`:

```ts
import type { ProviderModelMetadata } from "./provider-client.types";

interface StaticModelEntry {
  pattern: string;
  contextWindow: number;
}

const DEFAULT_CONTEXT_WINDOW = 128_000;

const STATIC_MODEL_ENTRIES: StaticModelEntry[] = [
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

export function getDefaultContextWindow(): number {
  return DEFAULT_CONTEXT_WINDOW;
}

export function getStaticModelMetadata(
  provider: "ollama" | "openrouter" | "openai",
  modelId: string,
): ProviderModelMetadata {
  const entry = STATIC_MODEL_ENTRIES.find((candidate) => modelId.includes(candidate.pattern));
  const contextWindow = entry?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  return {
    id: modelId,
    name: modelId,
    provider,
    maxContextWindow: contextWindow,
    effectiveContextWindow: contextWindow,
    source: "static-fallback",
  };
}
```

- [ ] **Step 3: Add a focused fallback test file**

Create `src/main/agent/providers/__tests__/static-model-metadata.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getDefaultContextWindow, getStaticModelMetadata } from "../static-model-metadata";

describe("getStaticModelMetadata", () => {
  it("returns a known gpt-4o context window", () => {
    expect(getStaticModelMetadata("openai", "gpt-4o-2024-11-20").effectiveContextWindow).toBe(
      128_000,
    );
  });

  it("returns the default context window for unknown models", () => {
    expect(getStaticModelMetadata("openai", "unknown-model-xyz").effectiveContextWindow).toBe(
      getDefaultContextWindow(),
    );
  });
});
```

- [ ] **Step 4: Run the focused test**

```bash
bun run test -- src/main/agent/providers/__tests__/static-model-metadata.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/providers/provider-client.types.ts src/main/agent/providers/static-model-metadata.ts src/main/agent/providers/__tests__/static-model-metadata.test.ts
git commit -m "feat: add provider metadata types and static fallback dataset"
```

---

## Task 2: Implement OpenRouter and OpenAI provider clients

**Files:**
- Create: `src/main/agent/providers/OpenRouterProviderClient.ts`
- Create: `src/main/agent/providers/OpenAiProviderClient.ts`
- Create: `src/main/agent/providers/__tests__/OpenRouterProviderClient.test.ts`
- Create: `src/main/agent/providers/__tests__/OpenAiProviderClient.test.ts`

- [ ] **Step 1: Create the OpenRouter client**

Create `src/main/agent/providers/OpenRouterProviderClient.ts`:

```ts
import type { ModelProviderClient, ProviderModelMetadata } from "./provider-client.types";

export class OpenRouterProviderClient implements ModelProviderClient {
  constructor(private readonly apiKey?: string) {}

  async listModels(): Promise<ProviderModelMetadata[]> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(`OpenRouter returned ${res.status}`);
    }

    const data = (await res.json()) as {
      data?: Array<{ id: string; name?: string; context_length?: number }>;
    };

    return (data.data ?? []).map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      provider: "openrouter",
      maxContextWindow: model.context_length,
      effectiveContextWindow: model.context_length,
      source: "provider-api",
    }));
  }

  async getModelMetadata(modelId: string): Promise<ProviderModelMetadata | null> {
    const models = await this.listModels();
    return models.find((model) => model.id === modelId) ?? null;
  }
}
```

- [ ] **Step 2: Create the OpenAI client**

Create `src/main/agent/providers/OpenAiProviderClient.ts`:

```ts
import type { ModelProviderClient, ProviderModelMetadata } from "./provider-client.types";

export class OpenAiProviderClient implements ModelProviderClient {
  constructor(private readonly apiKey: string) {}

  async listModels(): Promise<ProviderModelMetadata[]> {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(res.status === 401 ? "Invalid API key" : `OpenAI returned ${res.status}`);
    }

    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? [])
      .filter((model) => model.id.startsWith("gpt-"))
      .map((model) => ({
        id: model.id,
        name: model.id,
        provider: "openai",
        source: "provider-api",
      }));
  }

  async getModelMetadata(modelId: string): Promise<ProviderModelMetadata | null> {
    const models = await this.listModels();
    return models.find((model) => model.id === modelId) ?? null;
  }
}
```

- [ ] **Step 3: Add OpenRouter parsing tests**

Create `src/main/agent/providers/__tests__/OpenRouterProviderClient.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { OpenRouterProviderClient } from "../OpenRouterProviderClient";

describe("OpenRouterProviderClient", () => {
  it("maps context_length into both context fields", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6", context_length: 200000 }],
      }),
    }) as typeof fetch;

    const client = new OpenRouterProviderClient("sk-test");
    await expect(client.getModelMetadata("anthropic/claude-sonnet-4-6")).resolves.toEqual({
      id: "anthropic/claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      provider: "openrouter",
      maxContextWindow: 200000,
      effectiveContextWindow: 200000,
      source: "provider-api",
    });
  });
});
```

- [ ] **Step 4: Add OpenAI provider tests**

Create `src/main/agent/providers/__tests__/OpenAiProviderClient.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { OpenAiProviderClient } from "../OpenAiProviderClient";

describe("OpenAiProviderClient", () => {
  it("returns only gpt-* model IDs without context metadata", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "gpt-4o" }, { id: "whisper-1" }, { id: "gpt-4o-mini" }],
      }),
    }) as typeof fetch;

    const client = new OpenAiProviderClient("sk-openai");
    await expect(client.listModels()).resolves.toEqual([
      { id: "gpt-4o", name: "gpt-4o", provider: "openai", source: "provider-api" },
      { id: "gpt-4o-mini", name: "gpt-4o-mini", provider: "openai", source: "provider-api" },
    ]);
  });
});
```

- [ ] **Step 5: Run client tests**

```bash
bun run test -- src/main/agent/providers/__tests__/OpenRouterProviderClient.test.ts src/main/agent/providers/__tests__/OpenAiProviderClient.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/providers/OpenRouterProviderClient.ts src/main/agent/providers/OpenAiProviderClient.ts src/main/agent/providers/__tests__/OpenRouterProviderClient.test.ts src/main/agent/providers/__tests__/OpenAiProviderClient.test.ts
git commit -m "feat: add openrouter and openai provider clients"
```

---

## Task 3: Implement the Ollama provider client

**Files:**
- Create: `src/main/agent/providers/OllamaProviderClient.ts`
- Create: `src/main/agent/providers/__tests__/OllamaProviderClient.test.ts`

- [ ] **Step 1: Create the Ollama provider client**

Create `src/main/agent/providers/OllamaProviderClient.ts`:

```ts
import type { ModelProviderClient, ProviderModelMetadata } from "./provider-client.types";

function parseShowContextWindow(modelInfo: Record<string, unknown> | undefined): number | undefined {
  if (!modelInfo) return undefined;
  const numericValues = Object.entries(modelInfo)
    .filter(([key, value]) => key.includes("context_length") && typeof value === "number")
    .map(([, value]) => value as number);
  return numericValues[0];
}

export class OllamaProviderClient implements ModelProviderClient {
  constructor(private readonly host: string) {}

  async listModels(): Promise<ProviderModelMetadata[]> {
    const res = await fetch(new URL("/api/tags", this.host).toString(), {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}`);
    }
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((model) => ({
      id: model.name,
      name: model.name,
      provider: "ollama",
      source: "provider-api",
    }));
  }

  async getModelMetadata(modelId: string): Promise<ProviderModelMetadata | null> {
    const runtimeRes = await fetch(new URL("/api/ps", this.host).toString(), {
      signal: AbortSignal.timeout(5000),
    });
    const runtimeData = runtimeRes.ok
      ? ((await runtimeRes.json()) as { models?: Array<{ name: string; context_length?: number }> })
      : { models: [] };
    const runtimeMatch = runtimeData.models?.find((model) => model.name === modelId);

    const showRes = await fetch(new URL("/api/show", this.host).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId }),
      signal: AbortSignal.timeout(5000),
    });
    if (!showRes.ok && !runtimeMatch) {
      return null;
    }

    const showData = showRes.ok
      ? ((await showRes.json()) as { model_info?: Record<string, unknown> })
      : undefined;
    const declaredMax = parseShowContextWindow(showData?.model_info);
    const effective = runtimeMatch?.context_length ?? declaredMax;

    return {
      id: modelId,
      name: modelId,
      provider: "ollama",
      maxContextWindow: declaredMax,
      effectiveContextWindow: effective,
      source: runtimeMatch?.context_length ? "provider-runtime" : "provider-api",
    };
  }
}
```

- [ ] **Step 2: Add the runtime-preferred parsing test**

Create `src/main/agent/providers/__tests__/OllamaProviderClient.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { OllamaProviderClient } from "../OllamaProviderClient";

describe("OllamaProviderClient", () => {
  it("prefers runtime context_length over show-model max context", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: "llama3.2:3b", context_length: 32768 }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ model_info: { "llama.context_length": 131072 } }),
      }) as typeof fetch;

    const client = new OllamaProviderClient("http://localhost:11434");
    await expect(client.getModelMetadata("llama3.2:3b")).resolves.toEqual({
      id: "llama3.2:3b",
      name: "llama3.2:3b",
      provider: "ollama",
      maxContextWindow: 131072,
      effectiveContextWindow: 32768,
      source: "provider-runtime",
    });
  });

  it("falls back to show-model context when runtime data is absent", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ model_info: { "llama.context_length": 65536 } }),
      }) as typeof fetch;

    const client = new OllamaProviderClient("http://localhost:11434");
    await expect(client.getModelMetadata("llama3.2:3b")).resolves.toEqual({
      id: "llama3.2:3b",
      name: "llama3.2:3b",
      provider: "ollama",
      maxContextWindow: 65536,
      effectiveContextWindow: 65536,
      source: "provider-api",
    });
  });
});
```

- [ ] **Step 3: Run the Ollama provider tests**

```bash
bun run test -- src/main/agent/providers/__tests__/OllamaProviderClient.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/agent/providers/OllamaProviderClient.ts src/main/agent/providers/__tests__/OllamaProviderClient.test.ts
git commit -m "feat: add ollama provider client with runtime context resolution"
```

---

## Task 4: Add ModelMetadataService with cache and fallback order

**Files:**
- Create: `src/main/agent/providers/ModelMetadataService.ts`
- Create: `src/main/agent/providers/__tests__/ModelMetadataService.test.ts`

- [ ] **Step 1: Create the metadata service**

Create `src/main/agent/providers/ModelMetadataService.ts`:

```ts
import { getModels } from "@mariozechner/pi-ai";
import type { ModelProvider } from "../model-provider";
import { OpenAiProviderClient } from "./OpenAiProviderClient";
import { OllamaProviderClient } from "./OllamaProviderClient";
import { OpenRouterProviderClient } from "./OpenRouterProviderClient";
import type { ModelProviderClient, ProviderModelMetadata } from "./provider-client.types";
import { getDefaultContextWindow, getStaticModelMetadata } from "./static-model-metadata";

const SUCCESS_TTL_MS = 5 * 60 * 1000;
const FAILURE_TTL_MS = 30 * 1000;

interface CacheEntry {
  expiresAt: number;
  value: ProviderModelMetadata;
}

function fromPiAi(provider: "openrouter" | "openai", modelId: string): ProviderModelMetadata | null {
  const model = getModels(provider).find((candidate) => candidate.id === modelId);
  if (!model?.contextWindow) return null;
  return {
    id: model.id,
    name: model.name,
    provider,
    maxContextWindow: model.contextWindow,
    effectiveContextWindow: model.contextWindow,
    maxOutputTokens: model.maxTokens,
    source: "pi-ai",
  };
}

export class ModelMetadataService {
  private readonly cache = new Map<string, CacheEntry>();

  private buildKey(provider: ModelProvider): string {
    return provider.type === "ollama"
      ? `ollama:${provider.host}:${provider.model}`
      : `${provider.type}:${provider.model}`;
  }

  private getClient(provider: ModelProvider): ModelProviderClient {
    switch (provider.type) {
      case "openrouter":
        return new OpenRouterProviderClient(provider.apiKey);
      case "openai":
        return new OpenAiProviderClient(provider.apiKey);
      case "ollama":
        return new OllamaProviderClient(provider.host);
      case "anthropic":
        throw new Error("Anthropic provider is not supported here");
    }
  }

  async getModelMetadata(provider: ModelProvider): Promise<ProviderModelMetadata> {
    const cacheKey = this.buildKey(provider);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const fallback = getStaticModelMetadata(provider.type === "anthropic" ? "openrouter" : provider.type, provider.model);

    try {
      if (provider.type === "openrouter" || provider.type === "ollama") {
        const providerValue = await this.getClient(provider).getModelMetadata(provider.model);
        if (providerValue?.effectiveContextWindow || providerValue?.maxContextWindow) {
          this.cache.set(cacheKey, {
            value: providerValue,
            expiresAt: Date.now() + SUCCESS_TTL_MS,
          });
          return providerValue;
        }
      }

      if (provider.type === "openrouter" || provider.type === "openai") {
        const piAiValue = fromPiAi(provider.type, provider.model);
        if (piAiValue) {
          this.cache.set(cacheKey, {
            value: piAiValue,
            expiresAt: Date.now() + SUCCESS_TTL_MS,
          });
          return piAiValue;
        }
      }

      this.cache.set(cacheKey, { value: fallback, expiresAt: Date.now() + FAILURE_TTL_MS });
      return fallback;
    } catch {
      if (provider.type === "openrouter" || provider.type === "openai") {
        const piAiValue = fromPiAi(provider.type, provider.model);
        if (piAiValue) {
          this.cache.set(cacheKey, {
            value: piAiValue,
            expiresAt: Date.now() + SUCCESS_TTL_MS,
          });
          return piAiValue;
        }
      }

      this.cache.set(cacheKey, { value: fallback, expiresAt: Date.now() + FAILURE_TTL_MS });
      return fallback;
    }
  }

  async getEffectiveContextWindow(provider: ModelProvider): Promise<number> {
    const metadata = await this.getModelMetadata(provider);
    return (
      metadata.effectiveContextWindow ??
      metadata.maxContextWindow ??
      getDefaultContextWindow()
    );
  }
}

export const modelMetadataService = new ModelMetadataService();
```

- [ ] **Step 2: Add cache and fallback-order tests**

Create `src/main/agent/providers/__tests__/ModelMetadataService.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ModelMetadataService } from "../ModelMetadataService";

vi.mock("@mariozechner/pi-ai", () => ({
  getModels: vi.fn().mockReturnValue([{ id: "gpt-4o", name: "gpt-4o", contextWindow: 128000, maxTokens: 4096 }]),
}));

describe("ModelMetadataService", () => {
  it("uses pi-ai for openai context fallback", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("boom")) as typeof fetch;
    const service = new ModelMetadataService();
    await expect(
      service.getEffectiveContextWindow({ type: "openai", apiKey: "sk-openai", model: "gpt-4o" }),
    ).resolves.toBe(128000);
  });

  it("uses provider runtime context for ollama when available", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ models: [{ name: "llama3.2:3b", context_length: 32768 }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ model_info: { "llama.context_length": 131072 } }) }) as typeof fetch;

    const service = new ModelMetadataService();
    await expect(
      service.getEffectiveContextWindow({ type: "ollama", host: "http://localhost:11434", model: "llama3.2:3b" }),
    ).resolves.toBe(32768);
  });
});
```

- [ ] **Step 3: Run the metadata service tests**

```bash
bun run test -- src/main/agent/providers/__tests__/ModelMetadataService.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/agent/providers/ModelMetadataService.ts src/main/agent/providers/__tests__/ModelMetadataService.test.ts
git commit -m "feat: add model metadata service with cache and fallback rules"
```

---

## Task 5: Upgrade provider discovery and IPC response types

**Files:**
- Modify: `src/main/agent/model-discovery.ts`
- Modify: `src/main/ipc/settings-handlers.ts`
- Modify: `src/shared/ipc-types.ts`
- Modify: `src/main/agent/__tests__/model-discovery.test.ts`

- [ ] **Step 1: Replace thin discovery return shapes with `ProviderModelMetadata`**

Update `src/main/agent/model-discovery.ts` imports and return type:

```ts
import { OpenAiProviderClient } from "./providers/OpenAiProviderClient";
import { OllamaProviderClient } from "./providers/OllamaProviderClient";
import { OpenRouterProviderClient } from "./providers/OpenRouterProviderClient";
import type { ProviderModelMetadata } from "./providers/provider-client.types";

export interface ModelDiscoveryResult {
  models: ProviderModelMetadata[];
  error?: string;
}
```

Replace the three functions with:

```ts
export async function getOllamaModels(host: string): Promise<ModelDiscoveryResult> {
  try {
    const models = await new OllamaProviderClient(host).listModels();
    return { models };
  } catch {
    return { models: [], error: "Ollama not reachable" };
  }
}

export async function getOpenRouterModels(apiKey?: string): Promise<ModelDiscoveryResult> {
  try {
    const models = await new OpenRouterProviderClient(apiKey).listModels();
    return { models };
  } catch (error) {
    return { models: [], error: error instanceof Error ? error.message : "OpenRouter request failed" };
  }
}

export async function getOpenAiModels(apiKey: string): Promise<ModelDiscoveryResult> {
  try {
    const models = await new OpenAiProviderClient(apiKey).listModels();
    return { models };
  } catch (error) {
    return { models: [], error: error instanceof Error ? error.message : "OpenAI request failed" };
  }
}
```

- [ ] **Step 2: Update the shared IPC response type**

In `src/shared/ipc-types.ts`, change the response shape to:

```ts
export interface GetProviderModelsResponse {
  models: Array<{
    id: string;
    name: string;
    provider: "ollama" | "openrouter" | "openai";
    maxContextWindow?: number;
    effectiveContextWindow?: number;
    maxOutputTokens?: number;
    source: "provider-api" | "provider-runtime" | "pi-ai" | "static-fallback";
  }>;
  error?: string;
}
```

- [ ] **Step 3: Update the settings IPC handler to return the richer discovery payload**

In `src/main/ipc/settings-handlers.ts`, keep the switch structure and only return the updated discovery data:

```ts
case "openrouter": {
  return getOpenRouterModels(p.apiKey);
}
case "openai": {
  if (!p.apiKey) {
    return { models: [], error: "API key is required for OpenAI" };
  }
  return getOpenAiModels(p.apiKey);
}
```

- [ ] **Step 4: Update discovery tests to assert metadata fields**

In `src/main/agent/__tests__/model-discovery.test.ts`, replace the OpenRouter expectation with:

```ts
expect(result.models).toEqual([
  {
    id: "anthropic/claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: "openrouter",
    maxContextWindow: 200000,
    effectiveContextWindow: 200000,
    source: "provider-api",
  },
  {
    id: "openai/gpt-4o",
    name: "openai/gpt-4o",
    provider: "openrouter",
    maxContextWindow: 128000,
    effectiveContextWindow: 128000,
    source: "provider-api",
  },
]);
```

and update the mocked payload to include `context_length`.

- [ ] **Step 5: Run discovery tests**

```bash
bun run test -- src/main/agent/__tests__/model-discovery.test.ts
```

Expected: all discovery tests pass with richer metadata objects.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/model-discovery.ts src/main/ipc/settings-handlers.ts src/shared/ipc-types.ts src/main/agent/__tests__/model-discovery.test.ts
git commit -m "feat: expose rich provider metadata through model discovery"
```

---

## Task 6: Thread resolved metadata into model construction

**Files:**
- Modify: `src/main/agent/model-factory.ts`
- Modify: `src/main/agent/__tests__/model-factory.test.ts`

- [ ] **Step 1: Extend the factory options**

In `src/main/agent/model-factory.ts`, update imports and options:

```ts
import type { ProviderModelMetadata } from "./providers/provider-client.types";

export interface ModelFactoryOptions {
  provider: ModelProvider;
  metadata?: ProviderModelMetadata;
}
```

- [ ] **Step 2: Use resolved metadata for dynamic OpenAI and Ollama models**

Replace the hardcoded context window sections with:

```ts
function makeOllamaModel(
  provider: Extract<ModelProvider, { type: "ollama" }>,
  metadata?: ProviderModelMetadata,
): Model<"openai-completions"> {
  const contextWindow = metadata?.effectiveContextWindow ?? metadata?.maxContextWindow ?? 128_000;
  return {
    id: provider.model,
    name: provider.model,
    api: "openai-completions",
    provider: "openai",
    baseUrl: `${provider.host.replace(/\/$/, "")}/v1`,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: metadata?.maxOutputTokens ?? 4096,
  };
}
```

and:

```ts
function makeOpenAiModel(
  provider: Extract<ModelProvider, { type: "openai" }>,
  metadata?: ProviderModelMetadata,
): Model<"openai-completions"> {
  const contextWindow = metadata?.effectiveContextWindow ?? metadata?.maxContextWindow ?? 128_000;
  return {
    id: provider.model,
    name: provider.model,
    api: "openai-completions",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: metadata?.maxOutputTokens ?? 4096,
  };
}
```

Update the switch calls to pass `opts.metadata`.

- [ ] **Step 3: Add a metadata-fed factory test**

In `src/main/agent/__tests__/model-factory.test.ts`, add:

```ts
it("uses resolved metadata context window for ollama", () => {
  const model = createModel({
    provider: { type: "ollama", host: "http://localhost:11434", model: "llama3" },
    metadata: {
      id: "llama3",
      name: "llama3",
      provider: "ollama",
      maxContextWindow: 131072,
      effectiveContextWindow: 32768,
      source: "provider-runtime",
    },
  });
  expect(model.contextWindow).toBe(32768);
});
```

- [ ] **Step 4: Run factory tests**

```bash
bun run test -- src/main/agent/__tests__/model-factory.test.ts
```

Expected: all factory tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/model-factory.ts src/main/agent/__tests__/model-factory.test.ts
git commit -m "feat: feed resolved context metadata into model factory"
```

---

## Task 7: Resolve metadata before creating main and worker agents

**Files:**
- Modify: `src/main/agent/session.ts`
- Modify: `src/main/agent/MessagePipeline.ts`
- Modify: `src/main/agent/worker-agent.ts`
- Modify: `src/main/ipc/chat-handlers.ts`
- Modify: `src/main/agent/session.test.ts`

- [ ] **Step 1: Add optional resolved metadata to session options**

In `src/main/agent/session.ts`, add:

```ts
import type { ProviderModelMetadata } from "./providers/provider-client.types";

export interface AgentSessionOptions {
  // existing fields...
  resolvedModelMetadata?: ProviderModelMetadata;
}
```

- [ ] **Step 2: Use resolved context in MessagePipeline**

In `src/main/agent/MessagePipeline.ts`, import the fallback helper:

```ts
import { getDefaultContextWindow } from "./providers/static-model-metadata";
```

Then replace the model/pruning section with:

```ts
const effectiveContextWindow =
  options.resolvedModelMetadata?.effectiveContextWindow ??
  options.resolvedModelMetadata?.maxContextWindow ??
  getDefaultContextWindow();

this.agent = new Agent({
  initialState: {
    systemPrompt,
    model: createModel({
      provider: options.provider,
      metadata: options.resolvedModelMetadata,
    }),
    tools,
    messages: initialMessages,
  },
  transformContext: async (messages) => pruneMessages(messages, effectiveContextWindow),
  getApiKey: async () => (options.provider.type === "ollama" ? "ollama" : options.provider.apiKey),
  beforeToolCall: async (ctx) => {
    const allowed = new Set(tools.map((t) => t.name));
    if (!allowed.has(ctx.toolCall.name)) {
      return { block: true, reason: `Tool "${ctx.toolCall.name}" is not registered.` };
    }
    const tool = tools.find((t) => t.name === ctx.toolCall.name);
    const description = tool?.label ?? ctx.toolCall.name;
    this.state.pendingToolDescriptions.set(ctx.toolCall.id, description);
    return undefined;
  },
});
```

- [ ] **Step 3: Resolve metadata before creating AgentSession**

In `src/main/ipc/chat-handlers.ts`, add:

```ts
import { modelMetadataService } from "../agent/providers/ModelMetadataService";
```

and before `new AgentSession({ ... })` insert:

```ts
const resolvedModelMetadata = await modelMetadataService.getModelMetadata(provider);
```

then pass it into the constructor:

```ts
const session = new AgentSession({
  // existing fields...
  provider,
  resolvedModelMetadata,
  isFirstRun,
  systemContext,
  // ...
});
```

- [ ] **Step 4: Resolve metadata inside createWorkerAgent**

In `src/main/agent/worker-agent.ts`, add:

```ts
import { modelMetadataService } from "./providers/ModelMetadataService";
```

Before constructing `const agent = new Agent({ ... })`, insert:

```ts
const resolvedModelMetadata = await modelMetadataService.getModelMetadata(provider);
const effectiveContextWindow =
  resolvedModelMetadata.effectiveContextWindow ??
  resolvedModelMetadata.maxContextWindow ??
  128_000;
```

and use:

```ts
model: createModel({ provider, metadata: resolvedModelMetadata }),
```

Do not add new worker-agent pruning logic in this task. The goal here is only to ensure dynamic worker models use the same resolved metadata source as the main session.

- [ ] **Step 5: Add a session plumbing test**

In `src/main/agent/session.test.ts`, import the mocked `createModel` and assert the constructor passes `resolvedModelMetadata` through to `MessagePipeline`:

```ts
it("passes resolved model metadata into createModel", () => {
  const { createModel } = require("./model-factory") as {
    createModel: ReturnType<typeof vi.fn>;
  };

  new AgentSession({
    eventBus,
    messageService: messageService as never,
    homeService: makeHomeService() as never,
    researchService: makeResearchService() as never,
    memoryManager: makeMemoryManager() as never,
    initialMemoryContext: { summary: "", recentMessages: [] },
    projectId: "p-1",
    slug: "test",
    projectName: "Test Project",
    folderPath: null,
    projectPath: null,
    provider: { type: "openai", apiKey: "sk-openai", model: "gpt-4o" },
    resolvedModelMetadata: {
      id: "gpt-4o",
      name: "gpt-4o",
      provider: "openai",
      maxContextWindow: 128000,
      effectiveContextWindow: 128000,
      source: "pi-ai",
    },
    isFirstRun: false,
    allowlistService: new AllowlistService(),
  });

  expect(createModel).toHaveBeenCalledWith({
    provider: { type: "openai", apiKey: "sk-openai", model: "gpt-4o" },
    metadata: {
      id: "gpt-4o",
      name: "gpt-4o",
      provider: "openai",
      maxContextWindow: 128000,
      effectiveContextWindow: 128000,
      source: "pi-ai",
    },
  });
});
```

- [ ] **Step 6: Run session and worker tests**

```bash
bun run test -- src/main/agent/session.test.ts src/main/agent/worker-agent.test.ts
```

Expected: the affected tests pass with resolved metadata support.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/session.ts src/main/agent/MessagePipeline.ts src/main/agent/worker-agent.ts src/main/ipc/chat-handlers.ts src/main/agent/session.test.ts
git commit -m "feat: resolve provider metadata before agent construction"
```

---

## Task 8: Reduce the old registry to fallback-only behavior and finish verification

**Files:**
- Modify: `src/main/agent/model-registry.ts`
- Modify: `src/main/agent/__tests__/model-registry.test.ts`

- [ ] **Step 1: Stop exposing the old registry as the primary API**

Replace `src/main/agent/model-registry.ts` with a compatibility wrapper:

```ts
import { getStaticModelMetadata } from "./providers/static-model-metadata";

export function getContextWindow(modelId: string): number {
  return getStaticModelMetadata("openai", modelId).effectiveContextWindow ?? 128_000;
}
```

This keeps any straggler imports working while making the fallback origin explicit.

- [ ] **Step 2: Update the registry tests to describe fallback-only behavior**

In `src/main/agent/__tests__/model-registry.test.ts`, rename the suite and keep only fallback assertions:

```ts
describe("getContextWindow fallback wrapper", () => {
  it("returns the fallback gpt-4o context window", () => {
    expect(getContextWindow("gpt-4o-2024-11-20")).toBe(128_000);
  });

  it("returns the default fallback for unknown models", () => {
    expect(getContextWindow("unknown-model-xyz")).toBe(128_000);
  });
});
```

- [ ] **Step 3: Run full targeted verification**

```bash
bun run test -- src/main/agent/providers/__tests__/static-model-metadata.test.ts src/main/agent/providers/__tests__/OpenRouterProviderClient.test.ts src/main/agent/providers/__tests__/OpenAiProviderClient.test.ts src/main/agent/providers/__tests__/OllamaProviderClient.test.ts src/main/agent/providers/__tests__/ModelMetadataService.test.ts src/main/agent/__tests__/model-discovery.test.ts src/main/agent/__tests__/model-factory.test.ts src/main/agent/__tests__/model-registry.test.ts src/main/agent/session.test.ts src/main/agent/worker-agent.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 4: Run repo quality gates**

```bash
bun run typecheck
bun run check
bun run test
bun run test:coverage
```

Expected: zero type errors, zero Biome issues, all tests pass, coverage remains at or above enforced thresholds.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/model-registry.ts src/main/agent/__tests__/model-registry.test.ts
git commit -m "refactor: retire static model registry as primary context source"
```
