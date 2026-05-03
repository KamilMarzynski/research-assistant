import { Box } from "@mui/material";
import { useProject } from "../../contexts/ProjectContext";
import RecentOutputsPanel from "./RecentOutputsPanel";

export default function DetailsPanel() {
  const { activeProjectId } = useProject();

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
        overflow: "auto",
      }}
    >
      <RecentOutputsPanel projectId={activeProjectId ?? ""} />
    </Box>
  );
}
