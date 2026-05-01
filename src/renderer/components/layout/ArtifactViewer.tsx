import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Box, CircularProgress, IconButton, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import type { Artifact } from "../../../shared/types";
import MarkdownRenderer from "../shared/MarkdownRenderer";

interface ArtifactViewerProps {
  artifact: Artifact;
  onBack: () => void;
}

export default function ArtifactViewer({ artifact, onBack }: ArtifactViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContent(null);
    setError(null);

    window.electronAPI
      .invoke(IPC.READ_ARTIFACT_FILE, { filePath: artifact.filePath })
      .then((text) => setContent(text as string))
      .catch((err) => setError((err as Error).message ?? "Failed to read file"));
  }, [artifact]);

  return (
    <Box sx={{ px: 2, py: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 1.5, gap: 0.5 }}>
        <IconButton size="small" onClick={onBack} aria-label="Back to artifacts">
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Typography variant="subtitle2" noWrap sx={{ flex: 1 }}>
          {artifact.title}
        </Typography>
      </Box>

      {error ? (
        <Typography variant="body2" color="error">
          File not found
        </Typography>
      ) : content === null ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress size={24} />
        </Box>
      ) : (
        <MarkdownRenderer content={content} />
      )}
    </Box>
  );
}
