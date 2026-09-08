export type WorkspaceMode = "plan" | "build" | "preview";

export type WorkspaceSection = {
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

export type ProjectState = {
  projectName: string;
  projectType: string;
  purpose: string;
  prompt: string;
  sections: WorkspaceSection[];
  checklist: Record<string, boolean>;
  selectedBlock: string;
};

export const projectTypeOptions = [
  "Creative agency",
  "Portfolio",
  "SaaS product",
  "Restaurant",
  "Consultant",
  "Online store",
] as const;

export const purposeOptions = [
  "Turn interest into qualified conversations",
  "Showcase work and build credibility",
  "Explain a product and drive signups",
  "Help visitors book a service",
  "Sell products online",
] as const;

export const initialSections: WorkspaceSection[] = [
  { id: "nav", name: "Navigation", description: "Clear wayfinding for every page", status: "recommended", icon: "≡" },
  { id: "hero", name: "Hero", description: "Lead with a focused value proposition", status: "recommended", icon: "✦" },
  { id: "proof", name: "Social proof", description: "Build confidence with customer signals", status: "recommended", icon: "◌" },
  { id: "services", name: "Services", description: "Show the ways you create value", status: "recommended", icon: "▦" },
  { id: "process", name: "Process", description: "Make the next step feel simple", status: "recommended", icon: "↗" },
  { id: "contact", name: "Contact", description: "A direct path to start a conversation", status: "recommended", icon: "⌁" },
  { id: "footer", name: "Footer", description: "Close with confidence and context", status: "recommended", icon: "—" },
];

export const defaultProject: ProjectState = {
  projectName: "Northstar Studio",
  projectType: "Creative agency",
  purpose: "Turn interest into qualified conversations",
  prompt: "A confident, editorial site for a small strategy studio helping ambitious teams find their next clear move.",
  sections: initialSections,
  checklist: { headline: true, proof: true, services: false, cta: false },
  selectedBlock: "hero",
};

export const sectionOptions = ["Testimonials", "FAQ", "Pricing", "Gallery", "Case studies", "Opening hours"];

const recommendationRules: Array<{ match: RegExp; sectionIds: string[] }> = [
  { match: /restaurant|food|cafe|bar/i, sectionIds: ["nav", "hero", "services", "proof", "contact", "footer"] },
  { match: /portfolio|showcase|work/i, sectionIds: ["nav", "hero", "proof", "services", "contact", "footer"] },
  { match: /saas|product|software|signup/i, sectionIds: ["nav", "hero", "proof", "services", "process", "contact", "footer"] },
  { match: /store|shop|sell|commerce/i, sectionIds: ["nav", "hero", "services", "proof", "contact", "footer"] },
];

export function recommendSections(projectType: string, purpose: string): WorkspaceSection[] {
  const rule = recommendationRules.find(({ match }) => match.test(`${projectType} ${purpose}`));
  const ids = rule?.sectionIds ?? initialSections.map(section => section.id);
  return ids.map(id => initialSections.find(section => section.id === id)).filter((section): section is WorkspaceSection => Boolean(section));
}

export function cloneProject(project: ProjectState): ProjectState {
  return {
    ...project,
    sections: project.sections.map(section => ({ ...section })),
    checklist: { ...project.checklist },
  };
}
