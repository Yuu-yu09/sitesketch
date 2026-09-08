import { trpc } from "@/lib/trpc";

export function useWorkspaceMutations() {
  return {
    createProject: trpc.projects.create.useMutation(),
    updateProject: trpc.projects.update.useMutation(),
    renameProject: trpc.projects.rename.useMutation(),
    deleteProject: trpc.projects.delete.useMutation(),
    saveEditor: trpc.projects.editor.save.useMutation(),
    generateAI: trpc.ai.generate.useMutation(),
  };
}
