import { Box } from "@mui/material";
import ChatPanel from "./chat/ChatPanel";
import DetailsPanel from "./DetailsPanel";
import LeftSidebar from "./LeftSidebar";

interface AppShellProps {
  onOpenSettings: () => void;
}

export default function AppShell({ onOpenSettings }: AppShellProps) {
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
        <LeftSidebar onOpenSettings={onOpenSettings} />
      </Box>
      <Box sx={{ flex: 1, overflow: "hidden", height: "100%" }}>
        <ChatPanel />
      </Box>
      <Box sx={{ width: 320, flexShrink: 0, height: "100%" }}>
        <DetailsPanel />
      </Box>
    </Box>
  );
}
