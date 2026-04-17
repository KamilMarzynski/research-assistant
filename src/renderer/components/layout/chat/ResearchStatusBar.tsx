import { Box, Typography } from "@mui/material";

export default function ResearchStatusBar() {
  return (
    <Box
      sx={{
        px: 2,
        py: 1,
        borderBottom: 1,
        borderColor: "divider",
        display: "flex",
        alignItems: "center",
        minHeight: 40,
      }}
    >
      <Typography variant="caption" color="text.secondary">
        Research Status Bar
      </Typography>
    </Box>
  );
}
