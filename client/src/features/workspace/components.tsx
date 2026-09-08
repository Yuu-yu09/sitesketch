import { useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronRight, Grid2X2, Move, MoreHorizontal, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { WorkspaceSection } from "./model";

const cn = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");

export function ProjectDialog({ mode, value, setValue, onCancel, onConfirm }: {
  mode: "rename" | "delete";
  value: string;
  setValue: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return <div className="project-dialog-backdrop" role="presentation"><div className="project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title"><button onClick={onCancel} className="project-dialog-close" title="Close"><X size={16} /></button><div className="eyebrow text-indigo-500">Project action</div><h2 id="project-dialog-title" className="mt-2 font-display text-[20px] font-semibold text-slate-800">{mode === "rename" ? "Rename project" : "Delete project"}</h2><p className="mt-2 text-xs leading-relaxed text-slate-500">{mode === "rename" ? "Choose a clear name so you can find this project again." : "This permanently removes the project, pages, and saved editor data."}</p>{mode === "rename" ? <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onConfirm(); }} className="dialog-input mt-5" placeholder="Project name" /> : <div className="mt-5 rounded-lg bg-[#fff6f5] p-3 text-xs font-medium text-[#a45149]">{value}</div>}<div className="mt-6 flex justify-end gap-2"><button onClick={onCancel} className="button-secondary">Cancel</button><button onClick={onConfirm} className={mode === "delete" ? "button-danger" : "button-primary"}>{mode === "rename" ? "Save name" : "Delete project"}</button></div></div></div>;
}

export function SectionRow({ section, index, total, onMove, onRemove, onSelect }: {
  section: WorkspaceSection;
  index: number;
  total: number;
  onMove: (index: number, direction: number) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  return <div onClick={() => onSelect(section.id)} className="section-row group"><div className="drag-handle"><Move size={15} /></div><div className={cn("section-icon", section.id === "hero" && "section-icon-highlight")}>{section.icon}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-[13px] font-semibold text-slate-700">{section.name}</span>{section.status === "recommended" && <span className="chip-recommended">Recommended</span>}</div><p className="mt-0.5 truncate text-[11px] text-slate-400">{section.description}</p></div><div className="section-actions opacity-0 transition-opacity group-hover:opacity-100"><button onClick={(event) => { event.stopPropagation(); onMove(index, -1); }} disabled={index === 0} title="Move up"><ArrowUp size={14} /></button><button onClick={(event) => { event.stopPropagation(); onMove(index, 1); }} disabled={index === total - 1} title="Move down"><ArrowDown size={14} /></button><button onClick={(event) => { event.stopPropagation(); onRemove(section.id); }} title="Remove"><Trash2 size={14} /></button></div></div>;
}

export function Blueprint({ sections, selectedBlock, onSelect }: { sections: WorkspaceSection[]; selectedBlock: string; onSelect: (id: string) => void }) {
  const [zoom, setZoom] = useState(80);
  return <div className="blueprint-wrap"><div className="blueprint-toolbar"><div className="flex items-center gap-2"><span className="status-pill"><span className="live-dot" />Blueprint</span><span className="text-[11px] text-slate-400">Desktop · 1440px</span></div><div className="flex items-center gap-1 text-slate-400"><button onClick={() => setZoom((value) => Math.max(50, value - 10))} className="zoom-button" title="Zoom out">−</button><span className="px-1 text-[10px] font-semibold">{zoom}%</span><button onClick={() => setZoom((value) => Math.min(120, value + 10))} className="zoom-button" title="Zoom in">+</button></div></div><div className="blueprint-canvas"><div className="canvas-ruler left-ruler"><span>0</span><span>240</span><span>480</span><span>720</span><span>960</span></div><div className="site-wireframe" style={{ transform: `scale(${zoom / 80})`, transformOrigin: "top left", marginBottom: `${Math.max(30, (zoom / 80) * 30)}px` }}>{sections.map((section, index) => <button key={section.id} onClick={() => onSelect(section.id)} className={cn("wire-block", section.id === selectedBlock && "wire-block-selected", `wire-${section.id}`)}><span className="wire-number">{String(index + 1).padStart(2, "0")}</span><span className="wire-title">{section.name}</span><span className="wire-lines"><i /><i /><i /></span>{section.id === selectedBlock && <span className="selected-label">Selected</span>}</button>)}</div></div><div className="flex items-center justify-between border-t border-[#eef0f3] px-4 py-3"><span className="flex items-center gap-2 text-[11px] text-slate-400"><Grid2X2 size={14} />Click a section to inspect</span><button className="text-[11px] font-semibold text-indigo-500 hover:text-indigo-700" onClick={() => toast("Drag-and-drop canvas is ready in Build mode")}>Open builder <ChevronRight size={13} className="inline" /></button></div></div>;
}

export function Checklist({ checklist, setChecklist }: { checklist: Record<string, boolean>; setChecklist: (value: Record<string, boolean>) => void }) {
  const items = [{ id: "headline", label: "A clear headline", meta: "Make the promise specific" }, { id: "proof", label: "Proof of value", meta: "Why should they believe you?" }, { id: "services", label: "Your core services", meta: "Name the transformation" }, { id: "cta", label: "A next step", meta: "Tell them what to do next" }];
  const complete = Object.values(checklist).filter(Boolean).length;
  return <div className="card p-5"><div className="flex items-center justify-between"><div><div className="eyebrow text-slate-400">Content checklist</div><h3 className="mt-2 font-display text-[17px] font-semibold text-slate-800">Give every section a job.</h3></div><div className="check-progress"><span>{complete}/4</span><div className="progress-track"><i style={{ width: `${complete * 25}%` }} /></div></div></div><div className="mt-5 space-y-3">{items.map((item) => <button key={item.id} onClick={() => setChecklist({ ...checklist, [item.id]: !checklist[item.id] })} className="check-item"><span className={cn("check-circle", checklist[item.id] && "check-circle-done")}>{checklist[item.id] && <Check size={12} strokeWidth={3} />}</span><span className="text-left"><span className={cn("block text-[12px] font-semibold", checklist[item.id] ? "text-slate-400 line-through" : "text-slate-700")}>{item.label}</span><span className="mt-0.5 block text-[10px] text-slate-400">{item.meta}</span></span></button>)}</div></div>;
}
