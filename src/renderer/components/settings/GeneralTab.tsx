interface GeneralTabProps {
  langfuseEnabled: boolean;
  onLangfuseChange: (enabled: boolean) => void;
  webAccessEnabled: boolean;
  onWebAccessChange: (enabled: boolean) => void;
  theme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
}

export default function GeneralTab({
  langfuseEnabled,
  onLangfuseChange,
  webAccessEnabled,
  onWebAccessChange,
  theme,
  onThemeChange,
}: GeneralTabProps) {
  return (
    <div style={{ paddingTop: 8 }}>
      <span className="eyebrow">Behavior</span>
      <h2 style={{ margin: "4px 0 8px", fontSize: 18, fontWeight: 600 }}>General</h2>
      <p style={{ margin: "0 0 16px", color: "var(--ink-2)", fontSize: 12.5, maxWidth: 560 }}>
        Defaults that apply to every project.
      </p>

      <Row
        title="LangFuse tracing"
        sub="Send agent runs and tool calls to your LangFuse instance."
        control={<Toggle on={langfuseEnabled} onChange={onLangfuseChange} />}
      />
      <Row
        title="Web access for agents"
        sub="Enables fetch_url and web_search tools."
        control={<Toggle on={webAccessEnabled} onChange={onWebAccessChange} />}
      />
      <Row
        title="Theme"
        sub="The app follows your system theme; you can pin one if you prefer."
        control={
          <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--surface-2)", borderRadius: 8 }}>
            {(["system", "light", "dark"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onThemeChange(t)}
                style={{
                  padding: "5px 10px",
                  fontSize: 12,
                  borderRadius: 6,
                  background: theme === t ? "var(--surface)" : "transparent",
                  fontWeight: theme === t ? 600 : 500,
                  boxShadow: theme === t ? "var(--shadow-1)" : "none",
                  cursor: "pointer",
                  textTransform: "capitalize",
                  border: "none",
                  color: "var(--ink)",
                }}
              >
                {t}
              </button>
            ))}
          </div>
        }
      />
    </div>
  );
}

function Row({ title, sub, control }: { title: string; sub: string; control: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 0",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 480 }}>
        <span style={{ fontSize: 13.5, fontWeight: 500 }}>{title}</span>
        <span style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>{sub}</span>
      </div>
      {control}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 999,
        background: on ? "var(--accent)" : "var(--surface-3)",
        border: "1px solid var(--line)",
        position: "relative",
        flexShrink: 0,
        cursor: "pointer",
        transition: "background 120ms ease",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 1,
          left: on ? 17 : 1,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "white",
          boxShadow: "var(--shadow-1)",
          transition: "left 120ms ease",
        }}
      />
    </button>
  );
}
