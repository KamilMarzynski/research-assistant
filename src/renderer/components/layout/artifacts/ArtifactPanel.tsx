import { Box, Typography } from "@mui/material";

export default function ArtifactPanel() {
  return (
    <Box
      sx={{
        height: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
      }}
    >
      <Typography variant="body2" color="text.secondary">
        Artifact Panel
      </Typography>
    </Box>
  );
}
