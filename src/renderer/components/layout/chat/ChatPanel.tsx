import { Box } from "@mui/material";
import MessageInput from "./MessageInput";
import MessageList from "./MessageList";
import ResearchStatusBar from "./ResearchStatusBar";

export default function ChatPanel() {
  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <ResearchStatusBar />
      <Box sx={{ flex: 1, overflow: "hidden" }}>
        <MessageList />
      </Box>
      <MessageInput />
    </Box>
  );
}
