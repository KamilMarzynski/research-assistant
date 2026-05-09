import { IconEdit } from "../shared/Icons";

export default function MemoryStrip() {
  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <span className="eyebrow">Project memory</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          style={{ padding: "2px 6px", fontSize: 11 }}
        >
          <IconEdit size={11} />
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {[
          "Output folder: research/",
          "Prefer Markdown w/ inline citations",
          "Tone: terse, data-first",
        ].map((t) => (
          <div
            key={t}
            style={{
              fontSize: 12,
              color: "var(--ink-2)",
              display: "flex",
              gap: 6,
              alignItems: "flex-start",
            }}
          >
            <span style={{ color: "var(--accent)", marginTop: 4 }}>—</span>
            <span style={{ flex: 1 }}>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
