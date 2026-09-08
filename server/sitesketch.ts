import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import { invokeLLM } from "./_core/llm";
import { contentItems, pages, projectEditorData, projects } from "../drizzle/schema";

export const sectionSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  description: z.string().max(240),
  status: z.enum(["recommended", "added"]),
  icon: z.string().max(8),
});

export const projectStateSchema = z.object({
  projectName: z.string().min(1).max(180),
  projectType: z.string().min(1).max(120),
  purpose: z.string().min(1).max(240),
  prompt: z.string().max(4000),
  sections: z.array(sectionSchema).max(30),
  checklist: z.record(z.string().max(80), z.boolean()).refine(value => Object.keys(value).length <= 30),
  selectedBlock: z.string().min(1).max(80),
});

export const editorDataSchema = z.record(z.string(), z.unknown());

export const websiteSpecSchema = z.object({
  site_type: z.string().min(1).max(120),
  purpose: z.string().min(1).max(240),
  theme: z.string().min(1).max(80),
  pages: z.array(z.object({
    name: z.string().min(1).max(120),
    sections: z.array(z.object({
      id: z.string().min(1).max(80).regex(/^[a-z0-9_-]+$/),
      name: z.string().min(1).max(120),
      eyebrow: z.string().max(80),
      title: z.string().min(1).max(180),
      body: z.string().max(500),
      cta: z.string().max(80),
      background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      foreground: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      layout: z.enum(["split", "centered", "grid", "quote", "simple"]),
    })).min(1).max(20),
  })).min(1).max(8),
});

export type ProjectStateInput = z.infer<typeof projectStateSchema>;

const readJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const toProjectState = (project: typeof projects.$inferSelect): ProjectStateInput => ({
  projectName: project.name,
  projectType: project.projectType,
  purpose: project.purpose,
  prompt: project.prompt ?? "",
  sections: readJson(project.sectionsJson, []),
  checklist: readJson(project.checklistJson, {}),
  selectedBlock: project.selectedBlock,
});

export async function listUserProjects(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const rows = await db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.updatedAt)).limit(50);
  return rows.map(toProjectStateWithId);
}

function toProjectStateWithId(project: typeof projects.$inferSelect) {
  return { id: project.id, updatedAt: project.updatedAt, ...toProjectState(project) };
}

export async function getOwnedProject(userId: number, projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const rows = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId))).limit(1);
  return rows[0];
}

export async function createUserProject(userId: number, state: ProjectStateInput) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [created] = await db.insert(projects).values({
    userId,
    name: state.projectName,
    projectType: state.projectType,
    purpose: state.purpose,
    prompt: state.prompt,
    sectionsJson: JSON.stringify(state.sections),
    checklistJson: JSON.stringify(state.checklist),
    selectedBlock: state.selectedBlock,
  }).returning({ id: projects.id });
  if (!created?.id) throw new Error("Project could not be created");
  await db.insert(pages).values({ projectId: created.id, name: "Home", slug: "home", position: 0 });
  return { id: created.id };
}

export async function updateUserProject(userId: number, projectId: number, state: ProjectStateInput) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const owned = await getOwnedProject(userId, projectId);
  if (!owned) return false;
  await db.update(projects).set({
    name: state.projectName,
    projectType: state.projectType,
    purpose: state.purpose,
    prompt: state.prompt,
    sectionsJson: JSON.stringify(state.sections),
    checklistJson: JSON.stringify(state.checklist),
    selectedBlock: state.selectedBlock,
    updatedAt: new Date(),
  }).where(eq(projects.id, projectId));
  return true;
}

export async function renameUserProject(userId: number, projectId: number, name: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const owned = await getOwnedProject(userId, projectId);
  if (!owned) return false;
  await db.update(projects).set({ name: name.trim(), updatedAt: new Date() }).where(eq(projects.id, projectId));
  return true;
}

export async function deleteUserProject(userId: number, projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const owned = await getOwnedProject(userId, projectId);
  if (!owned) return false;
  await db.delete(contentItems).where(eq(contentItems.projectId, projectId));
  await db.delete(projectEditorData).where(eq(projectEditorData.projectId, projectId));
  await db.delete(pages).where(eq(pages.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
  return true;
}

export async function loadEditorData(userId: number, projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const owned = await getOwnedProject(userId, projectId);
  if (!owned) return undefined;
  const rows = await db.select().from(projectEditorData).where(eq(projectEditorData.projectId, projectId)).limit(1);
  return rows[0] ? readJson(rows[0].dataJson, {}) : {};
}

export async function saveEditorData(userId: number, projectId: number, data: Record<string, unknown>) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const owned = await getOwnedProject(userId, projectId);
  if (!owned) return false;
  const dataJson = JSON.stringify(data);
  await db.insert(projectEditorData).values({ projectId, dataJson, updatedAt: new Date() }).onConflictDoUpdate({
    target: projectEditorData.projectId,
    set: { dataJson, updatedAt: new Date() },
  });
  return true;
}

export async function generateWebsiteSpec(prompt: string) {
  let response;
  try {
    response = await invokeLLM({
    messages: [
      { role: "system", content: "You are SiteSketch's website planning assistant. Return only a valid structured website specification. Use short, practical section ids from this supported set when possible: navbar, hero, about, services, features, cards, gallery, testimonials, pricing, faq, contact, footer. For every section write original, specific copy for the user's business and a distinct visual direction. Colors must be six-digit hex values. Never return HTML, CSS, JavaScript, markdown, or arbitrary code." },
      { role: "user", content: `Create an editable website structure from this brief: ${prompt}` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "sitesketch_website_spec",
        strict: true,
        schema: {
          type: "object",
          properties: {
            site_type: { type: "string" },
            purpose: { type: "string" },
            theme: { type: "string" },
            pages: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  sections: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" }, name: { type: "string" }, eyebrow: { type: "string" }, title: { type: "string" }, body: { type: "string" }, cta: { type: "string" }, background: { type: "string" }, foreground: { type: "string" }, accent: { type: "string" }, layout: { type: "string" },
                      },
                      required: ["id", "name", "eyebrow", "title", "body", "cta", "background", "foreground", "accent", "layout"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["name", "sections"],
                additionalProperties: false,
              },
            },
          },
          required: ["site_type", "purpose", "theme", "pages"],
          additionalProperties: false,
        },
      },
    },
      max_tokens: 2200,
    });
  } catch (error) {
    console.error("[SiteSketch AI] LLM request failed", error);
    throw new Error(error instanceof Error ? error.message : "AI generation request failed");
  }
  const content = response.choices[0]?.message?.content;
  const text = Array.isArray(content) ? content.filter(part => part.type === "text").map(part => part.text).join("\n") : content;
  if (!text) {
    console.error("[SiteSketch AI] Empty structured response", response);
    throw new Error("AI returned an empty website specification");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (error) {
    console.error("[SiteSketch AI] Malformed JSON response", text.slice(0, 500), error);
    throw new Error("AI returned malformed website specification");
  }
  try { return websiteSpecSchema.parse(parsed); } catch (error) {
    console.error("[SiteSketch AI] Structured response failed validation", error);
    throw new Error("AI returned an invalid website specification; please try again with a more specific brief");
  }
}
