import {
  IconCheck,
  IconOllama,
  IconOpenAI,
  IconOpenRouter,
  IconRefresh,
  IconX,
} from "../../components/shared/Icons";
import ModelSelect from "./ModelSelect";

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
  credentials: ProviderCredentials;
  onCredentialsChange: (credentials: ProviderCredentials) => void;
  availableModels: ModelOption[];
  modelsLoading: boolean;
  modelsError: string | null;
  onRefreshModels: () => void;
  ollamaTestStatus: "idle" | "ok" | "error";
  onTestOllama: () => void;
}

const PROVIDERS: Array<{
  id: string;
  name: string;
  icon: React.ComponentType<{ size?: number }>;
}> = [
  { id: "openrouter", name: "OpenRouter", icon: IconOpenRouter },
  { id: "ollama", name: "Ollama", icon: IconOllama },
  { id: "openai", name: "OpenAI", icon: IconOpenAI },
];

export default function ModelProviderTab({
  activeProvider,
  onActiveProviderChange,
  credentials,
  onCredentialsChange,
  availableModels,
  modelsLoading,
  modelsError,
  onRefreshModels,
  ollamaTestStatus,
  onTestOllama,
}: ModelProviderTabProps) {
  return (
    <div style={{ paddingTop: 16 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        Active Provider
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {PROVIDERS.map((provider) => {
          const isActive = activeProvider === provider.id;
          const Icon = provider.icon;
          return (
            <label
              key={provider.id}
              style={{
                position: "relative",
                border: `1px solid ${isActive ? "var(--accent)" : "var(--line)"}`,
                background: isActive ? "var(--accent-soft)" : "var(--surface)",
                borderRadius: "var(--r-md)",
                padding: "12px 16px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 10,
                transition: "border-color 120ms ease, background 120ms ease",
              }}
            >
              <input
                type="radio"
                name="active-provider"
                value={provider.id}
                checked={isActive}
                onChange={() => {
                  onActiveProviderChange(provider.id);
                }}
                style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
              />
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  border: `2px solid ${isActive ? "var(--accent)" : "var(--line-strong)"}`,
                  background: isActive ? "var(--accent)" : "transparent",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {isActive && (
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "var(--ink-on-accent)",
                    }}
                  />
                )}
              </div>
              <div style={{ fontWeight: 500, fontSize: "var(--text-sm)" }}>{provider.name}</div>
              <div style={{ marginLeft: "auto", flexShrink: 0, color: "var(--ink-3)" }}>
                <Icon size={14} />
              </div>
            </label>
          );
        })}
      </div>

      {activeProvider === "openrouter" && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label
              htmlFor="openrouter-api-key"
              className="eyebrow"
              style={{ display: "block", marginBottom: 6 }}
            >
              OpenRouter API Key
            </label>
            <input
              id="openrouter-api-key"
              className="input"
              type="password"
              value={credentials.openrouter.apiKey}
              onChange={(e) =>
                onCredentialsChange({
                  ...credentials,
                  openrouter: { ...credentials.openrouter, apiKey: e.target.value },
                })
              }
              placeholder="sk-or-..."
            />
            <span
              className="t-tertiary"
              style={{ fontSize: "var(--text-xs)", marginTop: 4, display: "block" }}
            >
              Get your key at openrouter.ai/keys
            </span>
          </div>
          <ModelSelect
            value={credentials.openrouter.defaultModel}
            options={availableModels}
            onChange={(id) =>
              onCredentialsChange({
                ...credentials,
                openrouter: { ...credentials.openrouter, defaultModel: id },
              })
            }
            modelsLoading={modelsLoading}
            modelsError={modelsError}
            helperText="Select a model from the list"
          />
        </div>
      )}

      {activeProvider === "openai" && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label
              htmlFor="openai-api-key"
              className="eyebrow"
              style={{ display: "block", marginBottom: 6 }}
            >
              OpenAI API Key
            </label>
            <input
              id="openai-api-key"
              className="input"
              type="password"
              value={credentials.openai.apiKey}
              onChange={(e) =>
                onCredentialsChange({
                  ...credentials,
                  openai: { ...credentials.openai, apiKey: e.target.value },
                })
              }
            />
          </div>
          <ModelSelect
            value={credentials.openai.defaultModel}
            options={availableModels}
            onChange={(id) =>
              onCredentialsChange({
                ...credentials,
                openai: { ...credentials.openai, defaultModel: id },
              })
            }
            modelsLoading={modelsLoading}
            modelsError={modelsError}
            helperText={
              credentials.openai.apiKey
                ? "Select a model from the list"
                : "Enter API key to list models"
            }
          />
        </div>
      )}

      {activeProvider === "ollama" && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label
              htmlFor="ollama-host"
              className="eyebrow"
              style={{ display: "block", marginBottom: 6 }}
            >
              Host
            </label>
            <input
              id="ollama-host"
              className="input"
              type="text"
              value={credentials.ollama.host}
              onChange={(e) =>
                onCredentialsChange({
                  ...credentials,
                  ollama: { ...credentials.ollama, host: e.target.value },
                })
              }
              placeholder="e.g. http://localhost:11434"
            />
            <span
              className="t-tertiary"
              style={{ fontSize: "var(--text-xs)", marginTop: 4, display: "block" }}
            >
              e.g. http://localhost:11434
            </span>
          </div>
          <ModelSelect
            value={credentials.ollama.defaultModel}
            options={availableModels}
            onChange={(id) =>
              onCredentialsChange({
                ...credentials,
                ollama: { ...credentials.ollama, defaultModel: id },
              })
            }
            modelsLoading={modelsLoading}
            modelsError={modelsError}
            helperText={
              availableModels.length === 0 && !modelsLoading
                ? "No models found. Run `ollama pull <model>` in terminal."
                : "Select a model from the list"
            }
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn--outline btn--sm" onClick={onRefreshModels}>
              <IconRefresh size={13} /> Refresh models
            </button>
            <button type="button" className="btn btn--outline btn--sm" onClick={onTestOllama}>
              Test connection
            </button>
            {ollamaTestStatus === "ok" && (
              <span className="chip chip--success">
                <IconCheck size={12} /> Connected
              </span>
            )}
            {ollamaTestStatus === "error" && (
              <span className="chip chip--danger">
                <IconX size={12} /> Not reachable
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
