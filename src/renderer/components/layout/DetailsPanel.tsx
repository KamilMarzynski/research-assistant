import { useProject } from "../../contexts/ProjectContext";
import ProjectArtifactsPanel from "./ProjectArtifactsPanel";
import ResearchHistoryPanel from "./ResearchHistoryPanel";
import WindowDragBar from "./WindowDragBar";

export default function DetailsPanel() {
  const { activeProjectId } = useProject();

  if (!activeProjectId) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <WindowDragBar />
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            color: "var(--ink-3)",
            fontSize: 12,
            textAlign: "center",
          }}
        >
          Select a project to view artifacts and research history.
        </div>
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
        gap: 12,
        padding: 12,
      }}
    >
      <WindowDragBar />
      <ProjectArtifactsPanel projectId={activeProjectId} />
      <ResearchHistoryPanel projectId={activeProjectId} />
    </div>
  );
}
