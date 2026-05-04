# Model Selector Refactor with Auto-Discovery

## Problem

Current model selector uses free-text `TextField` for model name. User must know exact model slug. No validation, typos cause runtime failures. Ollama host is configured but model list is manual.

## Goal

Replace free-text model input with strict dropdown populated via provider-specific auto-discovery APIs. Backend fetches models; renderer shows dropdown with loading/error states.

## Scope

- Model selector in Settings → Model Provider tab only.
- Providers: OpenRouter, Ollama, OpenAI.
- Anthropic stays disabled (use OpenRouter).

## Out of scope

- Project-level model overrides (chat input syntax `provider:model` stays untouched).
- Caching model lists across sessions.
- Pulling/downloading models from UI.

## Architecture

```
Renderer (SettingsModal)
  ├─ Provider dropdown (existing)
  ├─ Host field (Ollama only, existing)
  ├─ API key field (OpenRouter/OpenAI, existing)
  └─ Model Autocomplete (strict dropdown) ← NEW
       - Fetches on provider/host/apiKey change
       - Shows loading / error / empty states

Main Process
  ├─ GET_PROVIDER_MODELS IPC handler ← NEW
  └─ model-discovery.ts ← NEW module
       - getOllamaModels(host)
       - getOpenRouterModels(apiKey?)
       - getOpenAiModels(apiKey)
```

## IPC Contract

```typescript
// request
interface GetProviderModelsRequest {
  provider: "ollama" | "openrouter" | "openai";
  host?: string;       // required for ollama
  apiKey?: string;     // optional for openrouter, required for openai
}

// response
interface GetProviderModelsResponse {
  models: Array<{ id: string; name: string }>;
  error?: string;
}
```

New channel: `GET_PROVIDER_MODELS` (renderer→main, invoke).

`MODEL_FALLBACK` channel stays unchanged — used by main process to notify renderer when Ollama unavailable.

## Backend Discovery

### Ollama
- Endpoint: `GET {host}/api/tags`
- Timeout: 5000ms
- Parse: `.models[].name` → `{ id: name, name: name }`
- Error: connection refused, unexpected JSON

### OpenRouter
- Endpoint: `GET https://openrouter.ai/api/v1/models`
- Auth: optional Bearer token for user-specific list; unauthenticated returns all public models.
- Timeout: 5000ms
- Parse: `.data[]` → `{ id: data.id, name: data.name ?? data.id }`
- Error: rate limit, parse failure

### OpenAI
- Endpoint: `GET https://api.openai.com/v1/models`
- Auth: required Bearer token.
- Timeout: 5000ms
- Parse: `.data[].id` → filter `id.startsWith("gpt-")` → `{ id, name: id }`
- Error: 401 invalid key, network failure

All discovery functions return `{ models: [], error?: string }`. No throwing.

## UI Flow

1. User opens Settings → Model Provider.
2. SettingsModal loads current settings (existing).
3. On provider change:
   - If OpenRouter: fetch models immediately (apiKey from current creds, may be empty).
   - If OpenAI: fetch only if apiKey present; else show "Enter API key to list models".
   - If Ollama: wait for host field; fetch on host blur / Enter key / manual "Refresh".
4. While fetching: show `CircularProgress` in dropdown area.
5. On success: populate `Autocomplete` strict dropdown. If current `defaultModel` not in list, auto-select first available. If list empty, keep current value (user sees "No options").
6. On error: show error text below dropdown + "Retry" button. Keep previous selection if valid.
7. On empty list: show helper text "No models found. Check host or pull a model first."

## Component Changes

### `ModelProviderTab.tsx`

Replace `TextField` (model) with MUI `Autocomplete`:
- `options`: `{ id, name }[]`
- `value`: selected `{ id, name }` or null
- `onChange`: emit selected model id
- `loading`: boolean prop
- `noOptionsText`: "No models found"
- `renderInput`: standard TextField with helperText slot for errors

New props:
- `availableModels: Array<{id, name}>`
- `modelsLoading: boolean`
- `modelsError: string | null`
- `onRefreshModels: () => void`

### `SettingsModal.tsx`

Add state:
- `availableModels: {id, name}[]`
- `modelsLoading: boolean`
- `modelsError: string | null`

Add effect:
- On `activeProvider` change or Ollama host blur: call `window.electronAPI.invoke(IPC.GET_PROVIDER_MODELS, request)`.
- Update state on response.

Remove `ollamaTestStatus` state and `onTestOllama` prop? No — keep connection test as separate concern. Connection test validates host; model list validates models. Both useful.

## Settings Integration

`defaultModel` saved as string (model id). No schema change to `AppSettings` or stored settings.

## Error Handling

| Scenario | Behavior |
|---|---|
| Network timeout | `error: "Connection timed out"`, enable Retry |
| Ollama not running | `error: "Ollama not reachable at {host}"` |
| OpenAI 401 | `error: "Invalid API key"` |
| OpenRouter rate limit | Retry once after 1s; if still failing, show error |
| Empty model list | `error: undefined`, helper text: "No models found" |

## Testing

- Unit tests for each discovery function in `model-discovery.test.ts` (mock fetch).
- IPC handler test: verify request/response shape.
- Component test: verify Autocomplete renders options, loading state, error state.
- TypeScript: zero errors (`bun run typecheck`).
- Lint: clean (`bun run check`).

## Dependencies

No new packages. Uses existing `node:fetch` (Node 20+), MUI `Autocomplete`.

## Migration

User's existing `defaultModel` strings remain valid. On first open, if model not in discovered list, UI auto-selects first available model. User must re-save settings to persist change.

## Risks

- OpenRouter unauthenticated list is large (~300+ models). Autocomplete handles it.
- OpenAI `/v1/models` returns all models (including embeddings, whisper). Filter `gpt-*` keeps list relevant.
- If Ollama host is wrong, model fetch fails. User must fix host first.
