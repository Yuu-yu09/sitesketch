import { Check, ChevronRight, MoreHorizontal, Redo2, SquareArrowOutUpRight, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import SiteSketchEditor from "@/components/SiteSketchEditor";
import type { GeneratedSection, ProjectState, WorkspaceMode } from "./model";

type PreviewPage = { id: string; name: string; html: string; css: string };

function readPreviewPages(data: Record<string, unknown>): PreviewPage[] {
  if (!Array.isArray(data.pages)) return [];
  return data.pages.filter((page): page is PreviewPage =>
    Boolean(page) &&
    typeof page === "object" &&
    typeof (page as PreviewPage).id === "string" &&
    typeof (page as PreviewPage).name === "string" &&
    typeof (page as PreviewPage).html === "string" &&
    typeof (page as PreviewPage).css === "string",
  );
}

function createPreviewDocument(page: PreviewPage) {
  const html = page.html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/\son\w+="[^"]*"/gi, "");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${page.css}</style><style>html,body{margin:0;min-height:100%;}body{overflow-x:hidden;}a{cursor:pointer;}</style></head><body>${html}</body></html>`;
}

export function WorkspaceBuilder({ projectId, editorSectionIds, generatedSections, ignoreRemoteData, editorResetKey, onDataChange }: { projectId?: number; editorSectionIds: string[]; generatedSections: GeneratedSection[]; ignoreRemoteData: boolean; editorResetKey: number; onDataChange: (data: Record<string, unknown>) => void }) {
  return <div className="build-page"><div className="build-heading"><div><div className="eyebrow text-indigo-500">Visual builder <span className="mx-2 text-slate-300">/</span> 02</div><h1 className="mt-2 font-display text-[30px] font-semibold tracking-[-0.04em] text-slate-900">Make the plan tangible.</h1><p className="mt-2 max-w-[560px] text-xs leading-relaxed text-slate-500">Drag SiteSketch blocks onto the canvas, then edit the content and responsive styles directly in the visual editor.</p></div><div className="flex items-center gap-2"><button className="button-secondary" onClick={() => toast("Undo is available in the GrapesJS canvas toolbar")}><Undo2 size={14} /></button><button className="button-secondary" onClick={() => toast("Redo is available in the GrapesJS canvas toolbar")}><Redo2 size={14} /></button></div></div><SiteSketchEditor key={`${projectId ?? "draft"}-${editorResetKey}`} projectId={projectId} initialSectionIds={editorSectionIds} generatedSections={generatedSections} ignoreRemoteData={ignoreRemoteData} onDataChange={onDataChange} /></div>;
}

export function WorkspacePreview({ project, editorData, setMode }: { project: ProjectState; editorData: Record<string, unknown>; setMode: (mode: WorkspaceMode) => void }) {
  const pages = readPreviewPages(editorData);
  const [activePageId, setActivePageId] = useState(pages[0]?.id ?? "");
  const activePage = pages.find(page => page.id === activePageId) ?? pages[0];
  const sharePreview = () => {
    const url = `${window.location.origin}/dashboard?preview=${encodeURIComponent(project.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}`;
    navigator.clipboard.writeText(url).then(() => toast.success("Preview link copied to clipboard")).catch(() => toast.error("Preview link could not be copied"));
  };
  return <div className="space-y-6 pb-12"><div className="page-heading"><div><div className="eyebrow text-indigo-500">Live preview <span className="mx-2 text-slate-300">/</span> 03</div><h1 className="mt-2 font-display text-[32px] font-semibold tracking-[-0.04em] text-slate-900 sm:text-[40px]">See the story in motion.</h1><p className="mt-3 max-w-[500px] text-sm leading-relaxed text-slate-500">This preview renders the same saved HTML and CSS used by your visual builder.</p></div><div className="heading-actions"><span className="status-pill status-pill-light"><span className="live-dot" />{activePage ? "Live draft" : "Plan draft"}</span><button className="button-dark" onClick={sharePreview}><SquareArrowOutUpRight size={14} />Share preview</button></div></div><div className="preview-window"><div className="preview-browser"><div className="browser-dots"><i /><i /><i /></div><span className="browser-url">preview.sitesketch.local / {project.projectName.toLowerCase().replace(/ /g, "-")}</span><div className="flex items-center gap-2 text-slate-400"><span>↻</span><MoreHorizontal size={15} /></div></div>{pages.length > 0 && <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">{pages.map(page => <button key={page.id} onClick={() => setActivePageId(page.id)} className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${page.id === activePage?.id ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>{page.name}</button>)}</div>}{activePage ? <iframe title={`${project.projectName} ${activePage.name} preview`} sandbox="" srcDoc={createPreviewDocument(activePage)} className="h-[680px] w-full border-0 bg-white" /> : <div className="flex min-h-[520px] items-center justify-center bg-[#161d38] p-10 text-center text-white"><div><div className="preview-check mx-auto"><Check size={13} /></div><h2 className="mt-4 font-display text-3xl">Your plan is ready to build.</h2><p className="mt-3 max-w-md text-sm text-slate-300">Open the builder to create the first saved preview for this project.</p></div></div>}</div><div className="preview-bottom"><div className="flex items-center gap-3"><div className="preview-check"><Check size={13} /></div><div><div className="text-xs font-semibold text-slate-700">{activePage ? "Saved editor output is ready to refine" : "Your site is ready to build"}</div><div className="mt-0.5 text-[11px] text-slate-400">{activePage ? `${pages.length} saved page${pages.length === 1 ? "" : "s"} rendered from the builder.` : `${project.sections.length} planned sections are ready for the builder.`}</div></div></div><button onClick={() => setMode("build")} className="button-secondary">Edit in builder <ChevronRight size={14} /></button></div></div>;
}
