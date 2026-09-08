import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserProject, deleteUserProject, getOwnedProject, listUserProjects, loadEditorData, saveEditorData, updateUserProject } from "./sitesketch";

const runDatabaseTests = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL);

describe.skipIf(!runDatabaseTests)("project ownership integration", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const ownerId = 900000 + Math.floor(Math.random() * 9999);
  const otherUserId = ownerId + 1;
  const openIds = [`ownership-owner-${randomUUID()}`, `ownership-other-${randomUUID()}`];
  let projectId = 0;

  beforeAll(async () => {
    await pool.query("INSERT INTO users (id, \"openId\", name, email, role) VALUES ($1, $2, 'Ownership Owner', $3, 'user'), ($4, $5, 'Ownership Other', $6, 'user') ON CONFLICT (\"openId\") DO NOTHING", [
      ownerId, openIds[0], `${openIds[0]}@example.com`, otherUserId, openIds[1], `${openIds[1]}@example.com`,
    ]);
    const created = await createUserProject(ownerId, {
      projectName: "Ownership test project",
      projectType: "Portfolio",
      purpose: "Showcase work and build credibility",
      prompt: "A private ownership integration test project",
      sections: [{ id: "hero", name: "Hero", description: "Lead section", status: "recommended", icon: "✦" }],
      checklist: { headline: true },
      selectedBlock: "hero",
    });
    projectId = created.id;
  });

  afterAll(async () => {
    if (projectId) await deleteUserProject(ownerId, projectId);
    await pool.query('DELETE FROM users WHERE "openId" = ANY($1)', [openIds]);
    await pool.end();
  });

  it("only lists and loads projects for the owning user", async () => {
    expect((await listUserProjects(ownerId)).some(project => project.id === projectId)).toBe(true);
    expect((await listUserProjects(otherUserId)).some(project => project.id === projectId)).toBe(false);
    expect(await getOwnedProject(otherUserId, projectId)).toBeUndefined();
    expect(await loadEditorData(otherUserId, projectId)).toBeUndefined();
  });

  it("rejects mutations and editor saves from another user", async () => {
    const state = (await listUserProjects(ownerId))[0];
    expect(await updateUserProject(otherUserId, projectId, state)).toBe(false);
    expect(await saveEditorData(otherUserId, projectId, { pages: [] })).toBe(false);
    expect(await deleteUserProject(otherUserId, projectId)).toBe(false);
    expect(await getOwnedProject(ownerId, projectId)).toBeTruthy();
  });
});
