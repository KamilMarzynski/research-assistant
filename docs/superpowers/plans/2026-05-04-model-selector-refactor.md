# Model Selector Refactor with Auto-Discovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace free-text model input in Settings with strict Autocomplete dropdowns populated via backend discovery APIs for OpenRouter, Ollama, and OpenAI.

**Architecture:** New backend module `model-discovery.ts` provides provider-specific model fetching. New IPC channel `GET_PROVIDER_MODELS` bridges renderer requests. `ModelProviderTab` swaps `TextField` for MUI `Autocomplete` with loading/error states. `SettingsModal` orchestrates fetches on provider/host/apiKey changes.

**Tech Stack:** TypeScript strict, Vitest, MUI v9 `Autocomplete`, `node:fetch`, Zod v4 validation.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/shared/ipc-channels.ts` | Modify | Add `GET_PROVIDER_MODELS` channel |
| `src/shared/ipc-types.ts` | Modify | Add request/response types + `IpcResponseMap` entry |
| `src/main/ipc-validation.ts` | Modify | Add `GetProviderModelsSchema` |
| `src/main/agent/model-discovery.ts` | Create | Discovery functions for Ollama, OpenRouter, OpenAI |
| `src/main/agent/__tests__/model-discovery.test.ts` | Create | Unit tests for discovery functions (mock fetch) |
| `src/main/ipc/settings-handlers.ts` | Modify | Register `GET_PROVIDER_MODELS` handler |
| `src/renderer/components/settings/ModelProviderTab.tsx` | Modify | Replace model `TextField` with `Autocomplete` |
| `src/renderer/components/settings/SettingsModal.tsx` | Modify | Fetch models on provider change, pass state to tab |

---

### Task 1: IPC Channel + Types

**Files:**
- Modify: `src/shared/ipc-channels.ts:50-52`
- Modify: `src/shared/ipc-types.ts`

- [ ] **Step 1: Add channel to `ipc-channels.ts`**

Add `GET_PROVIDER_MODELS` under the `// Model provider` block:

```typescript
  // Model provider
  CHECK_OLLAMA: "CHECK_OLLAMA",
  GET_PROVIDER_MODELS: "GET_PROVIDER_MODELS",
  MODEL_FALLBACK: "MODEL_FALLBACK",
```

- [ ] **Step 2: Add types to `ipc-types.ts`**

Insert after `CheckOllamaResponse`:

```typescript
/** Request for GET_PROVIDER_MODELS */
export interface GetProviderModelsRequest {
  provider: "ollama" | "openrouter" | "openai";
  host?: string;
  apiKey?: string;
}

/** Response from GET_PROVIDER_MODELS */
export interface GetProviderModelsResponse {
  models: Array<{ id: string; name: string }>;
  error?: string;
}
```

Add to `IpcResponseMap`:

```typescript
  CHECK_OLLAMA: CheckOllamaResponse;
  GET_PROVIDER_MODELS: GetProviderModelsResponse;
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: zero errors

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc-channels.ts src/shared/ipc-types.ts
git commit -m "feat: add GET_PROVIDER_MODELS IPC channel and types"
```

---

### Task 2: IPC Validation Schema

**Files:**
- Modify: `src/main/ipc-validation.ts`

- [ ] **Step 1: Add `GetProviderModelsSchema`**

After `CheckOllamaSchema`, add:

```typescript
export const GetProviderModelsSchema = z.object({
  provider: z.enum(["ollama", "openrouter", "openai"]),
  host: z.string().optional(),
  apiKey: z.string().optional(),
});
```

- [ ] **Step 2: Run check**

Run: `bun run check`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc-validation.ts
git commit -m "feat: add GetProviderModelsSchema validation"
```

---

### Task 3: Backend Discovery Module

**Files:**
- Create: `src/main/agent/model-discovery.ts`
- Create: `src/main/agent/__tests__/model-discovery.test.ts`

- [ ] **Step 1: Write `model-discovery.ts`**

```typescript
export interface DiscoveredModel {
  id: string;
  name: string;
}

export interface ModelDiscoveryResult {
  models: DiscoveredModel[];
  error?: string;
}

export async function getOllamaModels(host: string): Promise<ModelDiscoveryResult> {
  try {
    const url = new URL("/api/tags", host);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { models: [], error: "Invalid protocol — must be http or https" };
    }
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { models: [], error: `Ollama returned ${res.status}` };
    }
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map((m) => ({ id: m.name, name: m.name }));
    return { models };
  } catch {
    return { models: [], error: "Ollama not reachable" };
  }
}

export async function getOpenRouterModels(apiKey?: string): Promise<ModelDiscoveryResult> {
  try {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { models: [], error: `OpenRouter returned ${res.status}` };
    }
    const data = (await res.json()) as {
      data?: Array<{ id: string; name?: string }>;
    };
    const models = (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
    }));
    return { models };
  } catch {
    return { models: [], error: "OpenRouter request failed" };
  }
}

export async function getOpenAiModels(apiKey: string): Promise<ModelDiscoveryResult> {
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      if (res.status === 401) {
        return { models: [], error: "Invalid API key" };
      }
      return { models: [], error: `OpenAI returned ${res.status}` };
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const models = (data.data ?? [])
      .filter((m) => m.id.startsWith("gpt-"))
      .map((m) => ({ id: m.id, name: m.id }));
    return { models };
  } catch {
    return { models: [], error: "OpenAI request failed" };
  }
}
```

- [ ] **Step 2: Write failing tests**

Create `src/main/agent/__tests__/model-discovery.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import {
  getOllamaModels,
  getOpenAiModels,
  getOpenRouterModels,
} from "../model-discovery";

describe("getOllamaModels", () => {
  it("returns models on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: "llama3.2:3b" }, { name: "mistral:7b" }] }),
    });
    const result = await getOllamaModels("http://localhost:11434");
    expect(result.models).toEqual([
      { id: "llama3.2:3b", name: "llama3.2:3b" },
      { id: "mistral:7b", name: "mistral:7b" },
    ]);
    expect(result.error).toBeUndefined();
  });

  it("returns error on fetch failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    const result = await getOllamaModels("http://localhost:11434");
    expect(result.models).toEqual([]);
    expect(result.error).toBe("Ollama not reachable");
  });

  it("returns error for non-http protocol", async () => {
    const result = await getOllamaModels("file:///etc/passwd");
    expect(result.models).toEqual([]);
    expect(result.error).toBe("Invalid protocol — must be http or https");
  });

  it("returns error on non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const result = await getOllamaModels("http://localhost:11434");
    expect(result.error).toBe("Ollama returned 500");
  });

  it("handles empty models array", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    });
    const result = await getOllamaModels("http://localhost:11434");
    expect(result.models).toEqual([]);
    expect(result.error).toBeUndefined();
  });
});

describe("getOpenRouterModels", () => {
  it("returns models unauthenticated", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
          { id: "openai/gpt-4o" },
        ],
      }),
    });
    const result = await getOpenRouterModels();
    expect(result.models).toEqual([
      { id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
      { id: "openai/gpt-4o", name: "openai/gpt-4o" },
    ]);
    expect(result.error).toBeUndefined();
  });

  it("sends apiKey when provided", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    await getOpenRouterModels("sk-test");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer sk-test" },
      }),
    );
  });

  it("returns error on failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    const result = await getOpenRouterModels();
    expect(result.error).toBe("OpenRouter request failed");
  });

  it("returns error on non-ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    const result = await getOpenRouterModels();
    expect(result.error).toBe("OpenRouter returned 429");
  });
});

describe("getOpenAiModels", () => {
  it("returns only gpt-* models", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "gpt-4o" },
          { id: "text-embedding-ada-002" },
          { id: "gpt-4o-mini" },
          { id: "whisper-1" },
        ],
      }),
    });
    const result = await getOpenAiModels("sk-test");
    expect(result.models).toEqual([
      { id: "gpt-4o", name: "gpt-4o" },
      { id: "gpt-4o-mini", name: "gpt-4o-mini" },
    ]);
    expect(result.error).toBeUndefined();
  });

  it("returns 401 error", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const result = await getOpenAiModels("sk-bad");
    expect(result.error).toBe("Invalid API key");
  });

  it("returns error on network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Timeout"));
    const result = await getOpenAiModels("sk-test");
    expect(result.error).toBe("OpenAI request failed");
  });

  it("returns error on non-ok non-401", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const result = await getOpenAiModels("sk-test");
    expect(result.error).toBe("OpenAI returned 500");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test src/main/agent/__tests__/model-discovery.test.ts`
Expected: FAIL — `getOllamaModels` etc. not found

- [ ] **Step 4: Verify tests pass**

Run: `bun test src/main/agent/__tests__/model-discovery.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/model-discovery.ts src/main/agent/__tests__/model-discovery.test.ts
git commit -m "feat: model discovery functions for ollama, openrouter, openai"
```

---

### Task 4: Wire IPC Handler

**Files:**
- Modify: `src/main/ipc/settings-handlers.ts`

- [ ] **Step 1: Import schema and discovery functions**

Replace the imports at top with:

```typescript
import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { CheckOllamaSchema, GetProviderModelsSchema, SaveSettingsSchema } from "../ipc-validation";
import type { SettingsService } from "../services/SettingsService";
import { parseOrThrow } from "./parse-util";
import type { SessionManager } from "./session-manager";
import {
  getOllamaModels,
  getOpenAiModels,
  getOpenRouterModels,
} from "../agent/model-discovery";
```

- [ ] **Step 2: Add `GET_PROVIDER_MODELS` handler**

After the `CHECK_OLLAMA` handler, add:

```typescript
  ipcMain.handle(IPC.GET_PROVIDER_MODELS, async (_event, payload: unknown) => {
    const p = parseOrThrow(GetProviderModelsSchema, payload, "GET_PROVIDER_MODELS");

    switch (p.provider) {
      case "ollama": {
        if (!p.host) return { models: [], error: "Host is required for Ollama" };
        return getOllamaModels(p.host);
      }
      case "openrouter": {
        return getOpenRouterModels(p.apiKey);
      }
      case "openai": {
        if (!p.apiKey) return { models: [], error: "API key is required for OpenAI" };
        return getOpenAiModels(p.apiKey);
      }
      default:
        return { models: [], error: "Unknown provider" };
    }
  });
```

- [ ] **Step 3: Run typecheck + check**

Run: `bun run typecheck && bun run check`
Expected: zero errors, clean

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/settings-handlers.ts
git commit -m "feat: wire GET_PROVIDER_MODELS IPC handler"
```

---

### Task 5: Update `ModelProviderTab` UI

**Files:**
- Modify: `src/renderer/components/settings/ModelProviderTab.tsx`

- [ ] **Step 1: Add `Autocomplete` import**

Replace MUI imports with:

```typescript
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
```

- [ ] **Step 2: Update props interface**

Replace the interface with:

```typescript
export interface ProviderCredentials {
  openrouter: { apiKey: string; defaultModel: string };
  openai: { apiKey: string; defaultModel: string };
  anthropic: { apiKey: string; defaultModel: string };
  ollama: { host: string; defaultModel: string };
}

export interface ModelOption {
  id: string;
  name: string;
}

interface ModelProviderTabProps {
  activeProvider: string;
  onActiveProviderChange: (provider: string) => void;
  defaultCloudProvider: string;
  onDefaultCloudProviderChange: (provider: string) => void;
  credentials: ProviderCredentials;
  onCredentialsChange: (credentials: ProviderCredentials) => void;
  availableModels: ModelOption[];
  modelsLoading: boolean;
  modelsError: string | null;
  onRefreshModels: () => void;
  ollamaTestStatus: "idle" | "ok" | "error";
  onTestOllama: () => void;
}
```

- [ ] **Step 3: Destructure new props in component**

Replace the function signature destructuring:

```typescript
export default function ModelProviderTab({
  activeProvider,
  onActiveProviderChange,
  defaultCloudProvider,
  onDefaultCloudProviderChange,
  credentials,
  onCredentialsChange,
  availableModels,
  modelsLoading,
  modelsError,
  onRefreshModels,
  ollamaTestStatus,
  onTestOllama,
}: ModelProviderTabProps) {
```

- [ ] **Step 4: Replace OpenRouter model TextField with Autocomplete**

In the `activeProvider === "openrouter"` block, replace the model `TextField` with:

```tsx
          <Autocomplete
            options={availableModels}
            getOptionLabel={(o) => (typeof o === "string" ? o : o.name)}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            value={
              availableModels.find((m) => m.id === credentials.openrouter.defaultModel) ?? {
                id: credentials.openrouter.defaultModel,
                name: credentials.openrouter.defaultModel,
              }
            }
            onChange={(_, v) =>
              onCredentialsChange({
                ...credentials,
                openrouter: {
                  ...credentials.openrouter,
                  defaultModel: v && typeof v !== "string" ? v.id : credentials.openrouter.defaultModel,
                },
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Model"
                margin="normal"
                helperText={modelsError ?? "Select a model from the list"}
                error={!!modelsError}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {modelsLoading ? <CircularProgress color="inherit" size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            fullWidth
            disableClearable
          />
```

- [ ] **Step 5: Replace OpenAI model TextField with Autocomplete**

In the `activeProvider === "openai"` block, replace the model `TextField` with:

```tsx
          <Autocomplete
            options={availableModels}
            getOptionLabel={(o) => (typeof o === "string" ? o : o.name)}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            value={
              availableModels.find((m) => m.id === credentials.openai.defaultModel) ?? {
                id: credentials.openai.defaultModel,
                name: credentials.openai.defaultModel,
              }
            }
            onChange={(_, v) =>
              onCredentialsChange({
                ...credentials,
                openai: {
                  ...credentials.openai,
                  defaultModel: v && typeof v !== "string" ? v.id : credentials.openai.defaultModel,
                },
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Model"
                margin="normal"
                helperText={
                  modelsError ??
                  (credentials.openai.apiKey
                    ? "Select a model from the list"
                    : "Enter API key to list models")
                }
                error={!!modelsError}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {modelsLoading ? <CircularProgress color="inherit" size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            fullWidth
            disableClearable
          />
```

- [ ] **Step 6: Replace Ollama model TextField with Autocomplete + refresh button**

In the `activeProvider === "ollama"` block, replace the model `TextField` with:

```tsx
          <Autocomplete
            options={availableModels}
            getOptionLabel={(o) => (typeof o === "string" ? o : o.name)}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            value={
              availableModels.find((m) => m.id === credentials.ollama.defaultModel) ?? {
                id: credentials.ollama.defaultModel,
                name: credentials.ollama.defaultModel,
              }
            }
            onChange={(_, v) =>
              onCredentialsChange({
                ...credentials,
                ollama: {
                  ...credentials.ollama,
                  defaultModel: v && typeof v !== "string" ? v.id : credentials.ollama.defaultModel,
                },
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Model"
                margin="normal"
                helperText={
                  modelsError ??
                  (availableModels.length === 0 && !modelsLoading
                    ? "No models found. Run `ollama pull <model>` in terminal."
                    : "Select a model from the list")
                }
                error={!!modelsError}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {modelsLoading ? <CircularProgress color="inherit" size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            fullWidth
            disableClearable
          />
          <Button variant="outlined" onClick={onRefreshModels} sx={{ mt: 1, mr: 1 }}>
            Refresh models
          </Button>
          <Button variant="outlined" onClick={onTestOllama} sx={{ mt: 1 }}>
            Test connection
          </Button>
```

Remove the old "Test connection" button that was previously after the model TextField.

- [ ] **Step 7: Run typecheck + check**

Run: `bun run typecheck && bun run check`
Expected: zero errors, clean

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/settings/ModelProviderTab.tsx
git commit -m "feat: replace model TextField with Autocomplete in ModelProviderTab"
```

---

### Task 6: Update `SettingsModal` to Orchestrate Model Fetches

**Files:**
- Modify: `src/renderer/components/settings/SettingsModal.tsx`

- [ ] **Step 1: Add state for model fetching**

After `ollamaTestStatus` state, add:

```typescript
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
```

- [ ] **Step 2: Add `fetchModels` helper**

Before `handleSave`, add:

```typescript
  const fetchModels = useCallback(
    async (provider: string, host?: string, apiKey?: string) => {
      if (provider !== "ollama" && provider !== "openrouter" && provider !== "openai") {
        setAvailableModels([]);
        setModelsError(null);
        return;
      }
      if (provider === "openai" && !apiKey) {
        setAvailableModels([]);
        setModelsError(null);
        return;
      }
      setModelsLoading(true);
      setModelsError(null);
      try {
        const result = await window.electronAPI.invoke(IPC.GET_PROVIDER_MODELS, {
          provider,
          host,
          apiKey,
        });
        setAvailableModels(result.models);
        if (result.error) {
          setModelsError(result.error);
        }
      } catch {
        setModelsError("Failed to fetch models");
        setAvailableModels([]);
      } finally {
        setModelsLoading(false);
      }
    },
    [],
  );
```

- [ ] **Step 3: Fetch models on settings load and provider change**

Replace the existing `useEffect` that loads settings:

```typescript
  useEffect(() => {
    if (!open) return;
    window.electronAPI.invoke(IPC.GET_SETTINGS).then((settings) => {
      setActiveProvider(settings.activeProvider ?? "openrouter");
      setDefaultCloudProvider(settings.defaultCloudProvider ?? "openrouter");
      setCredentials({
        openrouter: {
          apiKey: settings.providerCredentials.openrouter.apiKey ?? "",
          defaultModel:
            settings.providerCredentials.openrouter.defaultModel ?? "anthropic/claude-sonnet-4-6",
        },
        openai: {
          apiKey: settings.providerCredentials.openai.apiKey ?? "",
          defaultModel: settings.providerCredentials.openai.defaultModel ?? "gpt-4o",
        },
        anthropic: {
          apiKey: settings.providerCredentials.anthropic.apiKey ?? "",
          defaultModel:
            settings.providerCredentials.anthropic.defaultModel ?? "claude-3-5-sonnet-20241022",
        },
        ollama: {
          host: settings.providerCredentials.ollama.host ?? "http://localhost:11434",
          defaultModel: settings.providerCredentials.ollama.defaultModel ?? "llama3.2:3b",
        },
      });
      setLangfuseEnabled(settings.langfuseEnabled ?? false);
      setWebAccessEnabled(settings.webAccessEnabled ?? true);

      const provider = settings.activeProvider ?? "openrouter";
      void fetchModels(
        provider,
        settings.providerCredentials.ollama.host,
        provider === "openai"
          ? settings.providerCredentials.openai.apiKey ?? undefined
          : provider === "openrouter"
            ? settings.providerCredentials.openrouter.apiKey ?? undefined
            : undefined,
      );
    });
  }, [open, fetchModels]);
```

- [ ] **Step 4: Fetch models when provider changes**

Add a new effect after the load effect:

```typescript
  useEffect(() => {
    if (!open) return;
    const apiKey =
      activeProvider === "openai"
        ? credentials.openai.apiKey || undefined
        : activeProvider === "openrouter"
          ? credentials.openrouter.apiKey || undefined
          : undefined;
    void fetchModels(activeProvider, credentials.ollama.host, apiKey);
  }, [open, activeProvider, fetchModels]);
```

- [ ] **Step 5: Wire new props to `ModelProviderTab`**

Replace the `tab === 1` block:

```tsx
        {tab === 1 && (
          <ModelProviderTab
            activeProvider={activeProvider}
            onActiveProviderChange={setActiveProvider}
            defaultCloudProvider={defaultCloudProvider}
            onDefaultCloudProviderChange={setDefaultCloudProvider}
            credentials={credentials}
            onCredentialsChange={setCredentials}
            availableModels={availableModels}
            modelsLoading={modelsLoading}
            modelsError={modelsError}
            onRefreshModels={() => {
              const apiKey =
                activeProvider === "openai"
                  ? credentials.openai.apiKey || undefined
                  : activeProvider === "openrouter"
                    ? credentials.openrouter.apiKey || undefined
                    : undefined;
              void fetchModels(activeProvider, credentials.ollama.host, apiKey);
            }}
            ollamaTestStatus={ollamaTestStatus}
            onTestOllama={testOllama}
          />
        )}
```

- [ ] **Step 6: Run typecheck + check + tests**

Run:
```bash
bun run typecheck && bun run check && bun test
```
Expected: zero type errors, clean lint, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/settings/SettingsModal.tsx
git commit -m "feat: orchestrate model discovery in SettingsModal"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Full typecheck**

Run: `bun run typecheck`
Expected: zero errors

- [ ] **Step 2: Full lint + format check**

Run: `bun run check`
Expected: clean

- [ ] **Step 3: Full test suite**

Run: `bun test`
Expected: all pass

- [ ] **Step 4: Start dev server and verify UI**

Run: `bun run dev`
Open settings → Model Provider tab.
Select OpenRouter: model dropdown should populate (may take a moment).
Select OpenAI without API key: should show "Enter API key to list models".
Select Ollama with default host: should show refresh button, test connection still works.

- [ ] **Step 5: Commit any auto-fixes**

```bash
git add -A && git commit -m "fix: any auto-fixes from verification" || true
```

---

## Self-Review

**Spec coverage:**
- `GET_PROVIDER_MODELS` IPC channel → Task 1
- Request/response types → Task 1
- Validation schema → Task 2
- `model-discovery.ts` with Ollama/OpenRouter/OpenAI functions → Task 3
- Unit tests for discovery → Task 3
- IPC handler wiring → Task 4
- `Autocomplete` in `ModelProviderTab` → Task 5
- `SettingsModal` fetch orchestration → Task 6
- Loading/error/empty states → Task 5 (in component) + Task 6 (in modal)
- OpenAI "Enter API key to list models" helper text → Task 5
- Ollama "No models found" helper text → Task 5
- `MODEL_FALLBACK` preserved untouched → no changes made

**Placeholder scan:** No TBD, TODO, or vague requirements found. Every step has exact code.

**Type consistency:**
- `ModelOption` interface in `ModelProviderTab.tsx` matches `DiscoveredModel` in `model-discovery.ts` (both `{ id: string; name: string }`).
- `GetProviderModelsRequest` in `ipc-types.ts` matches schema in `ipc-validation.ts`.
- IPC channel string `GET_PROVIDER_MODELS` consistent across channels, types, handler, renderer.

**No gaps found.**
