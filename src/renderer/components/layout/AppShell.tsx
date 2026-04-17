import { Box } from "@mui/material"
import ArtifactPanel from "./artifacts/ArtifactPanel"
import ChatPanel from "./chat/ChatPanel"
import LeftSidebar from "./LeftSidebar"
import RightSidebar from "./RightSidebar"

export default function AppShell() {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "row",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <Box sx={{ width: 240, flexShrink: 0, height: "100%" }}>
        <LeftSidebar />
      </Box>
      <Box sx={{ flex: 1, overflow: "hidden", height: "100%" }}>
        <ChatPanel />
      </Box>
      <Box
        sx={{
          width: 320,
          flexShrink: 0,
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <RightSidebar />
        <ArtifactPanel />
      </Box>
    </Box>
  )
}
