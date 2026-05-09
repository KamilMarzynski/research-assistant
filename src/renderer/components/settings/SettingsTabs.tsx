import { IconBolt, IconCpu, IconSettings, IconShield } from "../shared/Icons";

const tabs = [
  { label: "General", icon: IconSettings },
  { label: "Model provider", icon: IconCpu },
  { label: "Audit log", icon: IconShield },
  { label: "Skills", icon: IconBolt },
];

interface SettingsTabsProps {
  active: number;
  onChange: (idx: number) => void;
}

export default function SettingsTabs({ active, onChange }: SettingsTabsProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: "14px 22px 0",
        borderBottom: "1px solid var(--line)",
      }}
    >
      {tabs.map((t, i) => {
        const Icon = t.icon;
        const isActive = i === active;
        return (
          <button
            key={t.label}
            type="button"
            onClick={() => onChange(i)}
            style={{
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? "var(--ink)" : "var(--ink-2)",
              cursor: "pointer",
              background: "transparent",
              border: "none",
              borderRadius: 0,
              borderBottom: `2px solid ${isActive ? "var(--accent)" : "transparent"}`,
              marginBottom: -1,
            }}
          >
            <Icon size={13} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
