import { useCallback, useState } from "react";
import { cloneProject, defaultProject, type ProjectState } from "./model";

function loadLocalProject(): ProjectState {
  const saved = window.localStorage.getItem("sitesketch-project");
  if (!saved) return cloneProject(defaultProject);
  try {
    const parsed = JSON.parse(saved) as Partial<ProjectState>;
    if (
      typeof parsed.projectName !== "string" ||
      typeof parsed.projectType !== "string" ||
      typeof parsed.purpose !== "string" ||
      typeof parsed.prompt !== "string" ||
      !Array.isArray(parsed.sections) ||
      !parsed.checklist ||
      typeof parsed.checklist !== "object" ||
      typeof parsed.selectedBlock !== "string"
    ) {
      return cloneProject(defaultProject);
    }
    return {
      projectName: parsed.projectName,
      projectType: parsed.projectType,
      purpose: parsed.purpose,
      prompt: parsed.prompt,
      sections: parsed.sections,
      checklist: parsed.checklist as Record<string, boolean>,
      selectedBlock: parsed.selectedBlock,
    };
  } catch {
    return defaultProject;
  }
}

export function useWorkspaceProject() {
  const [project, setProject] = useState<ProjectState>(loadLocalProject);

  const persistLocalProject = useCallback((nextProject: ProjectState) => {
    window.localStorage.setItem("sitesketch-project", JSON.stringify(cloneProject(nextProject)));
  }, []);

  return { project, setProject, persistLocalProject };
}
