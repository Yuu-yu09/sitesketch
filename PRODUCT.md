# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Frontend: plain HTML, CSS, JavaScript (no framework) + SortableJS (drag-and-drop).
Backend: Python Flask.
Database: Supabase (Postgres + Storage) via server-side calls; auth password hashing Flask-side.
AI: Google Gemini API (server-side key only, template fallback on failure).
Deployment: Vercel free tier (serverless WSGI, `*.vercel.app` domain); version control on GitHub, edited in VS Code.
(All user-confirmed; see PLAN.md.)

## Users

- Primary: **students and beginners** who want to plan the structure of a website before it is designed or built.
- Primary: **small business owners** who need to identify the important sections and content their site should contain.
- Admin: **system administrator** who manages predefined website types and their recommended sections.

## Product Purpose

Make website planning approachable for people who do not know how to organize an idea into a proper website structure. Users pick a website type and purpose (or describe the site in one sentence and let AI draft it), receive recommended pages and sections, organize them in a drag-and-drop builder, see a visual blueprint and a content checklist, and save their projects. Extended scope (professor-approved): from that plan, automatically compile a complete working multi-page website and publish it to a live URL. Success = a beginner goes from idea to published site without writing code, and always understands the next step.

## Positioning

One plan drives everything: a single **Plan JSON** is the source of truth — AI generates it, the builder mutates it, and the compiler renders it into a real website. Neighboring tools cover planning *or* generation *or* hosting separately; SiteSketch is the pipeline that connects blueprint → organized plan → generated site → published URL in one guided flow.

## Operating Context

- University IPT2 system project (prepared by Nicole S. Edullantes, section LFCA411N120, submitted to Noel Montecillo) with an 8-week timeline; the running system and documentation are the deliverables.
- Development on Windows in VS Code; repo `sitesketch` on GitHub; auto-deploy to Vercel on push to `main`.
- AI and database access happen server-side only; browser talks to the Flask app.

## Capabilities and Constraints

- In scope: registration/login · website type + goal selection · section recommendations · add/remove/reorder sections via drag-and-drop (section-level, multi-page, inline text edit — **not** pixel positioning) · visual blueprint preview · content checklist · save/load projects · AI generation of plan structure + content from a description · automatic compilation of a complete multi-page website · publishing to `/site/<slug>` (files in Supabase Storage) · ZIP export · admin management of website types.
- Out of scope: domain registration · online payments · real-time multi-user collaboration · pixel-level/absolute-positioned editing · mobile app.
- Constraints: Gemini free tier (tight timeouts + graceful fallback) · Vercel serverless = no disk writes (published sites live in Supabase Storage) · secrets in `.env`/Vercel env vars, never committed or shipped to the browser.

## Brand Commitments

- Name: **SiteSketch** — proposal title "SiteSketch: A Web-Based Website Structure and Content Planning Application" (binding).
- Voice: friendly, encouraging, plain language; speaks to beginners without jargon.
- No logo or visual assets exist yet.

## Evidence on Hand

- `PLAN.md` (v2): architecture, Supabase SQL schema, feature designs, API/route map, timeline, proposal-update text.
- Original proposal PDF: `C:\Users\Pochi\Downloads\titleproposalV1 (2).pdf`.
- No user research, testimonials, or usage data exist — never fabricate any.

## Product Principles

1. Plan before pixels — structure and content come first; decoration later.
2. Every recommendation traces back to the chosen website type and goal.
3. A beginner always knows the next step; one primary action per screen.
4. One source of truth: the plan JSON drives the builder, compiler, and preview.
5. A plan isn't done until it's a real, viewable, published site.

## Accessibility & Inclusion

Solid defaults (user-confirmed): semantic HTML, keyboard support, visible focus states, contrast-checked colors, labeled form inputs. Not a strict WCAG AA audit, not deferred to later.
