import { useProject } from "../../contexts/ProjectContext";
import FileExplorer from "./FileExplorer";
import RecentOutputsPanel from "./RecentOutputsPanel";

export default function DetailsPanel() {
  const { activeProjectId } = useProject();

  if (!activeProjectId) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          color: "var(--ink-3)",
          fontSize: 12,
          textAlign: "center",
        }}
      >
        Details, artifacts and recent outputs appear here once a project is selected.
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--surface)",
        overflow: "hidden",
      }}
    >
      <RecentOutputsPanel projectId={activeProjectId} />
      <FileExplorer projectId={activeProjectId} />
    </div>
  );
}
