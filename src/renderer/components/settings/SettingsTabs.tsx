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
  layout?: "horizontal" | "vertical";
}

export default function SettingsTabs({
  active,
  onChange,
  layout = "horizontal",
}: SettingsTabsProps) {
  const isVertical = layout === "vertical";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isVertical ? "column" : "row",
        gap: isVertical ? 2 : 4,
        padding: isVertical ? "8px" : "14px 22px 0",
        borderBottom: isVertical ? undefined : "1px solid var(--line)",
        flex: isVertical ? 1 : undefined,
        overflow: isVertical ? "auto" : undefined,
      }}
    >
      {tabs.map((t, i) => {
        const Icon = t.icon;
        const isActive = i === active;
        const btnStyle: React.CSSProperties = {
          padding: isVertical ? "7px 10px" : "10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          fontWeight: isActive ? 500 : 400,
          color: isActive ? "var(--accent)" : "var(--ink-2)",
          cursor: "pointer",
          background: isActive ? "var(--accent-soft)" : undefined,
          border: "none",
          borderRadius: isVertical ? 8 : 0,
          marginBottom: isVertical ? 0 : -1,
          width: isVertical ? "100%" : undefined,
          textAlign: "left",
        };
        if (!isVertical) {
          btnStyle.borderBottom = `2px solid ${isActive ? "var(--accent)" : "transparent"}`;
        }
        return (
          <button
            key={t.label}
            type="button"
            className="nav-row"
            onClick={() => onChange(i)}
            style={btnStyle}
          >
            <Icon size={13} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
