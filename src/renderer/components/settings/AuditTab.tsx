import { Box, Button, Chip, Typography } from "@mui/material";
import type { AuditLogEntry } from "../../../shared/ipc-channels";

const statusColors: Record<string, string> = {
  blocked: "#f44336",
  executed: "#4caf50",
};

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
    <Box sx={{ pt: 2 }}>
      <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
        {(["all", "executed", "blocked"] as const).map((f) => (
          <Chip
            key={f}
            label={f}
            onClick={() => onFilterChange(f)}
            variant={filter === f ? "filled" : "outlined"}
            color={filter === f ? "primary" : "default"}
          />
        ))}
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={onRefresh} variant="outlined">
          Refresh
        </Button>
        <Button size="small" onClick={onRequestClear} color="error" variant="outlined">
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
  );
}
