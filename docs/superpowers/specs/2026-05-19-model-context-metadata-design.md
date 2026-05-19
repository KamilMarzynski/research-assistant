# Model Context Metadata Resolution Design

> **Project:** Research Assistant  
> **Date:** 2026-05-19  
> **Status:** Approved for implementation  
> **Scope:** Replace static context-window guessing with provider-aware model metadata resolution for Ollama, OpenRouter, and OpenAI

---

## 1. Goal

When the app needs a model context window, it must first ask the model provider for metadata when that provider can supply it. Only if provider metadata cannot be fetched should the app fall back to local defaults.

This design replaces the current static `getContextWindow(modelId)` approach with a provider-aware metadata layer that:

- fetches model context metadata from provider APIs where possible
- prefers configured/runtime context for Ollama when available
- reuses `pi-ai` registered metadata as the first fallback for OpenAI
- preserves a final static fallback path for unknown or unreachable models
- gives both runtime pruning and model discovery UI the same source of truth

---

## 2. Problem

Current behavior is split across separate modules with duplicated assumptions:

- `src/main/agent/model-registry.ts` maps model-name patterns to hardcoded context windows
- `src/main/agent/MessagePipeline.ts` prunes messages using only that static registry
- `src/main/agent/model-discovery.ts` fetches provider model lists but throws away metadata beyond `id` and `name`
- `src/main/agent/model-factory.ts` hardcodes `128_000` for dynamic OpenAI and Ollama models

This creates four concrete problems:

1. **Ollama is inaccurate by design.** The effective context window may depend on runtime/configured state for the local host, but the app always assumes `128_000`.
2. **OpenRouter metadata is ignored.** The provider already exposes context length per model, but the app does not use it.
3. **OpenAI fallback is implicit and duplicated.** The app already has `pi-ai` model metadata available for some models, but pruning does not use it.
4. **UI and runtime diverge.** Model selection and runtime execution do not share one metadata contract.

---

## 3. Scope

### In scope

- provider-aware model metadata fetching in the main process
- model context resolution for `ollama`, `openrouter`, and `openai`
- replacing static pruning lookup with resolved provider metadata
- extending provider model discovery to return metadata alongside model names
- caching model metadata in memory for short-lived reuse
- tests for provider parsing, fallback ordering, and Ollama runtime-context preference

### Out of scope

- adding support for Anthropic direct API
- persisting model metadata cache to disk
- background refresh daemons
- changing project model override syntax
- changing renderer UX beyond consuming richer discovery data

---

## 4. Verified Provider Capabilities

The following provider behavior has been verified on 2026-05-19:

- **OpenRouter**
  - `GET /api/v1/models` returns model metadata including `context_length`
- **Ollama**
  - `POST /api/show` returns detailed model metadata including context-related values in `model_info`
  - `GET /api/ps` returns runtime information for loaded models, including `context_length`
- **OpenAI**
  - official model APIs expose model identity and availability, but not context window as API metadata

Implication:

- OpenRouter and Ollama can be provider-first for context metadata.
- OpenAI can only be provider-first for model existence/listing; context window still requires local fallback.

---

## 5. Design Overview

Introduce a provider behavior layer and a single metadata service:

```text
resolveProvider(settings, project override)
  -> ModelProvider union
  -> ProviderClientFactory
  -> ModelMetadataService
       -> provider client fetch
       -> pi-ai fallback when applicable
       -> static fallback when necessary
  -> createModel(...)
  -> pruneMessages(...)
```

The existing `ModelProvider` discriminated union remains as the configuration object. Provider network behavior moves into dedicated classes.

---

## 6. Core Types

### 6.1 `ProviderModelMetadata`

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
```

Rules:

- `maxContextWindow` means the model’s declared upper bound.
- `effectiveContextWindow` means the context window the app should actually use for pruning.
- For Ollama, `effectiveContextWindow` may be lower than `maxContextWindow`.
- For OpenRouter and OpenAI, `effectiveContextWindow` usually equals `maxContextWindow` when known.

### 6.2 `ModelProviderClient`

```ts
export interface ModelProviderClient {
  listModels(): Promise<ProviderModelMetadata[]>;
  getModelMetadata(modelId: string): Promise<ProviderModelMetadata | null>;
}
```

This is intentionally narrow. It serves the current use case without turning provider clients into general SDK wrappers.

---

## 7. Module Layout

New modules under `src/main/agent/providers/`:

- `provider-client.types.ts`
- `ProviderClientFactory.ts`
- `OpenRouterProviderClient.ts`
- `OpenAiProviderClient.ts`
- `OllamaProviderClient.ts`
- `ModelMetadataService.ts`
- `static-model-metadata.ts`

Existing modules to update:

- `src/main/agent/model-discovery.ts`
- `src/main/agent/model-factory.ts`
- `src/main/agent/MessagePipeline.ts`
- `src/main/ipc/settings-handlers.ts`
- shared IPC request/response types if model discovery shape changes

`src/main/agent/model-registry.ts` should be retired or reduced to a static fallback dataset used only by `ModelMetadataService`.

---

## 8. Provider-Specific Behavior

### 8.1 OpenRouter

Primary endpoint:

- `GET https://openrouter.ai/api/v1/models`

Parsing:

- `id` -> `metadata.id`
- `name ?? id` -> `metadata.name`
- `context_length` -> `maxContextWindow` and `effectiveContextWindow`

Rules:

- If the endpoint succeeds and the requested model exists, use provider metadata directly.
- If the requested model is not found in the response, fall back to `pi-ai` metadata if available, then static fallback.
- `source` is `provider-api` on success.

### 8.2 Ollama

Primary endpoints:

- `GET {host}/api/ps`
- `POST {host}/api/show`

Resolution order for a specific model:

1. Query `/api/ps`
2. If the target model is loaded and exposes `context_length`, set `effectiveContextWindow` from runtime
3. Query `/api/show` for the model
4. Extract declared model context from `model_info`
5. Use declared model context as `maxContextWindow`
6. If `/api/show` exposes configured context and `/api/ps` did not, use that as `effectiveContextWindow`
7. If no provider metadata is usable, fall back to static defaults

Rules:

- The app must prefer configured/runtime context when available.
- `effectiveContextWindow` is the pruning value.
- `maxContextWindow` is retained for visibility and future diagnostics.
- `source` is `provider-runtime` when `/api/ps` provides the effective value, otherwise `provider-api` when `/api/show` succeeds.

Important nuance:

- Ollama can expose a model’s potential max context and also the context actually configured for the host/runtime.
- Pruning must use the configured/runtime value, not the theoretical max, when runtime/configured data is available.

### 8.3 OpenAI

Primary endpoint:

- `GET https://api.openai.com/v1/models`

Optional follow-up:

- `GET https://api.openai.com/v1/models/{model}`

Rules:

- Use provider API to validate/list models only.
- Do not expect context window from provider responses.
- For context resolution, use this fallback order:
  1. `pi-ai` registered model metadata
  2. local static fallback metadata
  3. default `128_000`

`source` is:

- `pi-ai` if `pi-ai` metadata resolved the context
- `static-fallback` otherwise

---

## 9. Fallback Policy

### 9.1 Effective context resolution

`ModelMetadataService.getEffectiveContextWindow(provider)` resolves in this order:

#### Ollama

1. provider runtime/configured context
2. provider declared max context
3. static fallback
4. default `128_000`

#### OpenRouter

1. provider `context_length`
2. `pi-ai` metadata if available
3. static fallback
4. default `128_000`

#### OpenAI

1. `pi-ai` metadata
2. static fallback
3. default `128_000`

### 9.2 Static fallback dataset

The static fallback dataset should be small and explicit. It exists only to cover:

- provider outages
- unknown OpenAI models not present in `pi-ai`
- incomplete provider payloads
- tests that need deterministic fallback behavior

It should not remain the primary runtime mechanism.

---

## 10. Caching

Use a small in-memory TTL cache inside `ModelMetadataService`.

### Cache goals

- avoid repeated provider fetches during one session
- avoid calling model list endpoints on every single message
- keep implementation simple and local to the main process

### Cache key

Cache key includes:

- provider type
- model id
- provider host for Ollama

Examples:

- `openrouter:anthropic/claude-sonnet-4-6`
- `openai:gpt-4o`
- `ollama:http://localhost:11434:llama3.2:3b`

### TTL policy

- successful metadata lookup: 5 minutes
- failed lookup / provider unreachable: 30 seconds

This prevents sticky stale failures while still damping repeated retries.

No disk persistence is needed.

---

## 11. Runtime Integration

### 11.1 Message pruning

Current:

- `MessagePipeline` calls `getContextWindow(options.provider.model)`

New behavior:

- `MessagePipeline` calls `await modelMetadataService.getEffectiveContextWindow(options.provider)`

This should happen inside the existing async `transformContext` path so no extra synchronous plumbing is required.

### 11.2 Model factory

Current:

- `makeOllamaModel()` and `makeOpenAiModel()` hardcode `contextWindow: 128_000`

New behavior:

- `createModel()` should accept resolved metadata or ask `ModelMetadataService` for it
- dynamic models should use resolved `effectiveContextWindow ?? maxContextWindow ?? 128_000`

Important constraint:

- pruning and model construction must read from the same metadata source so they cannot drift.

### 11.3 Discovery IPC

Current discovery response:

```ts
interface GetProviderModelsResponse {
  models: Array<{ id: string; name: string }>;
  error?: string;
}
```

New response:

```ts
interface GetProviderModelsResponse {
  models: ProviderModelMetadata[];
  error?: string;
}
```

Renderer can ignore the new fields at first. This keeps rollout incremental.

---

## 12. Error Handling

Provider metadata fetches should not throw through the app boundary for normal failure cases. They should return `null` or empty results and let `ModelMetadataService` continue fallback resolution.

### Expected failure cases

- Ollama host unreachable
- Ollama returns malformed `model_info`
- OpenRouter returns non-200 or rate-limits
- OpenAI key invalid or missing
- requested model missing from provider list

### Behavior

- log provider failure with provider name and model id
- continue fallback resolution
- only surface UI errors in model-discovery flows, not in runtime pruning flows

Runtime chat should continue using a fallback context window rather than fail to send.

---

## 13. Testing

Add unit coverage for:

- OpenRouter parsing of `context_length`
- Ollama `/api/ps` runtime context preferred over `/api/show` max context
- Ollama `/api/show` fallback when `/api/ps` has no matching model
- OpenAI `pi-ai` fallback ordering
- static fallback ordering for unknown models
- cache hit/miss behavior and short TTL for failures
- `MessagePipeline` pruning using resolved effective context
- discovery IPC returning richer metadata without breaking existing callers

Existing tests for `model-discovery.ts` should be updated rather than duplicated where possible.

Coverage target remains the repo standard.

---

## 14. Rollout Plan

1. Add provider client types and implementations
2. Add `ModelMetadataService` and static fallback dataset
3. Update discovery functions to return `ProviderModelMetadata`
4. Update IPC contract and settings handler
5. Replace static pruning lookup in `MessagePipeline`
6. Update `model-factory` to consume resolved metadata
7. Remove or downgrade `model-registry.ts` to fallback-only data
8. Add tests and verify typecheck, lint, test, coverage

---

## 15. Risks and Tradeoffs

### Additional provider requests

This design adds provider calls before or during runtime resolution. The cache is necessary to avoid turning every message into a metadata request.

### OpenAI remains partly heuristic

OpenAI’s official model endpoints do not expose context window metadata, so the provider-first rule cannot be fully satisfied there. This is a provider limitation, not a design gap.

### Ollama payload variability

Ollama metadata shape may vary by version and model family. Parsing should be defensive and isolate provider-specific logic inside `OllamaProviderClient`.

### Slightly more moving parts

A small set of provider classes is more code than the current procedural helpers, but it removes duplicated assumptions and gives the app one coherent metadata path.

---

## 16. Acceptance Criteria

- message pruning no longer relies on static model-name pattern matching as the primary mechanism
- Ollama pruning uses configured/runtime context when the host exposes it
- OpenRouter context length comes from provider metadata
- OpenAI context resolution uses `pi-ai` first, then static fallback
- provider model discovery returns metadata rich enough for future UI use
- all normal provider failures degrade to fallback values instead of breaking chat
- tests cover provider parsing and fallback ordering
