import { Box, Typography } from "@mui/material"

export default function MessageList() {
  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Typography variant="body2" color="text.secondary">
        Message List
      </Typography>
    </Box>
  )
}
