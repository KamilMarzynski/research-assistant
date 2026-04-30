# Run 12 — Model Provider Abstraction (Ollama + Cloud) Design Spec

> **Project:** Research Assistant  
> **Date:** 2026-04-30  
> **Status:** Approved for implementation  
> **Scope:** Core provider plumbing + SettingsModal UI for Ollama fallback — no per-project model selector or MessageInput changes

---

## 1. Goal

Replace the hardcoded OpenRouter-only model architecture with a pluggable provider abstraction that supports:
- **OpenRouter** (existing, cloud)
- **Ollama** (new, local)
- **OpenAI** (direct, cloud — wired for future use)
- **Anthropic** (via OpenRouter routing — direct API blocked, placeholder for error handling)

Add a **"Model Provider"** tab in SettingsModal with Ollama host configuration, model name input, and a connection test button. Implement automatic fallback to the default cloud provider when Ollama is unavailable.

---

## 2. Architecture Overview

```
SettingsService (userData/settings.json)
   |
   v
AppSettings { activeProvider, defaultCloudProvider, providerCredentials }
   |
   +--> resolveProvider() → ModelProvider discriminated union
   |       (openrouter | ollama | openai | anthropic)
   |
   +--> resolveProviderWithFallback() → preflight Ollama + auto-fallback
   |       emits AppEvent.MODEL_FALLBACK on failover
   |
   v
model-factory.ts: createModel({ provider, langfuseEnabled }) → Model<Api>
   |
   +--> AgentSession (main chat)
   +--> worker-agent.ts (research workers, evaluator)
   +--> MemoryManager (Observer, Reflector)
```

---

## 3. `ModelProvider` Type (src/main/agent/model-provider.ts)

```typescript
export type ModelProvider =
  | { type: "openrouter"; apiKey: string; model: string }
  | { type: "ollama"; host: string; model: string }
  | { type: "openai"; apiKey: string; model: string }
  | { type: "anthropic"; apiKey: string; model: string };
```

Discriminated by `type` string. All other fields are provider-specific. `ollama.host` is plain string (not encrypted). All `apiKey` fields are already encrypted by safeStorage at rest.

`isCloudProvider(p)` helper returns true for `openrouter`, `openai`, `anthropic`; false for `ollama`.

---

## 4. Settings Schema (src/main/services/SettingsService.ts)

### 4.1 `AppSettings` (in-memory)

```typescript
export interface AppSettings {
  activeProvider: "openrouter" | "ollama" | "openai" | "anthropic";
  defaultCloudProvider: "openrouter" | "openai" | "anthropic";

  providerCredentials: {
    openrouter: { apiKey: string | null; defaultModel: string };
    openai:     { apiKey: string | null; defaultModel: string };
    anthropic:  { apiKey: string | null; defaultModel: string };
    ollama:     { host: string; defaultModel: string };
  };

  langfuseEnabled: boolean;
}
```

`DEFAULT_SETTINGS`:
- `activeProvider: "openrouter"`
- `defaultCloudProvider: "openrouter"`
- `openrouter.defaultModel: "anthropic/claude-sonnet-4-6"` (matches current default)
- `ollama.host: "http://localhost:11434"`
- `ollama.defaultModel: "llama3.2:3b"`

### 4.2 `StoredSettings` (on disk, JSON)

```typescript
export interface StoredSettings {
  version: number;              // 0 = legacy, 1 = new schema

  openrouterApiKey?: string;    // legacy v0, base64-encrypted
  model?: string;               // legacy v0, plain
  langfuseEnabled?: boolean;    // legacy v0

  // v1 fields
  activeProvider?: string;
  defaultCloudProvider?: string;
  providerCredentials?: {
    openrouter?: { apiKey?: string; defaultModel?: string };
    openai?:     { apiKey?: string; defaultModel?: string };
    anthropic?:  { apiKey?: string; defaultModel?: string };
    ollama?:     { host?: string; defaultModel?: string };
  };
}
```

### 4.3 Migration (idempotent, in getSettings())

```typescript
if (stored.version === undefined || stored.version < 1) {
  // Migrate from old single-provider schema
  stored.providerCredentials ??= {};
  stored.providerCredentials.openrouter = {
    apiKey: stored.openrouterApiKey ?? null,
    defaultModel: stored.model ?? "anthropic/claude-sonnet-4-6",
  };
  stored.activeProvider = "openrouter";
  stored.defaultCloudProvider = "openrouter";
  stored.version = 1;

  // Delete legacy fields to clean up file
  delete stored.openrouterApiKey;
  delete stored.model;

  await this.saveRaw(stored);
}
```

After migration, the file contains `version: 1`, `providerCredentials`, and `langfuseEnabled`. All other fields are removed.

### 4.4 Encryption

- All `apiKey` fields are encrypted via `safeStorage.encryptString` → stored as base64 in JSON.
- `ollama.host` is stored plain (not sensitive).
- Decryption happens on read; encryption on write.

---

## 5. DB Migration

```sql
ALTER TABLE projects ADD COLUMN model_override TEXT;
```

- `NULL` means "use global activeProvider."
- Format: `"ollama:llama3.2:3b"` or `"openrouter:anthropic/claude-sonnet-4-6"`.
- Schema handled via Drizzle ORM migration in `src/main/db/migrations/`.

---

## 6. Resolver Functions (src/main/agent/model-provider.ts)

### 6.1 `resolveProvider(opts)`

```typescript
export interface ResolveProviderOpts {
  settings: AppSettings;
  projectModelOverride?: string | null;
  forceCloud?: boolean;
}

export function resolveProvider(opts: ResolveProviderOpts): ModelProvider {
  if (opts.forceCloud) {
    return buildCloudProvider(opts.settings);
  }

  if (opts.projectModelOverride) {
    return parseModelOverride(opts.projectModelOverride, opts.settings);
  }

  const creds = opts.settings.providerCredentials[opts.settings.activeProvider];

  switch (opts.settings.activeProvider) {
    case "openrouter":
      return { type: "openrouter", apiKey: creds.apiKey ?? "", model: creds.defaultModel };
    case "openai":
      return { type: "openai", apiKey: creds.apiKey ?? "", model: creds.defaultModel };
    case "anthropic":
      return { type: "anthropic", apiKey: creds.apiKey ?? "", model: creds.defaultModel };
    case "ollama":
      return { type: "ollama", host: (creds as any).host, model: (creds as any).defaultModel };
  }
}
```

### 6.2 `resolveProviderWithFallback(opts)`

```typescript
export async function resolveProviderWithFallback(
  opts: ResolveProviderOpts,
  eventBus?: IEventBus,
): Promise<ModelProvider> {
  const primary = resolveProvider({ ...opts });

  if (primary.type !== "ollama") {
    return primary;
  }

  const available = await checkOllamaAvailable(primary.host);
  if (available) return primary;

  console.warn(
    `[ModelFactory] Ollama unavailable at ${primary.host}, ` +
      `falling back to ${opts.settings.defaultCloudProvider}`,
  );

  eventBus?.emit(AppEvent.MODEL_FALLBACK, {
    reason: "ollama_unavailable",
    requestedModel: primary.model,
    fallbackProvider: opts.settings.defaultCloudProvider,
  });

  return buildCloudProvider(opts.settings);
}
```

`buildCloudProvider()` creates an `openrouter` or `openai` provider using `defaultCloudProvider`.

### 6.3 `checkOllamaAvailable(host)`

```typescript
export async function checkOllamaAvailable(host: string): Promise<boolean> {
  try {
    const res = await fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

---

## 7. Model Factory (src/main/agent/model-factory.ts)

Rewritten to accept `ModelProvider`:

```typescript
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
      };
    }
  }

  return base;
}

function resolveBaseConfig(provider: ModelProvider) {
  switch (provider.type) {
    case "openrouter":
      return {
        model: provider.model,
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: provider.apiKey,
      };
    case "ollama":
      return {
        model: provider.model,
        baseUrl: `${provider.host}/v1`,
        apiKey: "ollama",
      };
    case "openai":
      return {
        model: provider.model,
        baseUrl: "https://api.openai.com/v1",
        apiKey: provider.apiKey,
      };
    case "anthropic":
      throw new Error(
        'Direct Anthropic API is not OpenAI-compatible. ' +
          'Use OpenRouter with model slug "anthropic/claude-*" instead.',
      );
  }
}
```

**Anthropic decision:** Direct Anthropic API uses a different request shape than OpenAI. Pi (via `@mariozechner/pi-ai`) only speaks OpenAI-compatible endpoints. For Anthropic models, users should route through OpenRouter (`anthropic/claude-*` slugs). The `anthropic` provider type is reserved for future direct support if Pi adds a native Anthropic adapter.

---

## 8. Agent Wiring

### 8.1 `AgentSession` (src/main/agent/session.ts)

Constructor stops receiving `{ apiKey, model }`. Instead, it receives `ModelProvider`:

```typescript
export interface AgentSessionOptions {
  provider: ModelProvider;
  langfuseEnabled: boolean;
  // ... other deps
}
```

`AgentSession` calls `createModel({ provider, langfuseEnabled })`.

### 8.2 Worker Agents (src/main/agent/worker-agent.ts)

`WorkerAgentConfig` replaces `{ apiKey, model }` with `{ provider: ModelProvider }`.

Line 228 (currently `getModel("openrouter", model as never)`) is replaced with `createModel({ provider: config.provider, langfuseEnabled: false })`.

`makeEvaluatorFn` now resolves provider with `forceCloud: true`:

```typescript
const provider = resolveProvider({ settings, forceCloud: true });
```

### 8.3 ResearchService (src/main/services/ResearchService.ts)

Before spawning a worker:
```typescript
const provider = await resolveProviderWithFallback({
  settings,
  projectModelOverride: project.modelProvider,
});
```

This is the single call site for model resolution in research dispatch.

### 8.4 MemoryManager (src/main/services/MemoryManager.ts)

Observer/Reflector always use cloud with a **hardcoded small model** optimized for compression (not the user's default model):

```typescript
const COMPRESSION_MODEL_ID = "anthropic/claude-haiku-4.5" as const;

const provider = resolveProvider({
  settings,
  forceCloud: true,
  projectModelOverride: `openrouter:${COMPRESSION_MODEL_ID}`,
});
```

This preserves the existing decision from [[Research Assistant Synthesis 2026-04-27]]: compression needs a small, fast model regardless of the user's chat preference.

---

## 9. Fallback Events

### 9.1 `AppEvent.MODEL_FALLBACK`

Emitted by `resolveProviderWithFallback` when Ollama is down.

Payload shape:
```typescript
export interface ModelFallbackPayload {
  reason: "ollama_unavailable";
  requestedModel: string;
  fallbackProvider: string;
}
```

### 9.2 Renderer-side Toast

The renderer listens for `MODEL_FALLBACK` and shows a MUI Snackbar/toast:

> "Ollama is offline. Switched to {fallbackProvider}."

This is a one-line UI addition in `App.tsx` (where other `webContents.send` handlers live).

---

## 10. SettingsModal UI

Add a **"Model Provider"** tab (third tab, after General and Audit Log).

### 10.1 Tab Layout

- **Active provider** — `Select` dropdown with four options: OpenRouter, Ollama, OpenAI, Anthropic.
  - Selecting "Anthropic" shows an inline `Chip` error: "Direct Anthropic not supported — use OpenRouter."
- **Per-provider panel** — conditional rendering below the dropdown:
  - *OpenRouter*: Password field (API key) + TextField (model slug, e.g. `anthropic/claude-sonnet-4-6`)
  - *Ollama*: TextField (host, default `http://localhost:11434`) + TextField (model, default `llama3.2:3b`) + **"Test connection"** button
  - *OpenAI*: Password field (API key) + TextField (model, e.g. `gpt-4o`)
  - *Anthropic*: Disabled. Show error chip. No fields.
- **Default cloud provider** — `Select` with "OpenRouter" and "OpenAI". Label: "Fallback when local model is offline." Only visible when Active provider is "Ollama."

### 10.2 "Test Connection" Button

Calls a new IPC channel: `IPC.CHECK_OLLAMA`.

Main handler:
```typescript
ipcMain.handle(IPC.CHECK_OLLAMA, async (_e, host: string) => {
  const available = await checkOllamaAvailable(host);
  return { available, host };
});
```

Renderer shows:
- Green `CheckCircle` icon + "Connected" if `available === true`
- Red `ErrorOutline` icon + "Ollama not reachable" if `available === false`

### 10.3 Data Flow

- On SettingsModal open: `invoke(IPC.GET_SETTINGS)` → populate all fields.
- On Save: `invoke(IPC.SAVE_SETTINGS, patch)` where `patch` contains only changed provider fields.
- No new IPC channels beyond `CHECK_OLLAMA`. `GET_SETTINGS` / `SAVE_SETTINGS` already transport arbitrary JSON.

---

## 11. Files to Touch

### New files
| Path | Purpose |
|---|---|
| `src/main/agent/model-provider.ts` | `ModelProvider` type, `resolveProvider`, `resolveProviderWithFallback`, `checkOllamaAvailable` |
| `src/main/agent/__tests__/model-provider.test.ts` | Unit tests for resolver + fallback |

### Modified files
| Path | Change |
|---|---|
| `src/main/agent/model-factory.ts` | Rewrite to accept `ModelProvider`; remove literal `"openrouter"` |
| `src/main/agent/session.ts` | Options accept `provider` instead of `{ apiKey, model }` |
| `src/main/agent/worker-agent.ts` | `WorkerAgentConfig` uses `ModelProvider`; remove direct `getModel("openrouter", ...)` |
| `src/main/agent/__tests__/model-factory.test.ts` | Update to new signature |
| `src/main/services/SettingsService.ts` | Extend `AppSettings` + `StoredSettings`; add v0→v1 migration |
| `src/main/services/MemoryManager.ts` | Observer/Reflector use `resolveProvider({ forceCloud: true })` |
| `src/main/services/ResearchService.ts` | Resolve provider with fallback before spawning workers |
| `src/main/ipc-handlers.ts` | Wire `IPC.CHECK_OLLAMA`; pass provider to `AgentSession` |
| `src/main/db/migrations/` | Add migration for `projects.model_override` |
| `src/main/db/schema.ts` | Add `modelOverride` column to projects table |
| `src/shared/ipc-channels.ts` | Add `CHECK_OLLAMA` channel |
| `src/shared/app-events.ts` | Add `MODEL_FALLBACK` event |
| `src/renderer/components/settings/SettingsModal.tsx` | Add "Model Provider" tab |
| `src/renderer/App.tsx` | Listen for `MODEL_FALLBACK` → toast |
| `src/shared/types.ts` (or equivalent) | Add `ModelFallbackPayload` if not present |

### No changes (deferred to later runs)
| File | Why deferred |
|---|---|
| `src/renderer/components/layout/chat/MessageInput.tsx` | Model selector chip stays unchanged for now. Will be extended in Run B to show provider-aware models. |
| `src/renderer/components/layout/sidebar/LeftSidebar.tsx` | "Change model" context menu deferred to Run B. |
| `src/renderer/components/ArtifactPanel.tsx` | No relation to model providers. |

---

## 12. Testing Plan

### Unit tests (Vitest)
- `resolveProvider` with each provider type
- `resolveProvider` with `forceCloud: true`
- `resolveProvider` with `projectModelOverride`
- `resolveProviderWithFallback`:
  - Ollama available → returns Ollama provider
  - Ollama unavailable → returns fallback provider + emits event
  - Non-Ollama provider → no check, returns directly
- `checkOllamaAvailable`: mock fetch success/failure/timeout
- `model-factory.ts`: each provider shape generates correct `Model<Api>` object
- Migration: v0 settings → v1 settings (idempotent)

### E2E tests (Playwright)
- No new e2e tests needed for this run. The fallback toast is a renderer-side listener on an IPC event — difficult to e2e test without a real Ollama server. Defer e2e coverage to Run B when the model selector chip is updated.

### Manual verification steps
1. Start with existing `settings.json` (v0). Open app → verify migration works (file updated, fields migrated).
2. Open SettingsModal → Model Provider tab. Toggle to Ollama. Enter valid host. Click Test → green. Save.
3. Send a chat message. Verify request goes to `localhost:11434/v1`.
4. Stop Ollama. Send a chat message. Verify toast: "Ollama offline, switched to OpenRouter." Verify request goes to OpenRouter.
5. Toggle back to OpenRouter in Settings. Send message → goes to OpenRouter.

---

## 13. Error Handling

| Scenario | Behavior |
|---|---|
| Ollama host unreachable | Fallback to `defaultCloudProvider`; emit `MODEL_FALLBACK`; renderer shows toast |
| Anthropic selected as active provider | `createModel` throws at runtime with clear error message |
| `apiKey` missing for cloud provider | Existing Pi behavior (auth error on first request) |
| Invalid `project.modelOverride` format | `parseModelOverride` falls back to global activeProvider; logs warning |
| `checkOllamaAvailable` times out | Treats as unavailable (catch block returns false) |
| Migration runs twice | Idempotent: v1 fields present, no-op |

---

## 14. Out of Scope (Deferred)

| Item | Deferred To |
|---|---|
| Per-project model selector in LeftSidebar context menu | Run B |
| MessageInput model chip becomes provider-aware | Run B |
| "Always use cloud for evaluation" setting (power user toggle) | Run B / backlog |
| Model list fetch from Ollama `/api/tags` (dropdown instead of free-text) | Run B |
| Anthropic direct API adapter (bypassing OpenRouter) | Requires Pi SDK support |
| OpenAI direct test button | Minimal scope; host is assumed reachable |
| Windows/Linux Ollama paths | Unchanged — host URL is configurable |

---

## 15. Success Criteria

- [ ] Settings migration works seamlessly (v0 → v1 on first startup)
- [ ] `resolveProvider` returns correct `ModelProvider` for all 4 provider types
- [ ] Ollama connection preflight works; fallback triggers when Ollama is unreachable
- [ ] Fallback event reaches renderer and shows a toast
- [ ] `createModel` produces correct Pi `Model<Api>` for openrouter, ollama, openai
- [ ] Anthropic selection throws with a clear error message at runtime
- [ ] All existing tests pass (234 Vitest + 4 Playwright e2e)
- [ ] At least 8 new unit tests added for provider resolution and fallback
- [ ] Manual verification steps pass (see §12)
- [ ] `MessageInput` model chip is NOT changed in this run (deferred)
- [ ] `projects.model_override` column exists but is not yet exposed in UI

---

*Spec written: 2026-04-30*  
*Next step: User review → implementation plan via writing-plans skill*
