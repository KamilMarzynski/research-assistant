import { Box, Button, FormControlLabel, Switch, Typography } from "@mui/material";
import type { SkillInfo } from "../../../shared/ipc-channels";

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
    <Box sx={{ pt: 2 }}>
      {loading && (
        <Typography variant="body2" color="text.secondary">
          Loading skills...
        </Typography>
      )}
      {error && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <Typography variant="body2" color="error">
            {error}
          </Typography>
          <Button size="small" onClick={onRetry} variant="outlined">
            Retry
          </Button>
        </Box>
      )}
      {!loading && !error && skills.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
          No skills installed. Skills are created when an agent proposes a new tool.
        </Typography>
      )}
      {skills.map((skill) => (
        <Box key={skill.name}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              py: 1,
              borderBottom: "1px solid",
              borderColor: "divider",
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {skill.name}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {skill.description}
              </Typography>
            </Box>
            <FormControlLabel
              control={
                <Switch
                  checked={skill.enabled}
                  onChange={(e) => onToggleSkill(skill.name, e.target.checked)}
                  size="small"
                />
              }
              label={skill.enabled ? "On" : "Off"}
              labelPlacement="end"
              sx={{ mr: 0 }}
            />
            <Button size="small" variant="text" onClick={() => onToggleExpand(skill.name)}>
              {expandedSkill === skill.name ? "Hide" : "View"}
            </Button>
            <Button
              size="small"
              color="error"
              variant="text"
              onClick={() => onDeleteRequest(skill.name)}
            >
              Delete
            </Button>
          </Box>
          {expandedSkill === skill.name && (
            <Box
              component="pre"
              sx={{
                p: 2,
                bgcolor: "grey.900",
                color: "grey.100",
                borderRadius: 1,
                overflow: "auto",
                fontSize: 12,
                maxHeight: 300,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {skill.content}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}
