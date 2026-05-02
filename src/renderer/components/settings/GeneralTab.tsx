import { Box, FormControlLabel, Switch } from "@mui/material";

interface GeneralTabProps {
  langfuseEnabled: boolean;
  onLangfuseChange: (enabled: boolean) => void;
  webAccessEnabled: boolean;
  onWebAccessChange: (enabled: boolean) => void;
}

export default function GeneralTab({
  langfuseEnabled,
  onLangfuseChange,
  webAccessEnabled,
  onWebAccessChange,
}: GeneralTabProps) {
  return (
    <Box sx={{ pt: 2 }}>
      <FormControlLabel
        control={
          <Switch checked={langfuseEnabled} onChange={(e) => onLangfuseChange(e.target.checked)} />
        }
        label="LangFuse tracing"
        sx={{ mt: 1 }}
      />
      <FormControlLabel
        control={
          <Switch
            checked={webAccessEnabled}
            onChange={(e) => onWebAccessChange(e.target.checked)}
          />
        }
        label="Enable web access for agents (fetch_url, web_search)"
        sx={{ mt: 1 }}
      />
    </Box>
  );
}
