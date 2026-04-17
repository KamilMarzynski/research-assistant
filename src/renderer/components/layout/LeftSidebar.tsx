import { Box, Typography } from "@mui/material";

export default function LeftSidebar() {
  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "action.hover",
      }}
    >
      <Typography variant="body2" color="text.secondary">
        Left Sidebar
      </Typography>
    </Box>
  );
}
