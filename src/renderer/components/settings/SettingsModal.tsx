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
import { useCallback, useEffect, useState } from "react";
import type { SkillInfo } from "../../../shared/ipc-channels";
import { IPC } from "../../../shared/ipc-channels";
import { glassSx } from "../../styles/glass";

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
  const [activeProvider, setActiveProvider] = useState<string>("openrouter");
  const [defaultCloudProvider, setDefaultCloudProvider] = useState<string>("openrouter");
  const [credentials, setCredentials] = useState({
    openrouter: { apiKey: "", defaultModel: "anthropic/claude-sonnet-4-6" },
    openai: { apiKey: "", defaultModel: "gpt-4o" },
    anthropic: { apiKey: "", defaultModel: "claude-3-5-sonnet-20241022" },
    ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
  });
  const [ollamaTestStatus, setOllamaTestStatus] = useState<"idle" | "ok" | "error">("idle");
  const [langfuseEnabled, setLangfuseEnabled] = useState(false);
  const [webAccessEnabled, setWebAccessEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [auditFilter, setAuditFilter] = useState<"all" | "executed" | "blocked">("all");
  const [confirmClear, setConfirmClear] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [confirmDeleteSkill, setConfirmDeleteSkill] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    window.electronAPI.invoke(IPC.GET_SETTINGS).then((s) => {
      const settings = s as {
        activeProvider: string;
        defaultCloudProvider: string;
        providerCredentials: {
          openrouter: { apiKey: string | null; defaultModel: string };
          openai: { apiKey: string | null; defaultModel: string };
          anthropic: { apiKey: string | null; defaultModel: string };
          ollama: { host: string; defaultModel: string };
        };
        langfuseEnabled: boolean;
        webAccessEnabled: boolean;
      };
      setActiveProvider(settings.activeProvider ?? "openrouter");
      setDefaultCloudProvider(settings.defaultCloudProvider ?? "openrouter");
      setCredentials({
        openrouter: {
          apiKey: settings.providerCredentials?.openrouter?.apiKey ?? "",
          defaultModel:
            settings.providerCredentials?.openrouter?.defaultModel ?? "anthropic/claude-sonnet-4-6",
        },
        openai: {
          apiKey: settings.providerCredentials?.openai?.apiKey ?? "",
          defaultModel: settings.providerCredentials?.openai?.defaultModel ?? "gpt-4o",
        },
        anthropic: {
          apiKey: settings.providerCredentials?.anthropic?.apiKey ?? "",
          defaultModel:
            settings.providerCredentials?.anthropic?.defaultModel ?? "claude-3-5-sonnet-20241022",
        },
        ollama: {
          host: settings.providerCredentials?.ollama?.host ?? "http://localhost:11434",
          defaultModel: settings.providerCredentials?.ollama?.defaultModel ?? "llama3.2:3b",
        },
      });
      setLangfuseEnabled(settings.langfuseEnabled ?? false);
      setWebAccessEnabled(settings.webAccessEnabled ?? true);
    });
  }, [open]);

  const loadAuditLog = async () => {
    const entries = (await window.electronAPI.invoke(IPC.GET_AUDIT_LOG)) as AuditLogEntry[];
    setAuditEntries(entries);
  };

  const fetchSkills = useCallback(async () => {
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const result = await window.electronAPI.invoke(IPC.GET_SKILLS);
      setSkills(result as SkillInfo[]);
    } catch {
      setSkillsError("Failed to load skills");
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && tab === 2) {
      void window.electronAPI.invoke(IPC.GET_AUDIT_LOG).then((entries) => {
        setAuditEntries(entries as AuditLogEntry[]);
      });
    }
  }, [open, tab]);

  useEffect(() => {
    if (open && tab === 3) {
      void fetchSkills();
    }
  }, [open, tab, fetchSkills]);

  const handleSave = async () => {
    setSaving(true);
    await window.electronAPI.invoke(IPC.SAVE_SETTINGS, {
      activeProvider,
      defaultCloudProvider,
      providerCredentials: {
        openrouter: {
          apiKey: credentials.openrouter.apiKey.trim() || null,
          defaultModel: credentials.openrouter.defaultModel,
        },
        openai: {
          apiKey: credentials.openai.apiKey.trim() || null,
          defaultModel: credentials.openai.defaultModel,
        },
        anthropic: {
          apiKey: credentials.anthropic.apiKey.trim() || null,
          defaultModel: credentials.anthropic.defaultModel,
        },
        ollama: {
          host: credentials.ollama.host,
          defaultModel: credentials.ollama.defaultModel,
        },
      },
      langfuseEnabled,
      webAccessEnabled,
    });
    setSaving(false);
    onClose();
  };

  const testOllama = async () => {
    setOllamaTestStatus("idle");
    const host = credentials.ollama.host;
    const result = await window.electronAPI.invoke(IPC.CHECK_OLLAMA, host);
    setOllamaTestStatus((result as { available: boolean }).available ? "ok" : "error");
  };

  const handleClearAuditLog = async () => {
    await window.electronAPI.invoke(IPC.CLEAR_AUDIT_LOG);
    setAuditEntries([]);
    setConfirmClear(false);
  };

  const handleToggleSkill = async (name: string, enabled: boolean) => {
    await window.electronAPI.invoke(IPC.TOGGLE_SKILL, { name, enabled });
    setSkills((prev) => prev.map((s) => (s.name === name ? { ...s, enabled } : s)));
  };

  const handleDeleteSkill = async (name: string) => {
    await window.electronAPI.invoke(IPC.DELETE_SKILL, { name });
    setSkills((prev) => prev.filter((s) => s.name !== name));
    setConfirmDeleteSkill(null);
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
        <Tab label="Model Provider" />
        <Tab label="Audit Log" />
        <Tab label="Skills" />
      </Tabs>
      <DialogContent>
        {tab === 0 && (
          <Box sx={{ pt: 2 }}>
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
            <FormControlLabel
              control={
                <Switch
                  checked={webAccessEnabled}
                  onChange={(e) => setWebAccessEnabled(e.target.checked)}
                />
              }
              label="Enable web access for agents (fetch_url, web_search)"
              sx={{ mt: 1 }}
            />
          </Box>
        )}

        {tab === 1 && (
          <Box sx={{ pt: 2 }}>
            <FormControl fullWidth margin="normal">
              <InputLabel>Active Provider</InputLabel>
              <Select
                value={activeProvider}
                onChange={(e) => setActiveProvider(e.target.value)}
                label="Active Provider"
              >
                <MenuItem value="openrouter">OpenRouter</MenuItem>
                <MenuItem value="ollama">Ollama</MenuItem>
                <MenuItem value="openai">OpenAI</MenuItem>
                <MenuItem value="anthropic" disabled>
                  Anthropic (not supported — use OpenRouter instead)
                </MenuItem>
              </Select>
            </FormControl>

            {activeProvider === "anthropic" && (
              <Chip
                label="Direct Anthropic not supported — use OpenRouter"
                color="error"
                sx={{ mt: 1 }}
              />
            )}

            {activeProvider === "openrouter" && (
              <>
                <TextField
                  label="OpenRouter API Key"
                  type="password"
                  fullWidth
                  margin="normal"
                  value={credentials.openrouter.apiKey}
                  onChange={(e) =>
                    setCredentials((prev) => ({
                      ...prev,
                      openrouter: { ...prev.openrouter, apiKey: e.target.value },
                    }))
                  }
                  placeholder="sk-or-..."
                  helperText="Get your key at openrouter.ai/keys"
                />
                <TextField
                  label="Model"
                  fullWidth
                  margin="normal"
                  value={credentials.openrouter.defaultModel}
                  onChange={(e) =>
                    setCredentials((prev) => ({
                      ...prev,
                      openrouter: { ...prev.openrouter, defaultModel: e.target.value },
                    }))
                  }
                  helperText="e.g. anthropic/claude-sonnet-4-6"
                />
              </>
            )}

            {activeProvider === "openai" && (
              <>
                <TextField
                  label="OpenAI API Key"
                  type="password"
                  fullWidth
                  margin="normal"
                  value={credentials.openai.apiKey}
                  onChange={(e) =>
                    setCredentials((prev) => ({
                      ...prev,
                      openai: { ...prev.openai, apiKey: e.target.value },
                    }))
                  }
                />
                <TextField
                  label="Model"
                  fullWidth
                  margin="normal"
                  value={credentials.openai.defaultModel}
                  onChange={(e) =>
                    setCredentials((prev) => ({
                      ...prev,
                      openai: { ...prev.openai, defaultModel: e.target.value },
                    }))
                  }
                  helperText="e.g. gpt-4o"
                />
              </>
            )}

            {activeProvider === "ollama" && (
              <>
                <TextField
                  label="Host"
                  fullWidth
                  margin="normal"
                  value={credentials.ollama.host}
                  onChange={(e) =>
                    setCredentials((prev) => ({
                      ...prev,
                      ollama: { ...prev.ollama, host: e.target.value },
                    }))
                  }
                  helperText="e.g. http://localhost:11434"
                />
                <TextField
                  label="Model"
                  fullWidth
                  margin="normal"
                  value={credentials.ollama.defaultModel}
                  onChange={(e) =>
                    setCredentials((prev) => ({
                      ...prev,
                      ollama: { ...prev.ollama, defaultModel: e.target.value },
                    }))
                  }
                  helperText="e.g. llama3.2:3b"
                />
                <Button variant="outlined" onClick={testOllama} sx={{ mt: 1 }}>
                  Test connection
                </Button>
                {ollamaTestStatus === "ok" && (
                  <Typography component="span" color="success.main" sx={{ ml: 1 }}>
                    Connected
                  </Typography>
                )}
                {ollamaTestStatus === "error" && (
                  <Typography component="span" color="error.main" sx={{ ml: 1 }}>
                    Not reachable
                  </Typography>
                )}

                <FormControl fullWidth margin="normal" sx={{ mt: 2 }}>
                  <InputLabel>Fallback provider</InputLabel>
                  <Select
                    value={defaultCloudProvider}
                    onChange={(e) => setDefaultCloudProvider(e.target.value)}
                    label="Fallback provider"
                  >
                    <MenuItem value="openrouter">OpenRouter</MenuItem>
                    <MenuItem value="openai">OpenAI</MenuItem>
                  </Select>
                </FormControl>
              </>
            )}
          </Box>
        )}

        {tab === 2 && (
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

        {tab === 3 && (
          <Box sx={{ pt: 2 }}>
            {skillsLoading && (
              <Typography variant="body2" color="text.secondary">
                Loading skills...
              </Typography>
            )}
            {skillsError && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
                <Typography variant="body2" color="error">
                  {skillsError}
                </Typography>
                <Button size="small" onClick={fetchSkills} variant="outlined">
                  Retry
                </Button>
              </Box>
            )}
            {!skillsLoading && !skillsError && skills.length === 0 && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ py: 4, textAlign: "center" }}
              >
                No skills installed. Skills are created when an agent proposes a new tool.
              </Typography>
            )}
            {skills.map((skill) => (
              <Box key={skill.name}>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    py: 1,
                    borderBottom: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {skill.name}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {skill.description}
                    </Typography>
                  </Box>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={skill.enabled}
                        onChange={(e) => handleToggleSkill(skill.name, e.target.checked)}
                        size="small"
                      />
                    }
                    label={skill.enabled ? "On" : "Off"}
                    labelPlacement="end"
                    sx={{ mr: 0 }}
                  />
                  <Button
                    size="small"
                    variant="text"
                    onClick={() =>
                      setExpandedSkill(expandedSkill === skill.name ? null : skill.name)
                    }
                  >
                    {expandedSkill === skill.name ? "Hide" : "View"}
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    variant="text"
                    onClick={() => setConfirmDeleteSkill(skill.name)}
                  >
                    Delete
                  </Button>
                </Box>
                {expandedSkill === skill.name && (
                  <Box
                    component="pre"
                    sx={{
                      p: 2,
                      bgcolor: "grey.900",
                      color: "grey.100",
                      borderRadius: 1,
                      overflow: "auto",
                      fontSize: 12,
                      maxHeight: 300,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {skill.content}
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      {(tab === 0 || tab === 1 || tab === 3) && (
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

      <Dialog open={confirmDeleteSkill !== null} onClose={() => setConfirmDeleteSkill(null)}>
        <DialogTitle>Delete Skill?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently delete the skill <strong>{confirmDeleteSkill}</strong>. This
            action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDeleteSkill(null)}>Cancel</Button>
          <Button
            onClick={() => confirmDeleteSkill && handleDeleteSkill(confirmDeleteSkill)}
            color="error"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
