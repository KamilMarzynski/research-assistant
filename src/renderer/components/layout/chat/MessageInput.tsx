import { MenuItem, Select } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import { IconChevD, IconCpu, IconSend } from "../../shared/Icons";

interface ModelInfo {
  id: string;
  name: string;
}

interface MessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  projectId: string;
  projectModelOverride: string | null;
}

export default function MessageInput({
  onSend,
  disabled,
  projectId,
  projectModelOverride,
}: MessageInputProps) {
  const [content, setContent] = useState("");
  const [model, setModel] = useState<string>("");
  const [activeProvider, setActiveProvider] = useState<string>("openrouter");
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const lastProjectId = useRef<string>("");

  // Reset model state only when switching to a different project
  useEffect(() => {
    if (lastProjectId.current === projectId) return;
    lastProjectId.current = projectId;

    const load = async () => {
      let provider: string;
      let modelId: string;

      if (projectModelOverride) {
        const parts = projectModelOverride.split(":");
        provider = parts[0] ?? "";
        modelId = parts.slice(1).join(":") ?? "";
      } else {
        // Fallback to global settings for projects created before per-project models
        const settings = await window.electronAPI.invoke(IPC.GET_SETTINGS);
        provider = settings.activeProvider ?? "openrouter";
        modelId =
          settings.providerCredentials[provider as keyof typeof settings.providerCredentials]
            ?.defaultModel ?? "";
      }

      if (!provider || !modelId) return;

      setActiveProvider(provider);
      setModel(modelId);

      // Fetch available models for the project's provider
      setModelsLoading(true);
      const settings = await window.electronAPI.invoke(IPC.GET_SETTINGS);
      const apiKey =
        provider === "openai"
          ? (settings.providerCredentials.openai?.apiKey ?? undefined)
          : provider === "openrouter"
            ? (settings.providerCredentials.openrouter?.apiKey ?? undefined)
            : undefined;
      const host = provider === "ollama" ? settings.providerCredentials.ollama?.host : undefined;

      window.electronAPI
        .invoke(IPC.GET_PROVIDER_MODELS, { provider, apiKey, host })
        .then((result: { models?: ModelInfo[] }) => {
          if (result.models && result.models.length > 0) {
            setAvailableModels(result.models);
          } else {
            setAvailableModels([{ id: modelId, name: modelId }]);
          }
        })
        .catch(() => {
          setAvailableModels([{ id: modelId, name: modelId }]);
        })
        .finally(() => setModelsLoading(false));
    };

    load();
  }, [projectId, projectModelOverride]);

  const handleModelChange = async (newModel: string) => {
    setModel(newModel);
    await window.electronAPI.invoke(IPC.SET_PROJECT_MODEL, {
      projectId,
      modelOverride: `${activeProvider}:${newModel}`,
    });
  };

  const handleSend = () => {
    const trimmed = content.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setContent("");
  };

  const modelOptions = availableModels.length > 0 ? availableModels : [{ id: model, name: model }];

  return (
    <div
      style={{
        padding: "12px 24px 18px",
        background: "var(--bg)",
        borderTop: "1px solid var(--line)",
      }}
    >
      <div style={{ maxWidth: 768, width: "100%", margin: "0 auto" }}>
        <div
          className="card"
          style={{
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            borderColor: "var(--line-strong)",
            boxShadow: "var(--shadow-1)",
          }}
        >
          <textarea
            className="input"
            rows={2}
            placeholder="Ask, or hand off to background research..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={disabled}
            data-testid="message-input"
            style={{
              resize: "none",
              border: "none",
              padding: "4px 6px",
              background: "transparent",
              fontSize: 13.5,
              lineHeight: 1.5,
              width: "100%",
              maxHeight: "9em",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Select
                size="small"
                value={model}
                disabled={modelsLoading || disabled || !model}
                onChange={(e) => handleModelChange(e.target.value)}
                IconComponent={() => null}
                renderValue={() => (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: "var(--text-sm)",
                      color: "var(--ink)",
                    }}
                  >
                    <IconCpu size={13} />
                    <span>{modelOptions.find((m) => m.id === model)?.name ?? model}</span>
                    <IconChevD size={12} />
                  </span>
                )}
                sx={{
                  minWidth: 130,
                  flexShrink: 0,
                  fontSize: "var(--text-sm)",
                  color: "var(--ink)",
                  "& .MuiSelect-select": {
                    py: 0.5,
                    px: 1,
                    fontSize: "var(--text-sm)",
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    color: "var(--ink)",
                  },
                  "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--line-strong)" },
                  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "var(--accent)" },
                  "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                    borderColor: "var(--accent)",
                  },
                }}
                MenuProps={{
                  anchorOrigin: { vertical: "top", horizontal: "left" },
                  transformOrigin: { vertical: "bottom", horizontal: "left" },
                  slotProps: {
                    paper: {
                      sx: {
                        background: "var(--surface)",
                        border: "1px solid var(--line)",
                        borderRadius: "var(--r-md)",
                        boxShadow: "var(--shadow-2)",
                        color: "var(--ink)",
                        mb: 0.5,
                      },
                    },
                  },
                }}
              >
                {modelOptions.map((m) => (
                  <MenuItem
                    key={m.id}
                    value={m.id}
                    sx={{
                      fontSize: "var(--text-sm)",
                      color: "var(--ink)",
                      background: "transparent",
                      "&:hover": { background: "var(--surface-2)" },
                      "&.Mui-selected": {
                        background: "var(--accent-soft)",
                        color: "oklch(0.42 0.12 45)",
                      },
                      "&.Mui-selected:hover": { background: "var(--accent-soft)" },
                    }}
                  >
                    {m.name}
                  </MenuItem>
                ))}
              </Select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="t-tertiary t-mono" style={{ fontSize: 10 }}>
                Return send · Shift+Return newline
              </span>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={handleSend}
                disabled={!content.trim() || disabled}
                data-testid="send-btn"
              >
                <IconSend size={13} /> Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
