import { Box, Typography } from "@mui/material"

export default function MessageInput() {
  return (
    <Box
      sx={{
        p: 2,
        borderTop: 1,
        borderColor: "divider",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 64,
      }}
    >
      <Typography variant="body2" color="text.secondary">
        Message Input
      </Typography>
    </Box>
  )
}
