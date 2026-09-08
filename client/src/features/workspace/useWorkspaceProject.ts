import { useCallback, useState } from "react";
import { defaultProject, type ProjectState } from "./model";

function loadLocalProject(): ProjectState {
  try {
    const saved = window.localStorage.getItem("sitesketch-project");
    return saved ? JSON.parse(saved) as ProjectState : defaultProject;
  } catch {
    return defaultProject;
  }
}

export function useWorkspaceProject() {
  const [project, setProject] = useState<ProjectState>(loadLocalProject);

  const persistLocalProject = useCallback((nextProject: ProjectState) => {
    window.localStorage.setItem("sitesketch-project", JSON.stringify(nextProject));
  }, []);

  return { project, setProject, persistLocalProject };
}
