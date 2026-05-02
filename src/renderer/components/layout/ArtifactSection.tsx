import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import type { Artifact } from "../../../shared/types";
import { useProject } from "../../contexts/ProjectContext";

interface ArtifactSectionProps {
  onSelectArtifact: (artifact: Artifact) => void;
}

export default function ArtifactSection({ onSelectArtifact }: ArtifactSectionProps) {
  const { activeProjectId } = useProject();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);

  useEffect(() => {
    if (!activeProjectId) {
      setArtifacts([]);
      return;
    }
    window.electronAPI
      .invoke(IPC.GET_ARTIFACTS, { projectId: activeProjectId })
      .then((list) => setArtifacts(list));
  }, [activeProjectId]);

  return (
    <Accordion defaultExpanded disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Artifacts
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        {artifacts.length === 0 ? (
          <Box sx={{ px: 2, py: 3, textAlign: "center" }}>
            <DescriptionOutlinedIcon sx={{ fontSize: 32, color: "text.disabled", mb: 1 }} />
            <Typography variant="body2" color="text.secondary">
              No artifacts yet
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding>
            {artifacts.map((a) => (
              <ListItemButton key={a.id} onClick={() => onSelectArtifact(a)} sx={{ px: 2 }}>
                <ListItemText
                  primary={a.title}
                  secondary={new Date(a.createdAt).toLocaleDateString()}
                  slotProps={{
                    primary: { variant: "body2", noWrap: true },
                    secondary: { variant: "caption" },
                  }}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
