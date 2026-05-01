import { Box, Divider } from "@mui/material";
import { useState } from "react";
import type { Artifact } from "../../../shared/types";
import ArtifactSection from "./ArtifactSection";
import ArtifactViewer from "./ArtifactViewer";

export default function DetailsPanel() {
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);

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
      <ArtifactSection onSelectArtifact={setSelectedArtifact} />

      {selectedArtifact && (
        <>
          <Divider />
          <ArtifactViewer artifact={selectedArtifact} onBack={() => setSelectedArtifact(null)} />
        </>
      )}

      {/* Future sections: Skills, Project Info, etc. */}
    </Box>
  );
}
