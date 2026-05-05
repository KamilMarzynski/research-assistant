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
import { IPC } from "../../../shared/ipc-channels";
import { useAuditLog } from "../../hooks/useAuditLog";
import { useProviderSettings } from "../../hooks/useProviderSettings";
import { useSkillManager } from "../../hooks/useSkillManager";
import { glassSx } from "../../styles/glass";
import AuditTab from "./AuditTab";
import GeneralTab from "./GeneralTab";
import ModelProviderTab from "./ModelProviderTab";
import SkillsTab from "./SkillsTab";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState(0);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteSkill, setConfirmDeleteSkill] = useState<string | null>(null);

  const [langfuseEnabled, setLangfuseEnabled] = useState(false);
  const [webAccessEnabled, setWebAccessEnabled] = useState(true);

  const provider = useProviderSettings(open);
  const audit = useAuditLog(open && tab === 2);
  const skills = useSkillManager(open && tab === 3);

  useEffect(() => {
    if (!open) return;
    void provider.loadFromSettings().then(() => {
      window.electronAPI.invoke(IPC.GET_SETTINGS).then((settings) => {
        setLangfuseEnabled(settings.langfuseEnabled ?? false);
        setWebAccessEnabled(settings.webAccessEnabled ?? true);
      });
    });
  }, [open, provider]);

  const handleSave = async () => {
    setSaving(true);
    await window.electronAPI.invoke(IPC.SAVE_SETTINGS, {
      activeProvider: provider.activeProvider,
      defaultCloudProvider: provider.defaultCloudProvider,
      providerCredentials: {
        openrouter: {
          apiKey: provider.credentials.openrouter.apiKey.trim() || null,
          defaultModel: provider.credentials.openrouter.defaultModel,
        },
        openai: {
          apiKey: provider.credentials.openai.apiKey.trim() || null,
          defaultModel: provider.credentials.openai.defaultModel,
        },
        anthropic: {
          apiKey: provider.credentials.anthropic.apiKey.trim() || null,
          defaultModel: provider.credentials.anthropic.defaultModel,
        },
        ollama: {
          host: provider.credentials.ollama.host,
          defaultModel: provider.credentials.ollama.defaultModel,
        },
      },
      langfuseEnabled,
      webAccessEnabled,
    });
    setSaving(false);
    onClose();
  };

  const handleClearAuditLog = useCallback(async () => {
    await audit.clear();
    setConfirmClear(false);
  }, [audit]);

  const handleDeleteSkill = useCallback(
    async (name: string) => {
      await skills.deleteSkill(name);
      setConfirmDeleteSkill(null);
    },
    [skills],
  );

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
            activeProvider={provider.activeProvider}
            onActiveProviderChange={provider.setActiveProvider}
            defaultCloudProvider={provider.defaultCloudProvider}
            onDefaultCloudProviderChange={provider.setDefaultCloudProvider}
            credentials={provider.credentials}
            onCredentialsChange={provider.setCredentials}
            availableModels={provider.availableModels}
            modelsLoading={provider.modelsLoading}
            modelsError={provider.modelsError}
            onRefreshModels={() => {
              const apiKey =
                provider.activeProvider === "openai"
                  ? provider.credentials.openai.apiKey || undefined
                  : provider.activeProvider === "openrouter"
                    ? provider.credentials.openrouter.apiKey || undefined
                    : undefined;
              void provider.fetchModels(
                provider.activeProvider,
                provider.credentials.ollama.host,
                apiKey,
              );
            }}
            ollamaTestStatus={provider.ollamaTestStatus}
            onTestOllama={provider.testOllama}
          />
        )}

        {tab === 2 && (
          <AuditTab
            entries={audit.entries}
            filter={audit.filter}
            onFilterChange={audit.setFilter}
            onRefresh={audit.load}
            onRequestClear={() => setConfirmClear(true)}
          />
        )}

        {tab === 3 && (
          <SkillsTab
            skills={skills.skills}
            loading={skills.loading}
            error={skills.error}
            expandedSkill={skills.expandedSkill}
            onToggleExpand={(name) =>
              skills.setExpandedSkill(skills.expandedSkill === name ? null : name)
            }
            onToggleSkill={skills.toggle}
            onDeleteRequest={setConfirmDeleteSkill}
            onRetry={skills.load}
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
