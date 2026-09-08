import { useEffect, useMemo, useRef, useState } from "react";
import grapesjs, { type Editor } from "grapesjs";
import "grapesjs/dist/css/grapes.min.css";
import "@/grapesjs-overrides.css";
import { ChevronDown, MoreHorizontal, Save, Sparkles, Undo2, Redo2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { GeneratedSection } from "@/features/workspace/model";

type SiteSketchEditorProps = {
  projectId?: number;
  initialSectionIds?: string[];
  generatedSections?: GeneratedSection[];
  ignoreRemoteData?: boolean;
  onDataChange?: (data: Record<string, unknown>) => void;
};

const starterHtml = `
  <main class="ss-site">
    <nav class="ss-nav"><div class="ss-logo"><span>n</span> northstar</div><div class="ss-links"><a>Approach</a><a>Capabilities</a><a>About</a></div><button class="ss-pill">Let's talk →</button></nav>
    <section class="ss-hero"><div class="ss-eyebrow">STRATEGY, MADE VISIBLE</div><h1>Make your next move obvious.</h1><p>A clear website turns good ideas into momentum. Shape the story, then build the experience around it.</p><a class="ss-link">Explore the approach →</a></section>
    <section class="ss-proof"><div class="ss-eyebrow">TRUST COMPOUNDS</div><h2>The shortcut is clarity.</h2><p>Northstar gave us the language to make a complicated idea feel simple.</p></section>
    <section class="ss-services"><div class="ss-eyebrow">HOW WE HELP</div><h2>A system for the next chapter.</h2><div class="ss-service-grid"><div>Strategic clarity →</div><div>Brand systems →</div><div>Digital direction →</div></div></section>
    <footer class="ss-footer">northstar studio <span>New York · Everywhere</span></footer>
  </main>`;

const starterCss = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #161d38; color: #fff; font-family: Arial, sans-serif; }
  .ss-site { min-height: 100vh; background: #161d38; }
  .ss-nav { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 22px 7%; border-bottom: 1px solid rgba(255,255,255,.1); }
  .ss-logo { font-size: 14px; font-weight: 700; letter-spacing: .03em; }.ss-logo span { display: inline-flex; align-items:center; justify-content:center; width: 20px; height: 20px; margin-right: 6px; border-radius: 5px; background:#cad0ff; color:#293167; }
  .ss-links { display:flex; gap: 30px; color:#9ca7ca; font-size:11px; }.ss-links a, .ss-link { color: inherit; text-decoration: none; }
  .ss-pill { border: 1px solid rgba(216,220,255,.4); border-radius: 99px; background: transparent; padding: 8px 12px; color: #e8ebff; font-size: 10px; }
  .ss-hero { min-height: 430px; padding: 110px 12% 85px; background: radial-gradient(circle at 80% 18%, rgba(105,119,239,.38), transparent 24%), linear-gradient(135deg,#242c5d,#161d38); }
  .ss-eyebrow { color:#a5aef1; font-family: monospace; font-size:10px; letter-spacing:.16em; }.ss-hero h1 { max-width: 650px; margin: 18px 0; font-size: clamp(38px, 6vw, 72px); line-height: .98; letter-spacing: -.06em; }.ss-hero p { max-width: 440px; color:#b7bfd9; font-size:13px; line-height:1.6; }.ss-link { display:inline-block; margin-top:20px; border-bottom:1px solid #b5bafd; padding-bottom:4px; font-size:11px; }
  .ss-proof, .ss-services { padding: 85px 12%; background:#f4f0e9; color:#222943; }.ss-proof h2, .ss-services h2 { max-width: 450px; margin:16px 0; font-size: clamp(30px, 4vw, 52px); line-height:1; letter-spacing:-.06em; }.ss-proof p { max-width: 390px; color:#6f6c69; font-size:22px; line-height:1.2; }.ss-services { background:#fbfbfd; }.ss-service-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:30px; }.ss-service-grid div { border:1px solid #e4e6ed; border-radius:6px; padding:17px 12px; color:#536078; font-size:11px; }
  .ss-footer { display:flex; justify-content:space-between; padding:25px 12%; background:#fff; color:#8490a0; font-family:monospace; font-size:10px; }
`;

const blocks = [
  { id: "ss-navbar", label: "Navigation", category: "SiteSketch", content: `<nav class="ss-nav"><div class="ss-logo"><span>n</span> northstar</div><div class="ss-links"><a>Approach</a><a>Capabilities</a><a>About</a></div><button class="ss-pill">Let's talk →</button></nav>` },
  { id: "ss-hero", label: "Hero", category: "SiteSketch", content: `<section class="ss-hero"><div class="ss-eyebrow">STRATEGY, MADE VISIBLE</div><h1>Make your next move obvious.</h1><p>A clear website turns good ideas into momentum.</p><a class="ss-link">Explore the approach →</a></section>` },
  { id: "ss-services", label: "Services", category: "SiteSketch", content: `<section class="ss-services"><div class="ss-eyebrow">HOW WE HELP</div><h2>A system for the next chapter.</h2><div class="ss-service-grid"><div>Strategic clarity →</div><div>Brand systems →</div><div>Digital direction →</div></div></section>` },
  { id: "ss-testimonials", label: "Testimonials", category: "SiteSketch", content: `<section class="ss-proof"><div class="ss-eyebrow">TRUST COMPOUNDS</div><h2>The shortcut is clarity.</h2><p>Northstar gave us the language to make a complicated idea feel simple.</p></section>` },
  { id: "ss-contact", label: "Contact", category: "SiteSketch", content: `<section class="ss-services"><div class="ss-eyebrow">START A CONVERSATION</div><h2>Ready when you are.</h2><a class="ss-link">Let's talk →</a></section>` },
  { id: "ss-footer", label: "Footer", category: "SiteSketch", content: `<footer class="ss-footer">northstar studio <span>New York · Everywhere</span></footer>` },
];

const sectionBlockMap: Record<string, string> = { nav: "ss-navbar", navbar: "ss-navbar", hero: "ss-hero", about: "ss-proof", proof: "ss-proof", services: "ss-services", features: "ss-services", cards: "ss-services", testimonials: "ss-testimonials", gallery: "ss-testimonials", contact: "ss-contact", footer: "ss-footer" };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
const generatedSectionHtml = (section: GeneratedSection, index: number) => {
  const id = `ai-${section.id}-${index}`;
  const body = section.layout === "grid" ? `<div class="ss-generated-grid"><span>${escapeHtml(section.cta || "Explore the collection")}</span><span>${escapeHtml(section.name)}</span><span>Made for your next step</span></div>` : `<p>${escapeHtml(section.body)}</p><a class="ss-generated-cta">${escapeHtml(section.cta || "Learn more")} →</a>`;
  return `<section id="${id}" class="ss-generated ss-generated-${section.layout}" style="--ss-bg:${section.background};--ss-fg:${section.foreground};--ss-accent:${section.accent};"><div class="ss-generated-inner"><div class="ss-eyebrow">${escapeHtml(section.eyebrow)}</div><h2>${escapeHtml(section.title)}</h2>${body}</div></section>`;
};
const generatedSectionCss = (sections: GeneratedSection[]) => sections.map((section, index) => `.ss-generated-${section.layout}-${index} { background:${section.background}; color:${section.foreground}; }`).join("\n");

export default function SiteSketchEditor({ projectId, initialSectionIds = ["nav", "hero", "proof", "services", "contact", "footer"], generatedSections = [], ignoreRemoteData = false, onDataChange }: SiteSketchEditorProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const isHydratingRef = useRef(false);
  const [activeDevice, setActiveDevice] = useState("Desktop");
  const [isReady, setIsReady] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const remoteEditor = trpc.projects.editor.load.useQuery({ id: projectId ?? 0 }, { enabled: Boolean(projectId) });
  const saveEditor = trpc.projects.editor.save.useMutation({
    onSuccess: () => { setHasChanges(false); toast.success("Editor saved", { description: "Your editable GrapesJS project data is stored in the database." }); },
    onError: (error) => toast.error("Editor save failed", { description: error.message }),
  });

  const currentData = useMemo(() => !ignoreRemoteData && remoteEditor.data && Object.keys(remoteEditor.data).length > 0 ? remoteEditor.data : undefined, [ignoreRemoteData, remoteEditor.data]);
  const initialHtml = useMemo(() => {
    const selectedBlocks = initialSectionIds.map((id) => sectionBlockMap[id]).filter(Boolean);
    const uniqueBlocks = Array.from(new Set(selectedBlocks));
    if (generatedSections.length > 0) return `<main class="ss-site ss-generated-site">${generatedSections.map(generatedSectionHtml).join("\n")}</main>`;
    return `<main class="ss-site">${uniqueBlocks.map((blockId) => blocks.find((block) => block.id === blockId)?.content ?? "").join("\n")}</main>`;
  }, [generatedSections, initialSectionIds]);

  useEffect(() => {
    if (!canvasRef.current || editorRef.current) return;
    const editor = grapesjs.init({
      container: canvasRef.current,
      height: "100%",
      width: "auto",
      fromElement: false,
      storageManager: false,
      selectorManager: { componentFirst: true },
      blockManager: { appendTo: "#sitesketch-blocks", blocks: [] },
      deviceManager: { devices: [{ id: "Desktop", name: "Desktop", width: "" }, { id: "Tablet", name: "Tablet", width: "768px", widthMedia: "992px" }, { id: "Mobile", name: "Mobile", width: "375px", widthMedia: "480px" }] },
      panels: { defaults: [] },
    });
    editor.addStyle(starterCss);
    if (generatedSections.length > 0) editor.addStyle(`.ss-generated { min-height: 280px; padding: 78px 12%; display:flex; align-items:center; } .ss-generated-inner { width:100%; max-width:820px; margin:0 auto; } .ss-generated h2 { max-width:760px; margin:16px 0; font-size:clamp(32px,5vw,66px); line-height:.98; letter-spacing:-.06em; } .ss-generated p { max-width:560px; color:color-mix(in srgb, var(--ss-fg) 72%, transparent); font-size:16px; line-height:1.6; } .ss-generated-cta { display:inline-block; margin-top:20px; border-bottom:2px solid var(--ss-accent); padding-bottom:5px; color:var(--ss-fg); font-weight:700; text-decoration:none; } .ss-generated-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-top:28px; } .ss-generated-grid span { border:1px solid color-mix(in srgb, var(--ss-fg) 25%, transparent); border-radius:12px; padding:20px; } .ss-generated-centered { text-align:center; } .ss-generated-centered .ss-generated-inner { max-width:720px; } .ss-generated-split:nth-child(even) .ss-generated-inner { margin-left:auto; margin-right:8%; } .ss-generated-quote { font-style:italic; }`);
    blocks.forEach(block => editor.BlockManager.add(block.id, { label: block.label, category: block.category, content: block.content, attributes: { class: "gjs-block-ss" } }));
    editor.setComponents(initialHtml || starterHtml);
    const emitData = () => {
      const data = editor.getProjectData() as Record<string, unknown>;
      onDataChange?.(data);
      if (!isHydratingRef.current) setHasChanges(true);
    };
    editor.on("update", emitData);
    editorRef.current = editor;
    setIsReady(true);
    return () => { editor.destroy(); editorRef.current = null; };
  }, [onDataChange]);

  useEffect(() => {
    if (!isReady || !editorRef.current || !currentData) return;
    isHydratingRef.current = true;
    editorRef.current.loadProjectData(currentData);
    onDataChange?.(currentData);
    setHasChanges(false);
    isHydratingRef.current = false;
  }, [currentData, isReady, onDataChange]);

  useEffect(() => {
    if (!isReady || !projectId || generatedSections.length === 0 || currentData || !editorRef.current) return;
    const data = editorRef.current.getProjectData() as Record<string, unknown>;
    onDataChange?.(data);
    saveEditor.mutate({ id: projectId, data });
  }, [currentData, generatedSections.length, isReady, onDataChange, projectId]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !isReady) return;
    editor.setDevice(activeDevice);
  }, [activeDevice, isReady]);

  const save = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const data = editor.getProjectData() as Record<string, unknown>;
    onDataChange?.(data);
    if (projectId) saveEditor.mutate({ id: projectId, data });
    else { setHasChanges(false); toast("Editor draft saved locally until you sign in"); }
  };

  return <div className="builder-shell grapesjs-shell">
    <aside className="builder-palette"><div className="palette-title"><span>Blocks</span><span className="font-mono text-[10px] text-slate-400">{isReady ? "LIVE" : "…"}</span></div><div id="sitesketch-blocks" className="palette-group grapesjs-blocks" /><div className="palette-tip"><Sparkles size={14} className="text-amber-400" /><div><div className="text-[11px] font-semibold text-slate-600">Drag to build</div><p className="mt-1 text-[10px] leading-relaxed text-slate-400">Drop a block onto the canvas, then edit its content and styles.</p></div></div></aside>
    <div className="builder-canvas-area"><div className="builder-toolbar"><div className="flex items-center gap-1 rounded-lg bg-[#f4f5f7] p-1">{["Desktop", "Tablet", "Mobile"].map(device => <button key={device} onClick={() => setActiveDevice(device)} className={`device-tab ${activeDevice === device ? "device-tab-active" : ""}`}>{device}</button>)}</div><div className="flex items-center gap-3 text-[11px] text-slate-400"><span>{hasChanges ? "Unsaved changes" : "Saved"}</span><button className="button-secondary px-2 py-1" onClick={save}><Save size={13} />Save</button><Undo2 size={15} /><Redo2 size={15} /><MoreHorizontal size={17} /></div></div><div ref={canvasRef} className="grapesjs-canvas" /></div>
    <aside className="builder-inspector"><div className="inspector-tabs"><button className="inspector-tab-active">Inspector</button><button>Styles</button></div><div className="inspector-section"><div className="eyebrow text-slate-400">Selected component</div><p className="mt-3 text-xs leading-relaxed text-slate-500">Select a block in the canvas to edit its text, spacing, colors, and responsive styles with GrapesJS.</p><div className="mt-4 rounded-lg bg-[#f6f7f9] p-3 text-[10px] leading-relaxed text-slate-500"><span className="font-semibold text-slate-700">Database-backed editor data</span><br />{projectId ? "Connected to this project." : "Sign in and save to persist it."}</div></div></aside>
  </div>;
}
