import { expect, test } from "@playwright/test";

test("user can register, save a project, save the editor, and open preview", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto("/");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByPlaceholder("Your name").fill("E2E User");
  await page.getByPlaceholder("Email address").fill(email);
  await page.getByPlaceholder("Password (8+ characters)").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Create my account" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Start with a new project" })).toBeVisible();
  await expect(page.getByText("Northstar Studio")).toHaveCount(0);

  await page.getByRole("button", { name: "Create new project" }).click();
  await expect(page.getByRole("heading", { name: "Let’s make your idea clear." })).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Project created")).toBeVisible();

  await page.getByRole("banner").getByRole("button", { name: "Edit site" }).click();
  await expect(page.locator(".grapesjs-canvas")).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: "Save" }).click();

  await page.getByRole("banner").getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("Saved editor output is ready to refine")).toBeVisible();
  await expect(page.locator("iframe[title*='Untitled project']")).toBeVisible();
});
