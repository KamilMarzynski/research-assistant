import SendIcon from "@mui/icons-material/Send";
import { Box, IconButton, MenuItem, Select, TextField } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";

const MODELS = [
  { id: "anthropic/claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "anthropic/claude-opus-4-6", label: "Opus 4.6" },
  { id: "anthropic/claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
];

interface MessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export default function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [content, setContent] = useState("");
  const [model, setModel] = useState("anthropic/claude-sonnet-4-6");
  const [activeProvider, setActiveProvider] = useState<string>("openrouter");

  useEffect(() => {
    window.electronAPI.invoke(IPC.GET_SETTINGS).then((settings) => {
      setActiveProvider(settings.activeProvider);
      setModel(settings.providerCredentials[settings.activeProvider].defaultModel);
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
        onChange={(e) => handleModelChange(e.target.value)}
        sx={{ minWidth: 130, flexShrink: 0 }}
      >
        {MODELS.map((m) => (
          <MenuItem key={m.id} value={m.id}>
            {m.label}
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
