import { Box, Typography } from "@mui/material";

export default function RightSidebar() {
  return (
    <Box
      sx={{
        height: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "action.selected",
      }}
    >
      <Typography variant="body2" color="text.secondary">
        Right Sidebar
      </Typography>
    </Box>
  );
}
