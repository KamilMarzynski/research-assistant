import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import { useProject } from "../../../contexts/ProjectContext";
import { IconBrain, IconDoc } from "../../shared/Icons";

export default function ChatHeader() {
  const { activeProjectId } = useProject();
  const [projectName, setProjectName] = useState("");

  useEffect(() => {
    if (!activeProjectId) {
      setProjectName("");
      return;
    }
    let ignore = false;
    window.electronAPI
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
        padding: "14px 24px",
        borderBottom: "1px solid var(--line)",
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
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="chip">
          <IconBrain size={11} /> 14 memories
        </span>
        <span className="chip">
          <IconDoc size={11} /> 7 artifacts
        </span>
      </div>
    </div>
  );
}
