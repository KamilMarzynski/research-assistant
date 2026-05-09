import type { SkillInfo } from "../../../shared/ipc-channels";
import { IconBolt, IconTrash } from "../../components/shared/Icons";

interface SkillsTabProps {
  skills: SkillInfo[];
  loading: boolean;
  error: string | null;
  expandedSkill: string | null;
  onToggleExpand: (name: string) => void;
  onToggleSkill: (name: string, enabled: boolean) => void;
  onDeleteRequest: (name: string) => void;
  onRetry: () => void;
}

export default function SkillsTab({
  skills,
  loading,
  error,
  expandedSkill,
  onToggleExpand,
  onToggleSkill,
  onDeleteRequest,
  onRetry,
}: SkillsTabProps) {
  return (
    <div style={{ paddingTop: 8 }}>
      <span className="eyebrow">Skills</span>
      <h2 style={{ margin: "4px 0 8px", fontSize: 18, fontWeight: 600 }}>Installed skills</h2>
      <p className="t-tertiary" style={{ margin: "0 0 16px", fontSize: 12.5, maxWidth: 560 }}>
        Tools and capabilities your agent can use. Built-in skills ship with the app; custom ones
        are created by the agent.
      </p>

      {loading && (
        <p className="t-tertiary" style={{ fontSize: 12.5 }}>
          Loading skills...
        </p>
      )}

      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
          }}
        >
          <p className="t-tertiary" style={{ fontSize: 12.5, margin: 0 }}>
            {error}
          </p>
          <button type="button" onClick={onRetry} className="btn btn--outline btn--sm">
            Retry
          </button>
        </div>
      )}

      {!loading && !error && skills.length === 0 && (
        <p
          className="t-tertiary"
          style={{
            padding: "32px 0",
            textAlign: "center",
            fontSize: 12.5,
            margin: 0,
          }}
        >
          No skills installed. Skills are created when an agent proposes a new tool.
        </p>
      )}

      {!loading && !error && skills.length > 0 && (
        <div className="card" style={{ overflow: "hidden" }}>
          {skills.map((skill) => (
            <div key={skill.name}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "var(--r-sm)",
                    background: "var(--surface-2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <IconBolt size={16} />
                </div>

                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{skill.name}</span>
                  <span
                    className="t-tertiary"
                    style={{
                      fontSize: 12,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      lineHeight: 1.4,
                    }}
                  >
                    {skill.description}
                  </span>
                </div>

                <span className={`chip ${skill.protected ? "chip--info" : "chip--accent"}`}>
                  {skill.protected ? "built-in" : "custom"}
                </span>

                <Toggle on={skill.enabled} onChange={(v) => onToggleSkill(skill.name, v)} />

                <button
                  type="button"
                  onClick={() => onToggleExpand(skill.name)}
                  className="btn btn--ghost btn--sm"
                >
                  {expandedSkill === skill.name ? "Hide" : "View"}
                </button>

                {!skill.protected && (
                  <button
                    type="button"
                    onClick={() => onDeleteRequest(skill.name)}
                    className="btn btn--ghost btn--icon"
                    aria-label="Delete skill"
                    title="Delete skill"
                  >
                    <IconTrash size={14} />
                  </button>
                )}
              </div>

              {expandedSkill === skill.name && (
                <pre
                  className="thin-scroll"
                  style={{
                    margin: 0,
                    padding: 12,
                    background: "var(--surface-2)",
                    borderRadius: "var(--r-sm)",
                    maxHeight: 300,
                    overflow: "auto",
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    color: "var(--ink)",
                    fontFamily:
                      'var(--font-mono), "JetBrains Mono", ui-monospace, Menlo, monospace',
                    lineHeight: 1.5,
                  }}
                >
                  {skill.content}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
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
