import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import SiteSketchEditor from "@/components/SiteSketchEditor";
import { trpc } from "@/lib/trpc";
import {
  ArrowDown,
  ArrowUp,
  Blocks,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Eye,
  FileText,
  FolderOpen,
  Gauge,
  Grid2X2,
  Layers3,
  LayoutDashboard,
  LayoutTemplate,
  LogIn,
  LogOut,
  Menu,
  MoreHorizontal,
  Move,
  PanelLeft,
  Plus,
  Redo2,
  Rocket,
  Save,
  Search,
  Settings2,
  Sparkles,
  SquareArrowOutUpRight,
  Trash2,
  Undo2,
  WandSparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  defaultProject,
  initialSections,
  projectTypeOptions,
  purposeOptions,
  recommendSections,
  sectionOptions,
  type GeneratedSection,
  type ProjectState,
  type WorkspaceMode,
  type WorkspaceSection,
} from "@/features/workspace/model";
import { useWorkspaceProject } from "@/features/workspace/useWorkspaceProject";
import { Blueprint, Checklist, ProjectDialog, SectionRow } from "@/features/workspace/components";
import { WorkspaceSidebar, WorkspaceTopbar } from "@/features/workspace/chrome";
import { useWorkspaceMutations } from "@/features/workspace/useWorkspaceMutations";
import { WorkspaceBuilder, WorkspacePreview } from "@/features/workspace/views";

type Mode = WorkspaceMode;
type Section = WorkspaceSection;

const blockContent: Record<string, { eyebrow: string; title: string; body: string }> = {
  hero: { eyebrow: "STRATEGY, MADE VISIBLE", title: "Make your next move obvious.", body: "A clear website turns good ideas into momentum. Shape the story, then build the experience around it." },
  proof: { eyebrow: "TRUST COMPOUNDS", title: "The shortcut is clarity.", body: "Your best customers already know the value. We help you make it visible in the moments that matter." },
  services: { eyebrow: "HOW WE HELP", title: "A system for the next chapter.", body: "From the first outline to the final interaction, every part of the site has a job to do." },
  process: { eyebrow: "A BETTER WAY TO BUILD", title: "From blank page to clear direction.", body: "Start with structure. Refine with intention. Launch with confidence." },
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}


function PlanView({ project, setProject, onGenerate, isGenerating, onOpenBuilder, onRenameProject, onDeleteProject }: { project: ProjectState; setProject: (project: ProjectState) => void; onGenerate: () => void; isGenerating: boolean; onOpenBuilder: () => void; onRenameProject: () => void; onDeleteProject: () => void }) {
  const [newSection, setNewSection] = useState("");
  const recommendedCount = project.sections.filter((item) => item.status === "recommended").length;
  const move = (index: number, direction: number) => { const next = [...project.sections]; const target = index + direction; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; setProject({ ...project, sections: next }); };
  const remove = (id: string) => { const sections = project.sections.filter((item) => item.id !== id); setProject({ ...project, sections, selectedBlock: project.selectedBlock === id ? sections[0]?.id ?? "" : project.selectedBlock }); toast("Section removed from your plan"); };
  const addSection = () => { if (!newSection) return; const id = newSection.toLowerCase().replace(/[^a-z]+/g, "-"); if (project.sections.some(section => section.id === id)) { toast("That section is already in your plan"); return; } setProject({ ...project, sections: [...project.sections, { id, name: newSection, description: "A flexible section for your story", status: "added", icon: "+" }] }); setNewSection(""); toast(`${newSection} added to your plan`); };
  const updateProjectType = (projectType: string) => { const sections = recommendSections(projectType, project.purpose); setProject({ ...project, projectType, sections, selectedBlock: sections[0]?.id ?? "" }); };
  return <div className="space-y-6 pb-12"><div className="page-heading"><div><div className="eyebrow text-indigo-500">Plan workspace <span className="mx-2 text-slate-300">/</span> 01</div><h1 className="mt-2 font-display text-[32px] font-semibold tracking-[-0.04em] text-slate-900 sm:text-[40px]">Shape the story<br /><em>before</em> you shape the site.</h1><p className="mt-3 max-w-[540px] text-sm leading-relaxed text-slate-500">A focused plan gives every page a point of view. Start with the essentials, then make the experience unmistakably yours.</p></div><div className="heading-actions"><button className="button-secondary"><Undo2 size={14} />Undo</button><button className="button-secondary"><Redo2 size={14} />Redo</button></div></div>
    <div className="grid gap-5 xl:grid-cols-[1.06fr_1.42fr_1fr]">
      <div className="space-y-5"><div className="card project-summary p-5"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="eyebrow text-slate-400">Current project</div><h2 className="mt-2 truncate font-display text-[23px] font-semibold text-slate-800">{project.projectName}</h2><p className="mt-1 text-xs text-slate-400">{project.projectType} <span className="mx-1 text-slate-300">·</span> Draft</p></div><div className="project-actions" aria-label="Project actions"><button onClick={onRenameProject} className="project-action-button" title="Rename project" aria-label="Rename project"><MoreHorizontal size={17} /></button><button onClick={onDeleteProject} className="project-action-button project-action-danger" title="Delete project" aria-label="Delete project"><Trash2 size={15} /></button></div></div><div className="mt-5 grid gap-3"><label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Website type<select value={project.projectType} onChange={(event) => updateProjectType(event.target.value)} className="select-field mt-2 w-full">{projectTypeOptions.map(option => <option key={option}>{option}</option>)}</select></label><label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Primary goal<select value={project.purpose} onChange={(event) => setProject({ ...project, purpose: event.target.value })} className="select-field mt-2 w-full">{purposeOptions.map(option => <option key={option}>{option}</option>)}</select></label></div><div className="mt-5 rounded-xl bg-[#f5f6f8] p-3.5"><div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400"><Gauge size={13} /> Goal</div><p className="mt-2 text-[12px] font-medium leading-relaxed text-slate-600">{project.purpose}</p></div><div className="mt-4 flex items-center gap-2"><div className="flex -space-x-1.5"><span className="mini-avatar bg-[#f6d8bd]">AM</span><span className="mini-avatar bg-[#ccd9f7]">SK</span></div><span className="text-[11px] text-slate-400">Personal workspace</span></div></div>
        <div className="ai-card"><div className="ai-glow" /><div className="relative"><div className="flex items-center justify-between"><div className="flex items-center gap-2 text-indigo-100"><div className="ai-icon"><WandSparkles size={14} /></div><span className="eyebrow text-indigo-200">AI site starter</span></div><span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-200/60">Beta</span></div><h3 className="mt-4 font-display text-[19px] font-semibold leading-tight text-white">Start from a direction,<br />not a blank page.</h3><p className="mt-2 text-[11px] leading-relaxed text-indigo-100/65">Describe the feeling, audience, or ambition. SiteSketch will turn it into a structured first draft you can edit.</p><textarea value={project.prompt} onChange={(e) => setProject({ ...project, prompt: e.target.value })} className="ai-textarea mt-4" rows={3} /><button onClick={onGenerate} disabled={!project.prompt.trim() || project.prompt.trim().length < 10 || isGenerating} className="button-ai mt-3 w-full justify-center disabled:cursor-not-allowed disabled:opacity-60"><Sparkles size={14} />{isGenerating ? "Generating…" : "Generate starting point"}</button></div></div></div>
      <div className="card p-5"><div className="flex items-end justify-between"><div><div className="eyebrow text-slate-400">Recommended structure</div><h2 className="mt-2 font-display text-[20px] font-semibold text-slate-800">Your website blueprint</h2></div><span className="count-badge">{project.sections.length} sections</span></div><div className="mt-5 space-y-1.5">{project.sections.map((section, index) => <SectionRow key={section.id} section={section} index={index} total={project.sections.length} onMove={move} onRemove={remove} onSelect={(id) => setProject({ ...project, selectedBlock: id })} />)}</div><div className="mt-4 flex gap-2"><select value={newSection} onChange={(e) => setNewSection(e.target.value)} className="select-field flex-1"><option value="">Add a section…</option>{sectionOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select><button onClick={addSection} className="button-primary px-3" disabled={!newSection}><Plus size={16} /></button></div><div className="mt-4 flex items-center gap-2 border-t border-[#edf0f3] pt-4 text-[11px] text-slate-400"><Check size={14} className="text-emerald-500" />{recommendedCount} smart recommendations based on your site type</div></div>
      <Blueprint sections={project.sections} selectedBlock={project.selectedBlock} onSelect={(id) => setProject({ ...project, selectedBlock: id })} />
    </div>
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]"><Checklist checklist={project.checklist} setChecklist={(checklist) => setProject({ ...project, checklist })} /><div className="card flex items-center justify-between gap-5 p-5"><div><div className="eyebrow text-slate-400">Next step</div><h3 className="mt-2 font-display text-[18px] font-semibold text-slate-800">Make it visual.</h3><p className="mt-1 max-w-[360px] text-xs leading-relaxed text-slate-400">Your structure is a strong start. Move into the builder to shape the details with drag-and-drop blocks.</p></div><button onClick={onOpenBuilder} className="button-dark whitespace-nowrap">Open builder <ChevronRight size={14} /></button></div></div>
  </div>;
}

function BuildView({ projectId, editorSectionIds, generatedSections, ignoreRemoteData, editorResetKey }: { projectId?: number; editorSectionIds: string[]; generatedSections: GeneratedSection[]; ignoreRemoteData: boolean; editorResetKey: number }) {
  return <div className="build-page"><div className="build-heading"><div><div className="eyebrow text-indigo-500">Visual builder <span className="mx-2 text-slate-300">/</span> 02</div><h1 className="mt-2 font-display text-[30px] font-semibold tracking-[-0.04em] text-slate-900">Make the plan tangible.</h1><p className="mt-2 max-w-[560px] text-xs leading-relaxed text-slate-500">Drag SiteSketch blocks onto the canvas, then edit the content and responsive styles directly in the visual editor.</p></div><div className="flex items-center gap-2"><button className="button-secondary" onClick={() => toast("Undo is available in the GrapesJS canvas toolbar")}><Undo2 size={14} /></button><button className="button-secondary" onClick={() => toast("Redo is available in the GrapesJS canvas toolbar")}><Redo2 size={14} /></button></div></div><SiteSketchEditor key={`${projectId ?? "draft"}-${editorResetKey}`} projectId={projectId} initialSectionIds={editorSectionIds} generatedSections={generatedSections} ignoreRemoteData={ignoreRemoteData} /></div>;
}
function PreviewView({ project, setMode }: { project: ProjectState; setMode: (mode: Mode) => void }) {
  return <div className="space-y-6 pb-12"><div className="page-heading"><div><div className="eyebrow text-indigo-500">Live preview <span className="mx-2 text-slate-300">/</span> 03</div><h1 className="mt-2 font-display text-[32px] font-semibold tracking-[-0.04em] text-slate-900 sm:text-[40px]">See the story in motion.</h1><p className="mt-3 max-w-[500px] text-sm leading-relaxed text-slate-500">This is the working output of your plan. Every page, section, and interaction stays editable in the builder.</p></div><div className="heading-actions"><span className="status-pill status-pill-light"><span className="live-dot" />Live draft</span><button className="button-dark" onClick={() => toast("Preview link copied to clipboard")}><SquareArrowOutUpRight size={14} />Share preview</button></div></div><div className="preview-window"><div className="preview-browser"><div className="browser-dots"><i /><i /><i /></div><span className="browser-url">preview.sitesketch.local / {project.projectName.toLowerCase().replace(/ /g, "-")}</span><div className="flex items-center gap-2 text-slate-400"><RefreshIcon /><MoreHorizontal size={15} /></div></div><div className="preview-site"><nav className="preview-nav"><div className="preview-logo"><span>n</span> northstar</div><div className="preview-nav-links"><span>Approach</span><span>Capabilities</span><span>About</span></div><button className="preview-cta">Let's talk <ChevronRight size={13} /></button></nav><section className="preview-hero"><div className="preview-orb" /><div className="preview-hero-copy"><span className="preview-tag">{blockContent.hero.eyebrow}</span><h2>{blockContent.hero.title}</h2><p>{blockContent.hero.body}</p><div className="flex items-center gap-4"><button className="preview-button">Explore the approach <ChevronRight size={14} /></button><button className="preview-text-button">See the work <ArrowDown size={13} /></button></div></div><div className="preview-hero-meta"><span>01</span><span>04</span><div className="preview-progress"><i /></div></div></section><section className="preview-trust"><div><span className="preview-tag">{blockContent.proof.eyebrow}</span><h3>{blockContent.proof.title}</h3></div><div className="trust-statement">"Northstar gave us the language to make a complicated idea feel simple."<span>— Maya Chen, Founder</span></div></section><section className="preview-services"><div><span className="preview-tag">{blockContent.services.eyebrow}</span><h3>{blockContent.services.title}</h3></div><div className="preview-service-list"><div><span>01</span><strong>Strategic clarity</strong><ChevronRight size={16} /></div><div><span>02</span><strong>Brand systems</strong><ChevronRight size={16} /></div><div><span>03</span><strong>Digital direction</strong><ChevronRight size={16} /></div></div></section><footer className="preview-footer"><span>northstar studio</span><span>New York · Everywhere</span><span>© 2024</span></footer></div></div><div className="preview-bottom"><div className="flex items-center gap-3"><div className="preview-check"><Check size={13} /></div><div><div className="text-xs font-semibold text-slate-700">Your site is ready to refine</div><div className="mt-0.5 text-[11px] text-slate-400">All {project.sections.length} planned sections are represented in this preview.</div></div></div><button onClick={() => setMode("build")} className="button-secondary">Edit in builder <ChevronRight size={14} /></button></div></div>;
}

function RefreshIcon() { return <span className="text-[13px]">↻</span>; }

export default function Home() {
  const { user, loading, logout } = useAuth();
  const [mode, setMode] = useState<Mode>("plan");
  const [projectId, setProjectId] = useState<number | undefined>();
  const [hasChosenProject, setHasChosenProject] = useState(false);
  const [editorData, setEditorData] = useState<Record<string, unknown>>({});
  const [editorSectionIds, setEditorSectionIds] = useState<string[]>(initialSections.map((section) => section.id));
  const [generatedSections, setGeneratedSections] = useState<GeneratedSection[]>([]);
  const [ignoreRemoteEditorData, setIgnoreRemoteEditorData] = useState(false);
  const [editorResetKey, setEditorResetKey] = useState(0);
  const [projectDialog, setProjectDialog] = useState<{ mode: "rename" | "delete"; id: number } | null>(null);
  const [projectDialogValue, setProjectDialogValue] = useState("");
  const { project, setProject, persistLocalProject } = useWorkspaceProject();
  const projectsQuery = trpc.projects.list.useQuery(undefined, { enabled: Boolean(user) });
  const editorQuery = trpc.projects.editor.load.useQuery({ id: projectId ?? 0 }, { enabled: Boolean(user && projectId) });
  const { createProject, updateProject, renameProject, deleteProject, saveEditor, generateAI } = useWorkspaceMutations();
  const projectProgress = useMemo(() => Math.min(100, Math.round((project.sections.length / 7) * 100)), [project.sections.length]);

  useEffect(() => {
    if (!user) { persistLocalProject(project); return; }
    const first = projectsQuery.data?.[0];
    if (first && !projectId && !hasChosenProject) {
      setProjectId(first.id);
      setHasChosenProject(true);
      setEditorSectionIds(first.sections.map((section) => section.id));
      setIgnoreRemoteEditorData(false);
      setProject({ projectName: first.projectName, projectType: first.projectType, purpose: first.purpose, prompt: first.prompt, sections: first.sections, checklist: first.checklist, selectedBlock: first.selectedBlock });
    }
  }, [user, projectsQuery.data, projectId, hasChosenProject, persistLocalProject]);

  useEffect(() => {
    if (editorQuery.data && Object.keys(editorQuery.data).length > 0) setEditorData(editorQuery.data);
  }, [editorQuery.data]);

  const saveProject = () => {
    if (!user) { persistLocalProject(project); toast.success("Project saved locally", { description: "Sign in to persist this project to the SiteSketch database." }); return; }
    if (projectId) {
      updateProject.mutate({ id: projectId, state: project }, { onSuccess: () => toast.success("Project saved to database") });
      if (Object.keys(editorData).length > 0) saveEditor.mutate({ id: projectId, data: editorData });
      return;
    }
    createProject.mutate(project, { onSuccess: ({ id }) => { setProjectId(id); setHasChosenProject(true); projectsQuery.refetch(); toast.success("Project created", { description: "Your project is now stored in the SiteSketch database." }); } });
  };

  const openProject = (id: number) => { const saved = projectsQuery.data?.find((item) => item.id === id); if (!saved) return; setProjectId(saved.id); setHasChosenProject(true); setEditorData({}); setEditorSectionIds(saved.sections.map((section) => section.id)); setIgnoreRemoteEditorData(false); setProject({ projectName: saved.projectName, projectType: saved.projectType, purpose: saved.purpose, prompt: saved.prompt, sections: saved.sections, checklist: saved.checklist, selectedBlock: saved.selectedBlock }); setMode("plan"); toast(`Opened ${saved.projectName}`); };
  const newProject = () => { setProjectId(undefined); setHasChosenProject(true); setEditorData({}); setGeneratedSections([]); setEditorSectionIds([]); setIgnoreRemoteEditorData(true); setEditorResetKey((value) => value + 1); setProject({ ...defaultProject, projectName: "Untitled project", prompt: "" }); setMode("plan"); toast("New project started"); };
  const renameProjectById = (id: number) => { const saved = projectsQuery.data?.find((item) => item.id === id); setProjectDialog({ mode: "rename", id }); setProjectDialogValue(saved?.projectName ?? project.projectName); };
  const renameCurrentProject = () => { if (projectId) renameProjectById(projectId); else setProjectDialog({ mode: "rename", id: -1 }); setProjectDialogValue(project.projectName); };
  const deleteProjectById = (id: number) => { const saved = projectsQuery.data?.find((item) => item.id === id); setProjectDialog({ mode: "delete", id }); setProjectDialogValue(saved?.projectName ?? project.projectName); };
  const closeProjectDialog = () => { setProjectDialog(null); setProjectDialogValue(""); };
  const confirmProjectDialog = () => {
    if (!projectDialog) return;
    if (projectDialog.mode === "rename") {
      const name = projectDialogValue.trim();
      if (!name) return toast.error("Enter a project name");
      if (projectDialog.id === -1) { setProject({ ...project, projectName: name }); closeProjectDialog(); toast.success("Project renamed"); return; }
      renameProject.mutate({ id: projectDialog.id, name }, { onSuccess: () => { if (projectDialog.id === projectId) setProject({ ...project, projectName: name }); projectsQuery.refetch(); closeProjectDialog(); toast.success("Project renamed"); }, onError: (error) => toast.error("Rename failed", { description: error.message }) });
      return;
    }
    deleteProject.mutate({ id: projectDialog.id }, { onSuccess: () => { const remaining = projectsQuery.data?.filter((item) => item.id !== projectDialog.id) ?? []; if (projectDialog.id === projectId) { setProjectId(undefined); setHasChosenProject(remaining.length === 0); setEditorData({}); setProject(remaining[0] ? { projectName: remaining[0].projectName, projectType: remaining[0].projectType, purpose: remaining[0].purpose, prompt: remaining[0].prompt, sections: remaining[0].sections, checklist: remaining[0].checklist, selectedBlock: remaining[0].selectedBlock } : defaultProject); } projectsQuery.refetch(); closeProjectDialog(); toast.success("Project deleted"); }, onError: (error) => toast.error("Delete failed", { description: error.message }) });
  };

  const generate = () => {
    if (!user) { toast("Sign in to use AI site generation", { description: "Your prompt stays private and the result will be saved to your project." }); return; }
    generateAI.mutate({ prompt: project.prompt }, {
      onSuccess: (spec) => {
        const aiSections = spec.pages[0]?.sections ?? [];
        const ids = aiSections.map((section) => section.id);
        const generated = ids.map((id) => initialSections.find((section) => section.id === id) ?? ({ id, name: id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), description: "AI-suggested section for your story", status: "added" as const, icon: "+" })).filter(Boolean);
        const nextProject = { ...project, projectName: project.projectName === "Untitled project" ? "New direction" : project.projectName, projectType: spec.site_type, purpose: spec.purpose, sections: generated.length ? generated : project.sections, checklist: { ...project.checklist, headline: true, proof: true } };
        setProject(nextProject);
        setEditorSectionIds(generated.map((section) => section.id));
        setGeneratedSections(aiSections);
        setIgnoreRemoteEditorData(true);
        setEditorData({});
        setEditorResetKey((value) => value + 1);
        if (projectId) updateProject.mutate({ id: projectId, state: nextProject }, { onSuccess: () => projectsQuery.refetch() });
        else createProject.mutate(nextProject, { onSuccess: ({ id }) => { setProjectId(id); setHasChosenProject(true); projectsQuery.refetch(); } });
        toast.success("AI starting point generated", { description: "A fresh editable website was created from your brief." });
        setMode("build");
      },
      onError: (error) => toast.error("AI generation failed", { description: error.message }),
    });
  };

  const handleEditorData = useCallback((data: Record<string, unknown>) => setEditorData(data), []);
  const savedProjects = projectsQuery.data ?? [];
  if (loading) return <div className="min-h-screen bg-[#f8f9fb]" />;
  return <div className="app-shell"><WorkspaceSidebar mode={mode} setMode={setMode} onNew={newProject} user={user} projects={savedProjects} activeProjectId={projectId} onOpenProject={openProject} onRenameProject={renameProjectById} onDeleteProject={deleteProjectById} /><div className="main-shell lg:pl-[252px]"><WorkspaceTopbar mode={mode} setMode={setMode} project={project} onSave={saveProject} user={user} projects={savedProjects} onNew={newProject} onOpenProject={openProject} onLogout={() => logout().then(() => { setProjectId(undefined); setEditorData({}); toast.success("Signed out"); }).catch((error) => toast.error("Sign out failed", { description: error.message }))} /><main className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8 lg:px-10 lg:py-10">{mode === "plan" && <PlanView project={project} setProject={setProject} onGenerate={generate} isGenerating={generateAI.isPending} onOpenBuilder={() => setMode("build")} onRenameProject={renameCurrentProject} onDeleteProject={() => projectId ? deleteProjectById(projectId) : toast("Save this project before deleting it")} />}{mode === "build" && <WorkspaceBuilder projectId={projectId} editorSectionIds={editorSectionIds} generatedSections={generatedSections} ignoreRemoteData={ignoreRemoteEditorData} editorResetKey={editorResetKey} onDataChange={handleEditorData} />}{mode === "preview" && <WorkspacePreview project={project} editorData={editorData} setMode={setMode} />}</main><div className="mobile-bottom-nav lg:hidden"><button className={cn(mode === "plan" && "mobile-nav-active")} onClick={() => setMode("plan")}><LayoutDashboard size={17} /><span>Plan</span></button><button className={cn(mode === "build" && "mobile-nav-active")} onClick={() => setMode("build")}><Blocks size={17} /><span>Build</span></button><button className={cn(mode === "preview" && "mobile-nav-active")} onClick={() => setMode("preview")}><Eye size={17} /><span>Preview</span></button></div></div><div className="fixed bottom-5 right-5 hidden items-center gap-2 rounded-full bg-[#131b31] px-3 py-2 text-[10px] font-semibold text-slate-300 shadow-xl lg:flex"><span className="live-dot" />{projectProgress}% planned <span className="ml-1 text-slate-500">·</span> <CircleHelp size={13} /></div>{projectDialog && <ProjectDialog mode={projectDialog.mode} value={projectDialogValue} setValue={setProjectDialogValue} onCancel={closeProjectDialog} onConfirm={confirmProjectDialog} />}</div>;
}
