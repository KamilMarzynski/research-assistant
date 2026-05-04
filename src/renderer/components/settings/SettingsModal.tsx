import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Tab,
  Tabs,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import type { AuditLogEntry, SkillInfo } from "../../../shared/ipc-channels";
import { IPC } from "../../../shared/ipc-channels";
import { glassSx } from "../../styles/glass";
import AuditTab from "./AuditTab";
import GeneralTab from "./GeneralTab";
import ModelProviderTab, { type ProviderCredentials } from "./ModelProviderTab";
import SkillsTab from "./SkillsTab";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState(0);
  const [activeProvider, setActiveProvider] = useState<string>("openrouter");
  const [defaultCloudProvider, setDefaultCloudProvider] = useState<string>("openrouter");
  const [credentials, setCredentials] = useState<ProviderCredentials>({
    openrouter: { apiKey: "", defaultModel: "anthropic/claude-sonnet-4-6" },
    openai: { apiKey: "", defaultModel: "gpt-4o" },
    anthropic: { apiKey: "", defaultModel: "claude-3-5-sonnet-20241022" },
    ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
  });
  const [ollamaTestStatus, setOllamaTestStatus] = useState<"idle" | "ok" | "error">("idle");
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
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

  const fetchModels = useCallback(async (provider: string, host?: string, apiKey?: string) => {
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
  }, []);

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
          ? (settings.providerCredentials.openai.apiKey ?? undefined)
          : provider === "openrouter"
            ? (settings.providerCredentials.openrouter.apiKey ?? undefined)
            : undefined,
      );
    });
  }, [open, fetchModels]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-fetch when provider changes, not on every keystroke in credential fields
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

  const loadAuditLog = useCallback(async () => {
    const entries = await window.electronAPI.invoke(IPC.GET_AUDIT_LOG);
    setAuditEntries(entries);
  }, []);

  const fetchSkills = useCallback(async () => {
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const result = await window.electronAPI.invoke(IPC.GET_SKILLS);
      setSkills(result);
    } catch {
      setSkillsError("Failed to load skills");
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && tab === 2) {
      void loadAuditLog();
    }
  }, [open, tab, loadAuditLog]);

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
    setOllamaTestStatus(result.available ? "ok" : "error");
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
          <GeneralTab
            langfuseEnabled={langfuseEnabled}
            onLangfuseChange={setLangfuseEnabled}
            webAccessEnabled={webAccessEnabled}
            onWebAccessChange={setWebAccessEnabled}
          />
        )}

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

        {tab === 2 && (
          <AuditTab
            entries={auditEntries}
            filter={auditFilter}
            onFilterChange={setAuditFilter}
            onRefresh={loadAuditLog}
            onRequestClear={() => setConfirmClear(true)}
          />
        )}

        {tab === 3 && (
          <SkillsTab
            skills={skills}
            loading={skillsLoading}
            error={skillsError}
            expandedSkill={expandedSkill}
            onToggleExpand={(name) => setExpandedSkill(expandedSkill === name ? null : name)}
            onToggleSkill={handleToggleSkill}
            onDeleteRequest={setConfirmDeleteSkill}
            onRetry={fetchSkills}
          />
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
