import ErrorBoundary from "../ErrorBoundary";
import ChatPanel from "./chat/ChatPanel";
import DetailsPanel from "./DetailsPanel";
import LeftSidebar from "./LeftSidebar";

interface AppShellProps {
  onOpenSettings: () => void;
}

export default function AppShell({ onOpenSettings }: AppShellProps) {
  return (
    <div
      className="app"
      style={{ display: "flex", flexDirection: "row", height: "100vh", overflow: "hidden" }}
    >
      <div
        style={{
          width: 248,
          flexShrink: 0,
          height: "100%",
          background: "var(--surface)",
          borderRight: "1px solid var(--line)",
        }}
      >
        <LeftSidebar onOpenSettings={onOpenSettings} />
      </div>
      <div style={{ flex: 1, overflow: "hidden", height: "100%", background: "var(--bg)" }}>
        <ErrorBoundary>
          <ChatPanel />
        </ErrorBoundary>
      </div>
      <div
        style={{
          width: 320,
          flexShrink: 0,
          height: "100%",
          background: "var(--surface)",
          borderLeft: "1px solid var(--line)",
        }}
      >
        <DetailsPanel />
      </div>
    </div>
  );
}
