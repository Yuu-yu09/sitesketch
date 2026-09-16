import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, FolderOpen, LayoutTemplate, LogIn, LogOut, Menu, MoreHorizontal, Plus, Save, Trash2, X } from "lucide-react";
import { startLogin } from "@/const";
import type { ProjectState, WorkspaceMode } from "./model";

const cn = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");
type SavedProject = { id: number; projectName: string; updatedAt: Date };

type WorkspaceTopbarProps = {
  mode: WorkspaceMode;
  setMode: (mode: WorkspaceMode) => void;
  project: ProjectState;
  onSave: () => void;
  user: { name?: string | null; email?: string | null } | null;
  onLogout: () => void;
  projects: SavedProject[];
  onNew: () => void;
  onOpenProject: (id: number) => void;
  onRenameProject?: (id: number) => void;
  onDeleteProject?: (id: number) => void;
};

export function WorkspaceTopbar({ mode, setMode, project, onSave, user, onLogout, projects, onNew, onOpenProject, onRenameProject, onDeleteProject }: WorkspaceTopbarProps) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projectActions, setProjectActions] = useState<number | null>(null);
  const modeLabels: Record<WorkspaceMode, string> = { plan: "Plan", build: "Edit site", preview: "Preview" };
  const navigate = (nextMode: WorkspaceMode) => { setMode(nextMode); setMobileOpen(false); };
  const openProjects = () => { setProjectsOpen(value => !value); setProjectActions(null); };

  return <header className="topbar relative sticky top-0 z-20 border-b border-[#e4e6eb] bg-[#f8f9fb]/95 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
    <div className="flex min-h-[76px] items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="workspace-brand" aria-label="SiteSketch workspace"><span className="workspace-brand-mark" aria-hidden="true">✦</span><span>SiteSketch</span></div>
        <ChevronRight className="workspace-breadcrumb" size={14} aria-hidden="true" />
        <div className="relative hidden min-w-0 sm:block">
          <button onClick={openProjects} className="project-switcher-trigger" aria-expanded={projectsOpen} aria-haspopup="menu"><FolderOpen size={13} />My projects<ChevronDown size={13} /></button>
          {projectsOpen && <div className="project-switcher-menu">
            <div className="project-switcher-heading">Your projects</div>
            {projects.length === 0 && <div className="project-switcher-empty">No saved projects yet.</div>}
            {projects.map(saved => <div key={saved.id} className="project-switcher-row">
              <button onClick={() => { onOpenProject(saved.id); setProjectsOpen(false); }} className={cn("project-switcher-item", saved.projectName === project.projectName && "project-switcher-item-active")}><LayoutTemplate size={14} /><span className="truncate">{saved.projectName}</span></button>
              <button className="project-switcher-actions" title={`Actions for ${saved.projectName}`} aria-label={`Actions for ${saved.projectName}`} onClick={() => setProjectActions(projectActions === saved.id ? null : saved.id)}><MoreHorizontal size={14} /></button>
              {projectActions === saved.id && <div className="project-menu project-menu-light"><button onClick={() => { onRenameProject?.(saved.id); setProjectsOpen(false); }}><FileText size={13} />Rename</button><button onClick={() => { onDeleteProject?.(saved.id); setProjectsOpen(false); }}><Trash2 size={13} />Delete</button></div>}
            </div>)}
            <button onClick={() => { onNew(); setProjectsOpen(false); }} className="project-switcher-new"><Plus size={14} />New project</button>
          </div>}
        </div>
        <ChevronRight className="workspace-breadcrumb hidden sm:block" size={14} aria-hidden="true" />
        <span className="hidden max-w-[180px] truncate text-xs font-medium text-slate-700 sm:block" aria-current="page">{project.projectName}</span>
      </div>
      <nav className="mode-tabs" aria-label="Project steps">{(["plan", "build", "preview"] as WorkspaceMode[]).map(item => <button key={item} onClick={() => navigate(item)} className={cn(mode === item && "mode-tab-active")}>{modeLabels[item]}</button>)}</nav><span className="mobile-current-mode">{modeLabels[mode]}</span>
      <button className="icon-button lg:hidden" onClick={() => setMobileOpen(value => !value)} aria-label={mobileOpen ? "Close workspace menu" : "Open workspace menu"} aria-expanded={mobileOpen}>{mobileOpen ? <X size={18} /> : <Menu size={19} />}</button>
      <div className="flex items-center gap-2 sm:gap-3">
        <span className="hidden items-center gap-1.5 text-[11px] font-medium text-slate-400 md:flex"><span className="save-indicator" />Saved</span>
        <button onClick={onSave} className="button-secondary hidden sm:flex"><Save size={14} />Save</button>
        {user ? <div className="relative"><button onClick={() => setAccountOpen(value => !value)} className="account-trigger" title="Account" aria-label="Account" aria-expanded={accountOpen}><span className="avatar avatar-top">{(user.name || "AM").slice(0, 2).toUpperCase()}</span><span className="account-label">Account</span><ChevronDown size={13} aria-hidden="true" /></button>{accountOpen && <div className="account-menu"><div className="border-b border-[#edf0f3] px-3 py-2.5"><div className="truncate text-[11px] font-semibold text-slate-700">{user.name || "Signed-in user"}</div><div className="mt-0.5 truncate text-[10px] text-slate-400">{user.email || "Signed-in session"}</div></div><div className="px-1.5 py-1.5"><div className="account-status"><span className="save-indicator" />Saved to your account</div><button onClick={() => { setAccountOpen(false); onLogout(); }} className="account-menu-item"><LogOut size={13} />Sign out</button></div></div>}</div> : <button onClick={() => startLogin()} className="button-primary"><LogIn size={14} />Sign in</button>}
      </div>
    </div>
    {mobileOpen && <div className="mobile-workspace-menu" role="menu">
      <div className="flex items-center justify-between px-3 pb-2"><span className="text-[11px] font-semibold text-slate-500">{project.projectName}</span><button className="mobile-projects-toggle" onClick={openProjects}>My projects{projects.length ? ` · ${projects.length}` : ""}<ChevronRight size={13} /></button></div>
      {projectsOpen && <div className="mobile-project-list">{projects.map(saved => <div key={saved.id} className="mobile-project-row"><button onClick={() => { onOpenProject(saved.id); setMobileOpen(false); setProjectsOpen(false); }} className="mobile-workspace-link"><span className="flex min-w-0 items-center gap-2"><LayoutTemplate size={14} /> <span className="truncate">{saved.projectName}</span></span><ChevronRight size={14} /></button><button className="project-switcher-actions" aria-label={`Actions for ${saved.projectName}`} onClick={() => setProjectActions(projectActions === saved.id ? null : saved.id)}><MoreHorizontal size={14} /></button>{projectActions === saved.id && <div className="project-menu project-menu-light"><button onClick={() => { onRenameProject?.(saved.id); setMobileOpen(false); }}><FileText size={13} />Rename</button><button onClick={() => { onDeleteProject?.(saved.id); setMobileOpen(false); }}><Trash2 size={13} />Delete</button></div>}</div>)}</div>}
      <button onClick={() => { onNew(); setMobileOpen(false); }} className="mobile-workspace-link"><span className="flex items-center gap-2"><Plus size={14} />New project</span><ChevronRight size={14} /></button>
      {(["plan", "build", "preview"] as WorkspaceMode[]).map(item => <button key={item} onClick={() => navigate(item)} className={cn("mobile-workspace-link", mode === item && "mobile-workspace-link-active")}>{modeLabels[item]}<ChevronRight size={14} /></button>)}
      <button onClick={() => { onSave(); setMobileOpen(false); }} className="button-secondary mt-2 w-full justify-center"><Save size={14} />Save changes</button>
    </div>}
  </header>;
}

/** Kept as a compatibility export for integrations that imported the old chrome. */
export function WorkspaceSidebar() { return null; }
