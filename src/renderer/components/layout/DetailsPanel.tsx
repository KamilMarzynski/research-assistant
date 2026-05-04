import { Box } from "@mui/material";
import { useProject } from "../../contexts/ProjectContext";
import ArtifactSection from "./ArtifactSection";

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
      {activeProjectId ? <ArtifactSection projectId={activeProjectId} /> : null}
    </Box>
  );
}
