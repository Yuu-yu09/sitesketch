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

type Mode = "plan" | "build" | "preview";
type Section = {
  id: string;
  name: string;
  description: string;
  status: "recommended" | "added";
  icon: string;
};

export type GeneratedSection = {
  id: string;
  name: string;
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  background: string;
  foreground: string;
  accent: string;
  layout: "split" | "centered" | "grid" | "quote" | "simple";
};

type ProjectState = {
  projectName: string;
  projectType: string;
  purpose: string;
  prompt: string;
  sections: Section[];
  checklist: Record<string, boolean>;
  selectedBlock: string;
};

const initialSections: Section[] = [
  { id: "nav", name: "Navigation", description: "Clear wayfinding for every page", status: "recommended", icon: "≡" },
  { id: "hero", name: "Hero", description: "Lead with a focused value proposition", status: "recommended", icon: "✦" },
  { id: "proof", name: "Social proof", description: "Build confidence with customer signals", status: "recommended", icon: "◌" },
  { id: "services", name: "Services", description: "Show the ways you create value", status: "recommended", icon: "▦" },
  { id: "process", name: "Process", description: "Make the next step feel simple", status: "recommended", icon: "↗" },
  { id: "contact", name: "Contact", description: "A direct path to start a conversation", status: "recommended", icon: "⌁" },
  { id: "footer", name: "Footer", description: "Close with confidence and context", status: "recommended", icon: "—" },
];

const blockContent: Record<string, { eyebrow: string; title: string; body: string }> = {
  hero: { eyebrow: "STRATEGY, MADE VISIBLE", title: "Make your next move obvious.", body: "A clear website turns good ideas into momentum. Shape the story, then build the experience around it." },
  proof: { eyebrow: "TRUST COMPOUNDS", title: "The shortcut is clarity.", body: "Your best customers already know the value. We help you make it visible in the moments that matter." },
  services: { eyebrow: "HOW WE HELP", title: "A system for the next chapter.", body: "From the first outline to the final interaction, every part of the site has a job to do." },
  process: { eyebrow: "A BETTER WAY TO BUILD", title: "From blank page to clear direction.", body: "Start with structure. Refine with intention. Launch with confidence." },
};

const defaultProject: ProjectState = {
  projectName: "Northstar Studio",
  projectType: "Creative agency",
  purpose: "Turn interest into qualified conversations",
  prompt: "A confident, editorial site for a small strategy studio helping ambitious teams find their next clear move.",
  sections: initialSections,
  checklist: { headline: true, proof: true, services: false, cta: false },
  selectedBlock: "hero",
};

const sectionOptions = ["Testimonials", "FAQ", "Pricing", "Gallery", "Case studies", "Opening hours"];

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function Logo() {
  return (
    <div className="flex items-center gap-3 px-1">
      <div className="brand-mark"><span>✦</span></div>
      <div>
        <div className="font-display text-[15px] font-semibold tracking-[0.16em] text-white">SITESKETCH</div>
        <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">Plan · shape · ship</div>
      </div>
    </div>
  );
}

function Sidebar({ mode, setMode, project, onNew, user, projects, activeProjectId, onOpenProject, onRenameProject, onDeleteProject }: { mode: Mode; setMode: (mode: Mode) => void; project: ProjectState; onNew: () => void; user: any; projects: Array<{ id: number; projectName: string; updatedAt: Date }>; activeProjectId?: number; onOpenProject: (id: number) => void; onRenameProject: (id: number) => void; onDeleteProject: (id: number) => void }) {
  const links: Array<{ id: Mode; label: string; icon: typeof LayoutDashboard }> = [
    { id: "plan", label: "Plan workspace", icon: LayoutDashboard },
    { id: "build", label: "Visual builder", icon: Blocks },
    { id: "preview", label: "Live preview", icon: Eye },
  ];
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  return (
    <aside className="sidebar fixed inset-y-0 left-0 z-30 hidden w-[252px] flex-col border-r border-white/[0.08] bg-[#0d1325] px-5 py-6 lg:flex">
      <Logo />
      <div className="mt-10 flex items-center justify-between px-1"><span className="eyebrow text-slate-500">Workspace</span><button onClick={onNew} className="icon-button text-slate-400" title="New project"><Plus size={16} /></button></div>
      <nav className="mt-3 space-y-1">{links.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setMode(id)} className={cn("side-link", mode === id && "side-link-active")}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{id === "preview" && <span className="ml-auto live-dot" />}</button>)}</nav>
      <div className="mt-9 px-1"><span className="eyebrow text-slate-500">Your projects</span></div>
      <div className="mt-3 space-y-1">{projects.length === 0 && <div className="px-2 py-3 text-[11px] text-slate-500">No saved projects yet.</div>}{projects.slice(0, 6).map((saved) => <div key={saved.id} className={cn("project-nav-item", activeProjectId === saved.id && "project-nav-active")}><button onClick={() => onOpenProject(saved.id)} className="project-nav-select"><div className="project-thumb"><LayoutTemplate size={14} /></div><div className="min-w-0 text-left"><div className="truncate text-[12px] font-medium text-slate-200">{saved.projectName}</div><div className="mt-0.5 text-[10px] text-slate-500">{new Date(saved.updatedAt).toLocaleDateString()}</div></div></button><button onClick={() => setOpenMenu(openMenu === saved.id ? null : saved.id)} className="project-nav-more" title="Project actions"><MoreHorizontal size={14} /></button>{openMenu === saved.id && <div className="project-menu project-menu-dark"><button onClick={() => { setOpenMenu(null); onRenameProject(saved.id); }}><FileText size={13} />Rename</button><button onClick={() => { setOpenMenu(null); onDeleteProject(saved.id); }}><Trash2 size={13} />Delete</button></div>}</div>)}<button onClick={() => toast(projects.length ? `${projects.length} saved project${projects.length === 1 ? "" : "s"} shown above` : "Create your first project with the + button")} className="side-link mt-1 text-slate-500"><FolderOpen size={16} /><span>All projects</span><ChevronRight size={14} className="ml-auto" /></button></div>
      <div className="mt-auto"><div className="sidebar-note"><div className="flex items-center gap-2 text-amber-300"><Sparkles size={14} /><span className="text-[11px] font-semibold">Build with intention</span></div><p className="mt-2 text-[11px] leading-relaxed text-slate-400">Start with structure. The right details come later.</p></div><div className="mt-5 flex items-center gap-3 border-t border-white/[0.07] pt-4"><div className="avatar">{user ? (user.name || "AM").slice(0, 2).toUpperCase() : "AM"}</div><div className="min-w-0"><div className="truncate text-xs font-medium text-slate-200">{user?.name || "Alex Morgan"}</div><div className="text-[10px] text-slate-500">{user ? "Synced workspace" : "Sign in to sync"}</div></div><Settings2 size={15} className="ml-auto text-slate-500" /></div></div>
    </aside>
  );
}

function Topbar({ mode, setMode, project, onSave, user, onLogout }: { mode: Mode; setMode: (mode: Mode) => void; project: ProjectState; onSave: () => void; user: any; onLogout: () => void }) {
  const [accountOpen, setAccountOpen] = useState(false);
  return (
    <header className="topbar sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-[#e4e6eb] bg-[#f8f9fb]/90 px-5 backdrop-blur-xl lg:pl-[30px] lg:pr-8">
      <div className="flex items-center gap-4 lg:gap-7">
        <button className="icon-button lg:hidden"><Menu size={19} /></button>
        <div className="hidden items-center gap-2 text-xs text-slate-400 sm:flex"><span>Projects</span><ChevronRight size={13} /><span className="font-medium text-slate-600">{project.projectName}</span></div>
        <div className="mode-tabs">
          {(["plan", "build", "preview"] as Mode[]).map((item) => <button key={item} onClick={() => setMode(item)} className={cn(mode === item && "mode-tab-active")}>{item === "plan" ? "Plan" : item === "build" ? "Build" : "Preview"}</button>)}
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <span className="hidden items-center gap-1.5 text-[11px] font-medium text-slate-400 sm:flex"><span className="save-indicator" />All changes saved</span>
        <button onClick={onSave} className="button-secondary hidden sm:flex"><Save size={14} />Save</button>
        <button onClick={() => toast("Preview link copied to clipboard") } className="button-secondary hidden md:flex"><SquareArrowOutUpRight size={14} />Share</button>
        {user ? <div className="relative"><button onClick={() => setAccountOpen(!accountOpen)} className="avatar avatar-top" title="Account"><span>{(user.name || "AM").slice(0, 2).toUpperCase()}</span></button>{accountOpen && <div className="account-menu"><div className="border-b border-[#edf0f3] px-3 py-2.5"><div className="truncate text-[11px] font-semibold text-slate-700">{user.name || "Signed-in user"}</div><div className="mt-0.5 truncate text-[10px] text-slate-400">{user.email || "Signed-in session"}</div></div><div className="px-1.5 py-1.5"><div className="account-status"><span className="save-indicator" />Database sync enabled</div><button onClick={() => { setAccountOpen(false); onLogout(); }} className="account-menu-item"><LogOut size={13} />Sign out</button></div></div>}</div> : <button onClick={() => startLogin()} className="button-primary"><LogIn size={14} />Sign in</button>}
      </div>
    </header>
  );
}

function ProjectDialog({ mode, value, setValue, onCancel, onConfirm }: { mode: "rename" | "delete"; value: string; setValue: (value: string) => void; onCancel: () => void; onConfirm: () => void }) {
  return <div className="project-dialog-backdrop" role="presentation"><div className="project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title"><button onClick={onCancel} className="project-dialog-close" title="Close"><X size={16} /></button><div className="eyebrow text-indigo-500">Project action</div><h2 id="project-dialog-title" className="mt-2 font-display text-[20px] font-semibold text-slate-800">{mode === "rename" ? "Rename project" : "Delete project"}</h2><p className="mt-2 text-xs leading-relaxed text-slate-500">{mode === "rename" ? "Choose a clear name so you can find this project again." : "This permanently removes the project, pages, and saved editor data."}</p>{mode === "rename" ? <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onConfirm(); }} className="dialog-input mt-5" placeholder="Project name" /> : <div className="mt-5 rounded-lg bg-[#fff6f5] p-3 text-xs font-medium text-[#a45149]">{value}</div>}<div className="mt-6 flex justify-end gap-2"><button onClick={onCancel} className="button-secondary">Cancel</button><button onClick={onConfirm} className={mode === "delete" ? "button-danger" : "button-primary"}>{mode === "rename" ? "Save name" : "Delete project"}</button></div></div></div>;
}

function SectionRow({ section, index, total, onMove, onRemove, onSelect }: { section: Section; index: number; total: number; onMove: (index: number, direction: number) => void; onRemove: (id: string) => void; onSelect: (id: string) => void }) {
  return (
    <div onClick={() => onSelect(section.id)} className="section-row group">
      <div className="drag-handle"><Move size={15} /></div>
      <div className={cn("section-icon", section.id === "hero" && "section-icon-highlight")}>{section.icon}</div>
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-[13px] font-semibold text-slate-700">{section.name}</span>{section.status === "recommended" && <span className="chip-recommended">Recommended</span>}</div><p className="mt-0.5 truncate text-[11px] text-slate-400">{section.description}</p></div>
      <div className="section-actions opacity-0 transition-opacity group-hover:opacity-100"><button onClick={(e) => { e.stopPropagation(); onMove(index, -1); }} disabled={index === 0} title="Move up"><ArrowUp size={14} /></button><button onClick={(e) => { e.stopPropagation(); onMove(index, 1); }} disabled={index === total - 1} title="Move down"><ArrowDown size={14} /></button><button onClick={(e) => { e.stopPropagation(); onRemove(section.id); }} title="Remove"><Trash2 size={14} /></button></div>
    </div>
  );
}

function Blueprint({ sections, selectedBlock, onSelect }: { sections: Section[]; selectedBlock: string; onSelect: (id: string) => void }) {
  const [zoom, setZoom] = useState(80);
  return (
    <div className="blueprint-wrap">
      <div className="blueprint-toolbar"><div className="flex items-center gap-2"><span className="status-pill"><span className="live-dot" />Blueprint</span><span className="text-[11px] text-slate-400">Desktop · 1440px</span></div><div className="flex items-center gap-1 text-slate-400"><button onClick={() => setZoom((value) => Math.max(50, value - 10))} className="zoom-button" title="Zoom out">−</button><span className="px-1 text-[10px] font-semibold">{zoom}%</span><button onClick={() => setZoom((value) => Math.min(120, value + 10))} className="zoom-button" title="Zoom in">+</button></div></div>
      <div className="blueprint-canvas">
        <div className="canvas-ruler left-ruler"><span>0</span><span>240</span><span>480</span><span>720</span><span>960</span></div>
        <div className="site-wireframe" style={{ transform: `scale(${zoom / 80})`, transformOrigin: "top left", marginBottom: `${Math.max(30, (zoom / 80) * 30)}px` }}>
          {sections.map((section, index) => <button key={section.id} onClick={() => onSelect(section.id)} className={cn("wire-block", section.id === selectedBlock && "wire-block-selected", `wire-${section.id}`)}><span className="wire-number">{String(index + 1).padStart(2, "0")}</span><span className="wire-title">{section.name}</span><span className="wire-lines"><i /><i /><i /></span>{section.id === selectedBlock && <span className="selected-label">Selected</span>}</button>)}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-[#eef0f3] px-4 py-3"><span className="flex items-center gap-2 text-[11px] text-slate-400"><Grid2X2 size={14} />Click a section to inspect</span><button className="text-[11px] font-semibold text-indigo-500 hover:text-indigo-700" onClick={() => toast("Drag-and-drop canvas is ready in Build mode")}>Open builder <ChevronRight size={13} className="inline" /></button></div>
    </div>
  );
}

function Checklist({ checklist, setChecklist }: { checklist: Record<string, boolean>; setChecklist: (value: Record<string, boolean>) => void }) {
  const items = [{ id: "headline", label: "A clear headline", meta: "Make the promise specific" }, { id: "proof", label: "Proof of value", meta: "Why should they believe you?" }, { id: "services", label: "Your core services", meta: "Name the transformation" }, { id: "cta", label: "A next step", meta: "Tell them what to do next" }];
  const complete = Object.values(checklist).filter(Boolean).length;
  return <div className="card p-5"><div className="flex items-center justify-between"><div><div className="eyebrow text-slate-400">Content checklist</div><h3 className="mt-2 font-display text-[17px] font-semibold text-slate-800">Give every section a job.</h3></div><div className="check-progress"><span>{complete}/4</span><div className="progress-track"><i style={{ width: `${complete * 25}%` }} /></div></div></div><div className="mt-5 space-y-3">{items.map((item) => <button key={item.id} onClick={() => setChecklist({ ...checklist, [item.id]: !checklist[item.id] })} className="check-item"><span className={cn("check-circle", checklist[item.id] && "check-circle-done")}>{checklist[item.id] && <Check size={12} strokeWidth={3} />}</span><span className="text-left"><span className={cn("block text-[12px] font-semibold", checklist[item.id] ? "text-slate-400 line-through" : "text-slate-700")}>{item.label}</span><span className="mt-0.5 block text-[10px] text-slate-400">{item.meta}</span></span></button>)}</div></div>;
}

function PlanView({ project, setProject, onGenerate, onOpenBuilder, onRenameProject, onDeleteProject }: { project: ProjectState; setProject: (project: ProjectState) => void; onGenerate: () => void; onOpenBuilder: () => void; onRenameProject: () => void; onDeleteProject: () => void }) {
  const [newSection, setNewSection] = useState("");
  const recommendedCount = project.sections.filter((item) => item.status === "recommended").length;
  const move = (index: number, direction: number) => { const next = [...project.sections]; const target = index + direction; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; setProject({ ...project, sections: next }); };
  const remove = (id: string) => { setProject({ ...project, sections: project.sections.filter((item) => item.id !== id) }); toast("Section removed from your plan"); };
  const addSection = () => { if (!newSection) return; const id = newSection.toLowerCase().replace(/[^a-z]+/g, "-"); setProject({ ...project, sections: [...project.sections, { id, name: newSection, description: "A flexible section for your story", status: "added", icon: "+" }] }); setNewSection(""); toast(`${newSection} added to your plan`); };
  return <div className="space-y-6 pb-12"><div className="page-heading"><div><div className="eyebrow text-indigo-500">Plan workspace <span className="mx-2 text-slate-300">/</span> 01</div><h1 className="mt-2 font-display text-[32px] font-semibold tracking-[-0.04em] text-slate-900 sm:text-[40px]">Shape the story<br /><em>before</em> you shape the site.</h1><p className="mt-3 max-w-[540px] text-sm leading-relaxed text-slate-500">A focused plan gives every page a point of view. Start with the essentials, then make the experience unmistakably yours.</p></div><div className="heading-actions"><button className="button-secondary"><Undo2 size={14} />Undo</button><button className="button-secondary"><Redo2 size={14} />Redo</button></div></div>
    <div className="grid gap-5 xl:grid-cols-[1.06fr_1.42fr_1fr]">
      <div className="space-y-5"><div className="card project-summary p-5"><div className="flex items-start justify-between"><div><div className="eyebrow text-slate-400">Current project</div><h2 className="mt-2 font-display text-[23px] font-semibold text-slate-800">{project.projectName}</h2><p className="mt-1 text-xs text-slate-400">{project.projectType} <span className="mx-1 text-slate-300">·</span> Draft</p></div><button onClick={onRenameProject} className="icon-button text-slate-400" title="Rename project"><MoreHorizontal size={18} /></button><button onClick={onDeleteProject} className="icon-button text-slate-400" title="Delete project"><Trash2 size={15} /></button></div><div className="mt-5 rounded-xl bg-[#f5f6f8] p-3.5"><div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400"><Gauge size={13} /> Goal</div><p className="mt-2 text-[12px] font-medium leading-relaxed text-slate-600">{project.purpose}</p></div><div className="mt-4 flex items-center gap-2"><div className="flex -space-x-1.5"><span className="mini-avatar bg-[#f6d8bd]">AM</span><span className="mini-avatar bg-[#ccd9f7]">SK</span></div><span className="text-[11px] text-slate-400">Personal workspace</span></div></div>
        <div className="ai-card"><div className="ai-glow" /><div className="relative"><div className="flex items-center justify-between"><div className="flex items-center gap-2 text-indigo-100"><div className="ai-icon"><WandSparkles size={14} /></div><span className="eyebrow text-indigo-200">AI site starter</span></div><span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-200/60">Beta</span></div><h3 className="mt-4 font-display text-[19px] font-semibold leading-tight text-white">Start from a direction,<br />not a blank page.</h3><p className="mt-2 text-[11px] leading-relaxed text-indigo-100/65">Describe the feeling, audience, or ambition. SiteSketch will turn it into a structured first draft you can edit.</p><textarea value={project.prompt} onChange={(e) => setProject({ ...project, prompt: e.target.value })} className="ai-textarea mt-4" rows={3} /><button onClick={onGenerate} className="button-ai mt-3 w-full justify-center"><Sparkles size={14} />Generate starting point</button></div></div></div>
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
  const [project, setProject] = useState<ProjectState>(() => { try { const saved = window.localStorage.getItem("sitesketch-project"); return saved ? JSON.parse(saved) : defaultProject; } catch { return defaultProject; } });
  const projectsQuery = trpc.projects.list.useQuery(undefined, { enabled: Boolean(user) });
  const createProject = trpc.projects.create.useMutation();
  const updateProject = trpc.projects.update.useMutation();
  const renameProject = trpc.projects.rename.useMutation();
  const deleteProject = trpc.projects.delete.useMutation();
  const saveEditor = trpc.projects.editor.save.useMutation();
  const generateAI = trpc.ai.generate.useMutation();
  const projectProgress = useMemo(() => Math.min(100, Math.round((project.sections.length / 7) * 100)), [project.sections.length]);

  useEffect(() => {
    if (!user) { window.localStorage.setItem("sitesketch-project", JSON.stringify(project)); return; }
    const first = projectsQuery.data?.[0];
    if (first && !projectId && !hasChosenProject) {
      setProjectId(first.id);
      setHasChosenProject(true);
      setEditorSectionIds(first.sections.map((section) => section.id));
      setIgnoreRemoteEditorData(false);
      setProject({ projectName: first.projectName, projectType: first.projectType, purpose: first.purpose, prompt: first.prompt, sections: first.sections, checklist: first.checklist, selectedBlock: first.selectedBlock });
    }
  }, [user, projectsQuery.data, projectId, hasChosenProject]);

  const saveProject = () => {
    if (!user) { window.localStorage.setItem("sitesketch-project", JSON.stringify(project)); toast.success("Project saved locally", { description: "Sign in to persist this project to the SiteSketch database." }); return; }
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
  return <div className="app-shell"><Sidebar mode={mode} setMode={setMode} project={project} onNew={newProject} user={user} projects={savedProjects} activeProjectId={projectId} onOpenProject={openProject} onRenameProject={renameProjectById} onDeleteProject={deleteProjectById} /><div className="main-shell lg:pl-[252px]"><Topbar mode={mode} setMode={setMode} project={project} onSave={saveProject} user={user} onLogout={() => logout().then(() => { setProjectId(undefined); setEditorData({}); toast.success("Signed out"); }).catch((error) => toast.error("Sign out failed", { description: error.message }))} /><main className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8 lg:px-10 lg:py-10">{mode === "plan" && <PlanView project={project} setProject={setProject} onGenerate={generate} onOpenBuilder={() => setMode("build")} onRenameProject={renameCurrentProject} onDeleteProject={() => projectId ? deleteProjectById(projectId) : toast("Save this project before deleting it")} />}{mode === "build" && <BuildView projectId={projectId} editorSectionIds={editorSectionIds} generatedSections={generatedSections} ignoreRemoteData={ignoreRemoteEditorData} editorResetKey={editorResetKey} />}{mode === "preview" && <PreviewView project={project} setMode={setMode} />}</main><div className="mobile-bottom-nav lg:hidden"><button className={cn(mode === "plan" && "mobile-nav-active")} onClick={() => setMode("plan")}><LayoutDashboard size={17} /><span>Plan</span></button><button className={cn(mode === "build" && "mobile-nav-active")} onClick={() => setMode("build")}><Blocks size={17} /><span>Build</span></button><button className={cn(mode === "preview" && "mobile-nav-active")} onClick={() => setMode("preview")}><Eye size={17} /><span>Preview</span></button></div></div><div className="fixed bottom-5 right-5 hidden items-center gap-2 rounded-full bg-[#131b31] px-3 py-2 text-[10px] font-semibold text-slate-300 shadow-xl lg:flex"><span className="live-dot" />{projectProgress}% planned <span className="ml-1 text-slate-500">·</span> <CircleHelp size={13} /></div>{projectDialog && <ProjectDialog mode={projectDialog.mode} value={projectDialogValue} setValue={setProjectDialogValue} onCancel={closeProjectDialog} onConfirm={confirmProjectDialog} />}</div>;
}
