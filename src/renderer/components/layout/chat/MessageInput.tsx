import SendIcon from "@mui/icons-material/Send";
import { Box, IconButton, MenuItem, Select, TextField } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";

interface ModelInfo {
  id: string;
  name: string;
}

interface MessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export default function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [content, setContent] = useState("");
  const [model, setModel] = useState("anthropic/claude-sonnet-4-6");
  const [activeProvider, setActiveProvider] = useState<string>("openrouter");
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    window.electronAPI.invoke(IPC.GET_SETTINGS).then((settings) => {
      const provider = settings.activeProvider ?? "openrouter";
      const currentModel = settings.providerCredentials[provider]?.defaultModel ?? "";
      setActiveProvider(provider);
      setModel(currentModel);

      const apiKey =
        provider === "openai"
          ? (settings.providerCredentials.openai?.apiKey ?? undefined)
          : provider === "openrouter"
            ? (settings.providerCredentials.openrouter?.apiKey ?? undefined)
            : undefined;
      const host = provider === "ollama" ? settings.providerCredentials.ollama?.host : undefined;

      setModelsLoading(true);
      window.electronAPI
        .invoke(IPC.GET_PROVIDER_MODELS, { provider, apiKey, host })
        .then((result: { models?: ModelInfo[] }) => {
          if (result.models && result.models.length > 0) {
            setAvailableModels(result.models);
          }
        })
        .catch(() => {
          // Fall back to empty list — Select still shows current model
        })
        .finally(() => setModelsLoading(false));
    });
  }, []);

  const handleModelChange = async (newModel: string) => {
    setModel(newModel);
    await window.electronAPI.invoke(IPC.SAVE_SETTINGS, {
      providerCredentials: {
        [activeProvider]: { defaultModel: newModel },
      },
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
    <Box
      sx={{
        p: 1.5,
        display: "flex",
        gap: 1,
        alignItems: "flex-end",
        bgcolor: "background.paper",
      }}
    >
      <Select
        size="small"
        value={model}
        disabled={modelsLoading || disabled}
        onChange={(e) => handleModelChange(e.target.value)}
        sx={{ minWidth: 130, flexShrink: 0 }}
      >
        {modelOptions.map((m) => (
          <MenuItem key={m.id} value={m.id}>
            {m.name}
          </MenuItem>
        ))}
      </Select>

      <TextField
        multiline
        maxRows={6}
        fullWidth
        size="small"
        placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        disabled={disabled}
        slotProps={{ htmlInput: { "data-testid": "message-input" } }}
      />

      <IconButton
        onClick={handleSend}
        disabled={!content.trim() || disabled}
        color="primary"
        size="small"
        data-testid="send-btn"
      >
        <SendIcon />
      </IconButton>
    </Box>
  );
}
