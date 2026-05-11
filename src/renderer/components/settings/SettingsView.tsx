import { Dialog } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import { useAuditLog } from "../../hooks/useAuditLog";
import { useProviderSettings } from "../../hooks/useProviderSettings";
import { useSkillManager } from "../../hooks/useSkillManager";
import { useTheme } from "../../theme/ThemeContext";
import WindowDragBar from "../layout/WindowDragBar";
import { IconArrowL } from "../shared/Icons";
import AuditTab from "./AuditTab";
import GeneralTab from "./GeneralTab";
import ModelProviderTab from "./ModelProviderTab";
import SettingsTabs from "./SettingsTabs";
import SkillsTab from "./SkillsTab";

const paperSx = {
  background: "var(--surface)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-lg)",
  boxShadow: "var(--shadow-3)",
} as const;

interface SettingsViewProps {
  onBack: () => void;
}

export default function SettingsView({ onBack }: SettingsViewProps) {
  const [tab, setTab] = useState(0);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteSkill, setConfirmDeleteSkill] = useState<string | null>(null);

  const [langfuseEnabled, setLangfuseEnabled] = useState(false);
  const [webAccessEnabled, setWebAccessEnabled] = useState(true);
  const [themeSetting, setThemeSetting] = useState<"light" | "dark" | "system">("system");

  const { setTheme } = useTheme();
  const provider = useProviderSettings(true);
  const audit = useAuditLog(tab === 2);
  const skills = useSkillManager(tab === 3);

  useEffect(() => {
    void provider.loadFromSettings().then(() => {
      window.electronAPI.invoke(IPC.GET_SETTINGS).then((settings) => {
        setLangfuseEnabled(settings.langfuseEnabled ?? false);
        setWebAccessEnabled(settings.webAccessEnabled ?? true);
        setThemeSetting(settings.theme ?? "system");
      });
    });
  }, [provider.loadFromSettings]);

  const handleSave = async () => {
    setSaving(true);
    await window.electronAPI.invoke(IPC.SAVE_SETTINGS, {
      activeProvider: provider.activeProvider,
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
      theme: themeSetting,
    });
    setSaving(false);
    onBack();
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

  const showFooter = tab === 0 || tab === 1 || tab === 3;

  return (
    <div style={{ display: "flex", flexDirection: "row", height: "100vh", overflow: "hidden" }}>
      <aside
        style={{
          width: 248,
          flexShrink: 0,
          height: "100%",
          background: "var(--surface)",
          borderRight: "1px solid var(--line)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <WindowDragBar />
        <div
          style={{
            padding: "12px 16px 14px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <button
            type="button"
            className="btn btn--ghost btn--icon no-drag"
            aria-label="Back"
            onClick={onBack}
          >
            <IconArrowL size={16} />
          </button>
          <span style={{ fontWeight: 600, fontSize: 14, letterSpacing: "-0.005em" }}>Settings</span>
        </div>

        <SettingsTabs active={tab} onChange={setTab} layout="vertical" />
      </aside>

      <div
        style={{
          flex: 1,
          overflow: "hidden",
          height: "100%",
          background: "var(--bg)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <WindowDragBar />
        <div className="thin-scroll" style={{ flex: 1, overflow: "auto", padding: "22px 26px" }}>
          {tab === 0 && (
            <GeneralTab
              langfuseEnabled={langfuseEnabled}
              onLangfuseChange={setLangfuseEnabled}
              webAccessEnabled={webAccessEnabled}
              onWebAccessChange={setWebAccessEnabled}
              theme={themeSetting}
              onThemeChange={(t) => {
                setThemeSetting(t);
                setTheme(t);
              }}
            />
          )}

          {tab === 1 && (
            <ModelProviderTab
              activeProvider={provider.activeProvider}
              onActiveProviderChange={provider.setActiveProvider}
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
        </div>

        {showFooter && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              padding: "14px 22px",
              borderTop: "1px solid var(--line)",
              background: "var(--surface)",
            }}
          >
            <button type="button" className="btn btn--ghost" onClick={onBack}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        )}
      </div>

      <Dialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        slotProps={{ paper: { sx: paperSx } }}
      >
        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>Clear Audit Log?</div>
          <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 13.5 }}>
            This will permanently delete all audit log entries. This action cannot be undone.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button type="button" className="btn btn--ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn--danger" onClick={handleClearAuditLog}>
              Clear
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={confirmDeleteSkill !== null}
        onClose={() => setConfirmDeleteSkill(null)}
        slotProps={{ paper: { sx: paperSx } }}
      >
        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>Delete Skill?</div>
          <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 13.5 }}>
            This will permanently delete the skill <strong>{confirmDeleteSkill}</strong>. This
            action cannot be undone.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setConfirmDeleteSkill(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => confirmDeleteSkill && handleDeleteSkill(confirmDeleteSkill)}
            >
              Delete
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
