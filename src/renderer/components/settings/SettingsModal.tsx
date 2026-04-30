import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import { glassSx } from "../../styles/glass";

const MODELS = [
  { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
];

interface AuditLogEntry {
  ts: string;
  projectId: string;
  intent: string;
  command: string;
  exitCode: number | null;
  blocked?: boolean;
  blockReason?: string;
  blockKey?: string;
  blockCategory?: string;
}

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const statusColors: Record<string, string> = {
  blocked: "#f44336",
  executed: "#4caf50",
};

function getStatus(entry: AuditLogEntry): string {
  if (entry.blocked) return "blocked";
  return "executed";
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("anthropic/claude-sonnet-4-6");
  const [langfuseEnabled, setLangfuseEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [auditFilter, setAuditFilter] = useState<"all" | "executed" | "blocked">("all");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!open) return;
    window.electronAPI.invoke(IPC.GET_SETTINGS).then((s) => {
      const settings = s as {
        openrouterApiKey: string | null;
        model: string;
        langfuseEnabled: boolean;
      };
      setApiKey(settings.openrouterApiKey ?? "");
      setModel(settings.model);
      setLangfuseEnabled(settings.langfuseEnabled ?? false);
    });
  }, [open]);

  const loadAuditLog = async () => {
    const entries = (await window.electronAPI.invoke(IPC.GET_AUDIT_LOG)) as AuditLogEntry[];
    setAuditEntries(entries);
  };

  useEffect(() => {
    if (open && tab === 1) {
      void window.electronAPI.invoke(IPC.GET_AUDIT_LOG).then((entries) => {
        setAuditEntries(entries as AuditLogEntry[]);
      });
    }
  }, [open, tab]);

  const handleSave = async () => {
    setSaving(true);
    await window.electronAPI.invoke(IPC.SAVE_SETTINGS, {
      openrouterApiKey: apiKey.trim() || null,
      model,
      langfuseEnabled,
    });
    setSaving(false);
    onClose();
  };

  const handleClearAuditLog = async () => {
    await window.electronAPI.invoke(IPC.CLEAR_AUDIT_LOG);
    setAuditEntries([]);
    setConfirmClear(false);
  };

  const filtered =
    auditFilter === "all" ? auditEntries : auditEntries.filter((e) => getStatus(e) === auditFilter);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: { sx: glassSx } }}
    >
      <DialogTitle>Settings</DialogTitle>
      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab label="General" />
        <Tab label="Audit Log" />
      </Tabs>
      <DialogContent>
        {tab === 0 && (
          <Box sx={{ pt: 2 }}>
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
            <FormControlLabel
              control={
                <Switch
                  checked={langfuseEnabled}
                  onChange={(e) => setLangfuseEnabled(e.target.checked)}
                />
              }
              label="LangFuse tracing"
              sx={{ mt: 1 }}
            />
          </Box>
        )}
        {tab === 1 && (
          <Box sx={{ pt: 2 }}>
            <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
              {(["all", "executed", "blocked"] as const).map((f) => (
                <Chip
                  key={f}
                  label={f}
                  onClick={() => setAuditFilter(f)}
                  variant={auditFilter === f ? "filled" : "outlined"}
                  color={auditFilter === f ? "primary" : "default"}
                />
              ))}
              <Box sx={{ flex: 1 }} />
              <Button size="small" onClick={loadAuditLog} variant="outlined">
                Refresh
              </Button>
              <Button
                size="small"
                onClick={() => setConfirmClear(true)}
                color="error"
                variant="outlined"
              >
                Clear Log
              </Button>
            </Box>

            <Box
              sx={{
                fontFamily: "monospace",
                fontSize: 11,
                bgcolor: "grey.900",
                color: "grey.100",
                borderRadius: 1,
                p: 2,
                maxHeight: 400,
                overflow: "auto",
              }}
            >
              {filtered.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No audit log entries.
                </Typography>
              ) : (
                filtered.map((entry, i) => {
                  const status = getStatus(entry);
                  const entryKey = `${entry.ts}-${entry.command}-${i}`;
                  return (
                    <Box
                      key={entryKey}
                      sx={{
                        display: "flex",
                        gap: 1.5,
                        borderBottom: "1px solid #333",
                        py: 0.75,
                        alignItems: "baseline",
                      }}
                    >
                      <span style={{ color: "#888", minWidth: 160 }}>
                        {new Date(entry.ts).toLocaleString()}
                      </span>
                      <Chip
                        label={status}
                        size="small"
                        sx={{
                          bgcolor: statusColors[status] ?? "grey.500",
                          color: "#fff",
                          fontSize: 10,
                          height: 18,
                        }}
                      />
                      <span
                        style={{
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {entry.command}
                      </span>
                      <span style={{ color: "#888" }}>
                        {entry.blockReason ?? `exit: ${entry.exitCode}`}
                      </span>
                    </Box>
                  );
                })
              )}
            </Box>
          </Box>
        )}
      </DialogContent>
      {tab === 0 && (
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} variant="contained">
            Save
          </Button>
        </DialogActions>
      )}

      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)}>
        <DialogTitle>Clear Audit Log?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently delete all audit log entries. This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClear(false)}>Cancel</Button>
          <Button onClick={handleClearAuditLog} color="error">
            Clear
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
