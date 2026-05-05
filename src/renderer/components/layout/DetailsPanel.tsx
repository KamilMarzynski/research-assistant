import { Box } from "@mui/material";
import { useProject } from "../../contexts/ProjectContext";
import FileExplorer from "./FileExplorer";

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
      {activeProjectId ? <FileExplorer projectId={activeProjectId} /> : null}
    </Box>
  );
}
