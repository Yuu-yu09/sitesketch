import { describe, expect, it } from "vitest";
import { aiPromptSchema, projectStateSchema, websiteSpecSchema } from "./sitesketch";
import { recommendSections } from "../client/src/features/workspace/model";

describe("SiteSketch structured data validation", () => {
  it("accepts an editable project state", () => {
    const result = projectStateSchema.safeParse({
      projectName: "Northstar Studio",
      projectType: "Creative agency",
      purpose: "Turn interest into conversations",
      prompt: "A clear editorial studio site",
      sections: [{ id: "hero", name: "Hero", description: "Lead with a focused promise", status: "recommended", icon: "✦" }],
      checklist: { headline: true, cta: false },
      selectedBlock: "hero",
    });
    expect(result.success).toBe(true);
  });

  it("returns deterministic planning recommendations for common site types", () => {
    expect(recommendSections("Restaurant", "Help visitors book a service").map(section => section.id)).toEqual([
      "nav", "hero", "services", "proof", "contact", "footer",
    ]);
    expect(recommendSections("SaaS product", "Drive signups").map(section => section.id)).toContain("process");
  });

  it("rejects malformed or uncontrolled AI website specifications", () => {
    const result = websiteSpecSchema.safeParse({
      site_type: "restaurant",
      purpose: "attract customers",
      theme: "modern",
      pages: [{ name: "Home", sections: ["hero", "<script>alert(1)</script>"] }],
    });
    expect(result.success).toBe(false);
  });

  it("requires at least one page and one section per page", () => {
    expect(websiteSpecSchema.safeParse({ site_type: "portfolio", purpose: "show work", theme: "quiet", pages: [] }).success).toBe(false);
    expect(websiteSpecSchema.safeParse({ site_type: "portfolio", purpose: "show work", theme: "quiet", pages: [{ name: "Home", sections: [] }] }).success).toBe(false);
  });

  it("rejects ambiguous AI prompts and duplicate generated content", () => {
    expect(aiPromptSchema.safeParse("   ").success).toBe(false);
    const duplicateSections = websiteSpecSchema.safeParse({
      site_type: "portfolio",
      purpose: "show work",
      theme: "quiet",
      pages: [{
        name: "Home",
        sections: [
          { id: "hero", name: "Hero", eyebrow: "", title: "One", body: "", cta: "", background: "#17213d", foreground: "#fff7ed", accent: "#f0b66d", layout: "simple" },
          { id: "hero", name: "Hero again", eyebrow: "", title: "Two", body: "", cta: "", background: "#17213d", foreground: "#fff7ed", accent: "#f0b66d", layout: "simple" },
        ],
      }],
    });
    expect(duplicateSections.success).toBe(false);
  });

  it("accepts generated section copy and safe visual direction", () => {
    const result = websiteSpecSchema.safeParse({
      site_type: "ceramic studio",
      purpose: "book workshops and sell handmade pieces",
      theme: "playful premium",
      pages: [{ name: "Home", sections: [{ id: "hero", name: "Hero", eyebrow: "MADE BY HAND", title: "Make room for the handmade.", body: "Join a weekend workshop or take home a piece with a story.", cta: "Book a workshop", background: "#17213d", foreground: "#fff7ed", accent: "#f0b66d", layout: "split" }] }],
    });
    expect(result.success).toBe(true);
  });
});
