import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import { useProject } from "../../../contexts/ProjectContext";
import { ipc } from "../../../lib/ipc-client";

export default function ChatHeader() {
  const { activeProjectId } = useProject();
  const [projectName, setProjectName] = useState("");

  useEffect(() => {
    if (!activeProjectId) {
      setProjectName("");
      return;
    }
    let ignore = false;
    ipc
      .invoke(IPC.GET_PROJECTS)
      .then((projects) => {
        if (ignore) return;
        const p = projects.find((pr) => pr.id === activeProjectId);
        if (p) setProjectName(p.name);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [activeProjectId]);

  if (!activeProjectId) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 24px",
        background: "var(--bg)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span
          style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.005em", color: "var(--ink)" }}
        >
          {projectName}
        </span>
      </div>
    </div>
  );
}
