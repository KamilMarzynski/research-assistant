import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";

const MODELS = [
  { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
];

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("anthropic/claude-sonnet-4-6");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    window.electronAPI.invoke(IPC.GET_SETTINGS).then((s) => {
      const settings = s as { openrouterApiKey: string | null; model: string };
      setApiKey(settings.openrouterApiKey ?? "");
      setModel(settings.model);
    });
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    await window.electronAPI.invoke(IPC.SAVE_SETTINGS, {
      openrouterApiKey: apiKey.trim() || null,
      model,
    });
    setSaving(false);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Settings</DialogTitle>
      <DialogContent>
        <TextField
          label="OpenRouter API Key"
          type="password"
          fullWidth
          margin="normal"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-or-..."
          helperText="Get your key at openrouter.ai/keys"
        />
        <FormControl fullWidth margin="normal">
          <InputLabel>Model</InputLabel>
          <Select value={model} onChange={(e) => setModel(e.target.value)} label="Model">
            {MODELS.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving} variant="contained">
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
