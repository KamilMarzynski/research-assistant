import { createContext, type ReactNode, useContext, useState } from "react";

interface ProjectContextValue {
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
}

const ProjectContext = createContext<ProjectContextValue>({
  activeProjectId: null,
  setActiveProjectId: () => {},
});

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  return (
    <ProjectContext.Provider value={{ activeProjectId, setActiveProjectId }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  return useContext(ProjectContext);
}
