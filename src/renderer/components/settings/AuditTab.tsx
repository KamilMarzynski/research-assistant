import type { AuditLogEntry } from "../../../shared/ipc-channels";

function getStatus(entry: AuditLogEntry): string {
  if (entry.blocked) return "blocked";
  return "executed";
}

interface AuditTabProps {
  entries: AuditLogEntry[];
  filter: "all" | "executed" | "blocked";
  onFilterChange: (filter: "all" | "executed" | "blocked") => void;
  onRefresh: () => void;
  onRequestClear: () => void;
}

export default function AuditTab({
  entries,
  filter,
  onFilterChange,
  onRefresh,
  onRequestClear,
}: AuditTabProps) {
  const filtered = filter === "all" ? entries : entries.filter((e) => getStatus(e) === filter);

  return (
    <div style={{ paddingTop: 16 }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 16,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: 3,
            background: "var(--surface-2)",
            borderRadius: 8,
          }}
        >
          {(["all", "executed", "blocked"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onFilterChange(f)}
              style={{
                padding: "5px 10px",
                fontSize: 12,
                borderRadius: 6,
                background: filter === f ? "var(--surface)" : "transparent",
                fontWeight: filter === f ? 600 : 500,
                boxShadow: filter === f ? "var(--shadow-1)" : "none",
                cursor: "pointer",
                textTransform: "capitalize",
                border: "none",
                color: "var(--ink)",
              }}
            >
              {f}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onRefresh} className="btn btn--outline btn--sm">
          Refresh
        </button>
        <button
          type="button"
          onClick={onRequestClear}
          className="btn btn--ghost btn--sm"
          style={{ color: "var(--danger)" }}
        >
          Clear Log
        </button>
      </div>

      <div
        className="thin-scroll"
        style={{
          maxHeight: 400,
          overflow: "auto",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-md)",
          background: "var(--surface)",
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: "var(--ink-3)",
              fontSize: 14,
            }}
          >
            No audit log entries.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)" }}>
                <th
                  style={{
                    padding: "8px 12px",
                    textAlign: "left",
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    fontWeight: 600,
                    color: "var(--ink-3)",
                  }}
                >
                  Time
                </th>
                <th
                  style={{
                    padding: "8px 12px",
                    textAlign: "left",
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    fontWeight: 600,
                    color: "var(--ink-3)",
                  }}
                >
                  Status
                </th>
                <th
                  style={{
                    padding: "8px 12px",
                    textAlign: "left",
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    fontWeight: 600,
                    color: "var(--ink-3)",
                  }}
                >
                  Command
                </th>
                <th
                  style={{
                    padding: "8px 12px",
                    textAlign: "left",
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    fontWeight: 600,
                    color: "var(--ink-3)",
                  }}
                >
                  Result
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, i) => {
                const status = getStatus(entry);
                const entryKey = `${entry.ts}-${entry.command}-${i}`;
                return (
                  <tr key={entryKey} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td
                      className="t-mono"
                      style={{ padding: "8px 12px", minWidth: 160, whiteSpace: "nowrap" }}
                    >
                      {new Date(entry.ts).toLocaleString()}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <span
                        className={`chip chip--${status === "executed" ? "success" : "danger"}`}
                      >
                        {status}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px", maxWidth: 0, width: "100%" }}>
                      <span
                        className="t-mono"
                        style={{
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {entry.command}
                      </span>
                    </td>
                    <td
                      className="t-mono"
                      style={{ padding: "8px 12px", whiteSpace: "nowrap", color: "var(--ink-2)" }}
                    >
                      {entry.blockReason ?? `exit: ${entry.exitCode}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
