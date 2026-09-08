---
name: sitesketch-project
description: >
Governs all development of SiteSketch. Use this skill whenever planning,
coding, debugging, testing, reviewing, refactoring, or deploying SiteSketch.
Treat this skill as the project's authoritative engineering and scope guide.
---

# SiteSketch Engineering Skill

## 1. PROJECT MISSION
SiteSketch is a web-based website structure and content planning application.

The application allows users to:

1. plan a website;
2. select a website type and purpose;
3. receive deterministic website-section recommendations;
4. add, remove, and reorder website sections;
5. create a visual website blueprint;
6. manage a basic content checklist;
7. save and load website projects;
8. generate an initial website using AI;
9. visually customize the generated website using drag-and-drop editing;
10. preview the resulting working website;
11. manage approved website types and recommendations through an admin area.
The project should feel like a combination of:

- a website planning tool;
- a visual website design/building tool;
- a simplified Figma-like editing experience;
- a simplified WordPress/Wix-like website-building experience.
Do not describe or implement SiteSketch as a complete replacement for WordPress, Wix, Webflow, or Figma.

The central purpose remains:

> Help users plan the structure and content of a website and then turn that plan into an editable visual website design/prototype.

---

# 2. NON-NEGOTIABLE PROJECT RULES
Follow these rules for every SiteSketch task.

1. Do not invent requirements.
2. Do not silently expand project scope.
3. Do not replace the approved technology stack without explicit approval.
4. Do not build unnecessary infrastructure.
5. Inspect the existing repository before modifying code.
6. Preserve existing functionality.
7. Do not rewrite unrelated code.
8. Every major feature must map to an approved requirement.
9. Prefer the smallest coherent implementation.
10. Ask when requirements are genuinely ambiguous.
11. Never hide an architectural change from the user.
12. Do not introduce dependencies without a clear reason.
13. Do not implement advanced functionality merely because it may be useful.
14. Existing functionality is a regression requirement.
15. Security-sensitive operations must be enforced server-side.
16. Never expose secrets to the frontend.
17. Never blindly execute or insert AI-generated code.
18. Do not create independent hosting infrastructure for generated websites unless explicitly required.
19. Do not turn SiteSketch into a full CMS, ecommerce platform, collaboration platform, or website-hosting platform unless explicitly approved.
20. When uncertain, stop and explain the uncertainty rather than silently making a decision.

---

# 3. REQUIREMENT TRACEABILITY
Every feature must be traceable to at least one of:

1. the original SiteSketch proposal;
2. professor-added requirements;
3. an explicit later user instruction.
Classify new functionality as one of:

- ORIGINAL SCOPE
- PROFESSOR-ADDED SCOPE
- EXPLICIT USER ADDITION
- OPTIONAL
- OUT OF SCOPE
If a requested feature is OUT OF SCOPE:

1. explain that it expands the project;
2. explain the architectural impact if applicable;
3. ask whether the user intentionally wants to expand the scope;
4. do not implement it until approved.

---

# 4. APPROVED TECHNOLOGY STACK

## Backend
Use:

- Python
- Flask
- SQLAlchemy / Flask-SQLAlchemy
- Flask-Migrate / Alembic

## Frontend
Use:

- React
- TypeScript
- HTML
- CSS
React is the primary frontend application framework.

TypeScript is the primary frontend programming language.

Prefer `.tsx` and `.ts`.

Do not introduce:

- Vue
- Angular
- Next.js
- Nuxt
- Svelte
- another frontend framework
unless the user explicitly approves an architecture change.

## Visual Website Editor
Use:

- GrapesJS
GrapesJS is the foundation for the visual website-building/editor experience.

Do not build an entire drag-and-drop editor engine from scratch.

React should control the SiteSketch application interface surrounding the editor.

GrapesJS should control the actual visual website editing experience.

## AI
Use:

- OpenAI API
The OpenAI API is responsible for AI-powered website generation.

## Database
Local development:

- SQLite
Production:

- PostgreSQL
Use SQLAlchemy so the application can support both.

## Deployment
Use:

- Gunicorn
- Render
The primary production deliverable is the SiteSketch application itself.

## Repository
Use:

- Git
- GitHub

---

# 5. ARCHITECTURE
The application should follow this general architecture:

```
                         USER
                           |
                           v
                    Web Browser
                           |
                           v
                React + TypeScript
                           |
                     HTTP / JSON
                           |
                           v
                        Flask
                           |
          +----------------+----------------+
          |                |                |
          v                v                v
      Planning            AI          Project/Editor
          |                |                |
          |                v                |
          |          OpenAI API             |
          |                                 |
          +----------------+----------------+
                           |
                           v
                       SQLAlchemy
                           |
                    +------+------+
                    |             |
                    v             v
                  SQLite     PostgreSQL
```
The visual editor exists inside the React application:

```
React Application
│
├── Authentication
├── Dashboard
├── Planning
├── Projects
├── AI Generation
├── Preview
├── Admin
│
└── GrapesJS Editor
    ├── Canvas
    ├── Blocks
    ├── Components
    ├── Styles
    └── Pages
```
Do not introduce unnecessary microservices.

Use a single main web application unless the user explicitly approves an architectural change.

---

# 6. FRONTEND RESPONSIBILITIES
React + TypeScript is responsible for the SiteSketch application UI.

This includes:

- registration;
- login;
- logout;
- dashboard;
- project management;
- website type selection;
- website purpose selection;
- recommendation display;
- section management;
- website blueprint;
- content checklist;
- AI generation interface;
- editor shell;
- editor controls;
- preview controls;
- project save/load interactions;
- admin interface;
- loading states;
- error states;
- user-facing notifications.
Use reusable React components.

Keep components reasonably focused.

Separate:

```
UI
Application State
API Communication
Business Logic
```
Do not put large amounts of business logic directly inside React components.

Use TypeScript types/interfaces for API responses and application data.

Avoid `any` unless there is a specific technical reason.

---

# 7. FRONTEND STRUCTURE
A reasonable starting structure is:

```
frontend/
├── src/
│   ├── components/
│   ├── pages/
│   ├── layouts/
│   ├── features/
│   ├── services/
│   ├── hooks/
│   ├── types/
│   ├── utils/
│   ├── styles/
│   ├── App.tsx
│   └── main.tsx
│
├── package.json
├── tsconfig.json
└── vite.config.ts
```
Do not create directories merely because they appear in this example.

Create them when the corresponding functionality exists.

Use Vite if a React build tool is required, unless the existing repository already uses another approved React build configuration.

Do not migrate an existing frontend unnecessarily.

---

# 8. FRONTEND API BOUNDARY
React communicates with Flask through HTTP APIs.

Use this boundary:

```
React
  |
  | HTTP / JSON
  v
Flask API
  |
  v
Application Services
  |
  v
Database
```
React must not:

- directly access the database;
- contain database credentials;
- contain OpenAI API keys;
- contain server secrets;
- rely on frontend-only authorization for security.
Server-side authorization is authoritative.

---

# 9. GRAPESJS + REACT ARCHITECTURE
Use React for the SiteSketch application shell and GrapesJS for visual editing.

Conceptually:

```
React
│
├── SiteSketch Navigation
├── Project Controls
├── AI Controls
├── Planning Controls
├── Save / Load
├── Preview
│
└── GrapesJS
    ├── Canvas
    ├── Blocks
    ├── Components
    ├── Style Manager
    ├── Layers
    └── Pages
```
Do not duplicate GrapesJS functionality in React.

SiteSketch should customize GrapesJS so that the editor feels like part of SiteSketch rather than an unmodified third-party editor.

Potential SiteSketch blocks include:

- Navbar
- Hero
- About
- Services
- Features
- Cards
- Gallery
- Testimonials
- Pricing
- FAQ
- Contact
- Footer
Only implement blocks that are justified by the project requirements.

---

# 10. AI ARCHITECTURE
AI must not directly control the application's DOM or database.

Use this flow:

```
User Prompt
    |
    v
React + TypeScript
    |
    v
Flask API
    |
    v
OpenAI API
    |
    v
Structured Website Specification
    |
    v
Validation
    |
    v
SiteSketch Conversion Layer
    |
    v
GrapesJS Project Data
    |
    v
Visual Editor
```
The AI should primarily generate structured website specifications.

Example:

```
{
  "site_type": "restaurant",
  "purpose": "attract customers",
  "theme": "modern",
  "pages": [
    {
      "name": "Home",
      "sections": [
        "navbar",
        "hero",
        "about",
        "menu",
        "gallery",
        "contact",
        "footer"
      ]
    }
  ]
}
```
The backend must validate the AI output before using it.

If AI output is invalid:

- reject it;
- sanitize/validate it;
- provide a safe fallback or error;
- do not modify the user's existing project.
Never blindly execute AI-generated JavaScript.

Never blindly insert arbitrary AI-generated HTML into the application.

Never allow AI output to bypass application authorization or validation.

---

# 11. AI FAILURE HANDLING
The application must assume AI can fail.

Handle:

- API timeout;
- API unavailable;
- invalid response;
- malformed JSON;
- unsupported section;
- unsupported component;
- rate limit;
- empty response;
- unexpected response structure.
Preferred flow:

```
Existing Project
      |
      v
AI Generation Request
      |
      +---- failure ---> show error
      |                  keep project unchanged
      |
      v
Validate Result
      |
      +---- invalid ---> reject
      |                  keep project unchanged
      |
      v
Convert
      |
      v
Load into Editor
      |
      v
User Reviews/Edits
      |
      v
Save
```
AI failure must never corrupt an existing saved project.

---

# 12. DETERMINISTIC RECOMMENDATION ENGINE
The normal SiteSketch recommendation system must remain deterministic.

Do not replace it with AI.

Example:

```
Restaurant
  -> Hero
  -> About
  -> Menu
  -> Gallery
  -> Opening Hours
  -> Location
  -> Contact
  -> Footer
```
The recommendation engine should be based on application/database rules.

AI generation is a separate feature.

Correct architecture:

```
Normal Planning
    |
    v
Deterministic Recommendations

AI Generation
    |
    v
AI Website Specification
```
Do not mix these systems unnecessarily.

---

# 13. DATABASE DESIGN
Use relational database models.

Recommended entities:

```
users
website_types
website_purposes
sections
recommendations
projects
pages
project_editor_data
content_items
```
Potential future entity:

```
assets
```
only when asset management is actually implemented.

## users

```
id
email
password_hash
role
created_at
```

## website_types

```
id
name
description
```

## website_purposes

```
id
name
description
```

## sections

```
id
name
description
component_type
```

## recommendations

```
id
website_type_id
section_id
priority
```

## projects

```
id
user_id
name
website_type_id
website_purpose_id
created_at
updated_at
```

## pages

```
id
project_id
name
slug
position
```

## project_editor_data

```
id
project_id
data_json
updated_at
```
Use structured editor/project data as the source of truth for restoring an editable project.

Do not use exported HTML/CSS as the primary editable database representation.

## content_items

```
id
project_id
page_id
name
description
is_completed
```

---

# 14. AUTHORIZATION
Users must only be able to access their own projects unless an approved feature explicitly allows otherwise.

Authorization must be enforced on the Flask server.

For example:

```
GET /api/projects/123
```
must verify that project `123` belongs to the authenticated user.

Never rely solely on frontend UI restrictions.

Admin endpoints must verify the user's admin role server-side.

---

# 15. AUTHENTICATION
Authentication should support:

- registration;
- login;
- logout;
- session handling;
- authorization.
Passwords must be securely hashed.

Never:

- store plaintext passwords;
- log passwords;
- return password hashes to the frontend;
- put passwords in URLs;
- hard-code admin credentials;
- expose authentication secrets to React.

---

# 16. PROJECT PERSISTENCE
Users should be able to:

```
Create project
Save project
Load project
Edit project
Save changes
Delete project
```
A saved project should retain:

- project metadata;
- pages;
- components;
- styles;
- content;
- editor state required to continue editing.
The visual editor's structured project data should be persisted.

---

# 17. API STRUCTURE
Recommended initial API:

## Authentication

```
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
```

## Planning

```
GET /api/website-types
GET /api/website-types/<id>/recommendations
GET /api/website-purposes
```

## Projects

```
GET    /api/projects
POST   /api/projects
GET    /api/projects/<id>
PUT    /api/projects/<id>
DELETE /api/projects/<id>
```

## Editor

```
GET /api/projects/<id>/editor
PUT /api/projects/<id>/editor
```

## AI

```
POST /api/ai/generate
```

## Preview

```
GET /projects/<id>/preview
```
These are starting points rather than immutable requirements.

Add or modify endpoints only when implementation requires it.

---

# 18. BACKEND ORGANIZATION
A reasonable backend structure:

```
app/
├── __init__.py
├── config.py
│
├── auth/
│   ├── routes.py
│   └── services.py
│
├── planner/
│   ├── routes.py
│   └── recommendation.py
│
├── projects/
│   ├── routes.py
│   └── services.py
│
├── ai/
│   ├── routes.py
│   └── generator.py
│
├── editor/
│   ├── routes.py
│   └── services.py
│
├── preview/
│   └── routes.py
│
├── admin/
│   └── routes.py
│
├── models/
│   ├── user.py
│   ├── project.py
│   ├── page.py
│   ├── section.py
│   └── recommendation.py
│
├── templates/
└── static/
```
Do not create modules merely because they appear in this template.

Keep the actual repository structure consistent with the features that currently exist.

---

# 19. ENVIRONMENT VARIABLES
Use environment variables for secrets and environment-specific configuration.

Possible local `.env`:

```
SECRET_KEY=
DATABASE_URL=
OPENAI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
```
Only include variables that are actually required.

Rules:

- `.env` must never be committed;
- secrets must never be hard-coded;
- production secrets belong in Render environment variables;
- never print secrets in logs;
- never expose secrets in frontend code;
- never put API keys into screenshots or documentation.
`.gitignore` should include at minimum:

```
.env
.venv/
__pycache__/
*.pyc
node_modules/
```

---

# 20. DEPENDENCY RULES
Backend expected dependencies:

```
Flask
Flask-SQLAlchemy
Flask-Migrate
python-dotenv
openai
gunicorn
```
Potentially:

```
Flask-WTF
```
only if required.

Frontend primary dependencies include:

```
react
react-dom
typescript
grapesjs
```
Use npm for frontend dependency management.

Before adding a dependency:

1. explain the problem it solves;
2. verify that the existing stack cannot already solve it;
3. verify that it does not duplicate an existing dependency;
4. verify that it fits the architecture;
5. keep the dependency minimal.
Do not add libraries merely because they are popular.

---

# 21. DEVELOPMENT WORKFLOW
Before making code changes:

1. inspect the repository;
2. inspect the relevant files;
3. inspect the existing frontend structure;
4. inspect the existing backend structure;
5. inspect dependencies;
6. inspect database models;
7. inspect routes;
8. inspect existing tests;
9. identify existing implementation patterns;
10. determine the smallest set of affected files.
Do not assume the repository exactly matches this skill.

The existing code is the source of truth for what has already been implemented.

After inspection:

1. identify the requirement;
2. classify the change;
3. create a minimal implementation plan;
4. identify affected files;
5. identify database changes;
6. identify dependency changes;
7. implement the smallest coherent change;
8. run relevant tests/checks;
9. verify application startup;
10. verify frontend compilation/build;
11. report what was changed and verified.

---

# 22. CHANGE CONTROL
When the user requests a new feature, classify it:

```
ORIGINAL SCOPE
PROFESSOR-ADDED SCOPE
EXPLICIT USER ADDITION
OPTIONAL
OUT OF SCOPE
```
If the request changes architecture, explicitly identify the architecture change.

Example:

```
Current frontend:
React + TypeScript

Requested:
Replace React with Vue

Impact:
This changes the approved frontend architecture.

Decision:
Do not silently make this change.

Need confirmation:
Confirm whether the frontend architecture should be changed.
```
If the user explicitly approves the change, follow the new instruction while clearly recognizing that the project decision has changed.

---

# 23. UNCERTAINTY PROTOCOL
When requirements or architecture are genuinely unclear, use:

```
Unknown:
<what is unclear>

Established:
<what the project rules establish>

Possible options:
<A>
<B>

Recommended:
<recommendation if appropriate>

Need confirmation:
<what the user needs to decide>
```
Do not silently choose between materially different architectural options.

Ask questions only when necessary.

Do not ask questions when the existing project rules already establish the answer.

---

# 24. COMPLETE WORKING WEBSITE OUTPUT
A generated website should be a functional website output/preview within SiteSketch.

It may include:

- multiple pages;
- navigation;
- sections;
- buttons;
- text;
- images;
- responsive layout;
- styling;
- appropriate frontend interactions.
The generated website does not automatically require:

- a separate backend;
- a separate database;
- payment processing;
- an independent domain;
- independent cloud hosting;
- per-project deployment.
The generated website should remain editable through SiteSketch.

If independent hosting or publishing becomes an explicit requirement, treat it as an architectural change and ask for confirmation before implementing it.

---

# 25. PREVIEW
SiteSketch should provide an internal website preview.

Conceptually:

```
Saved Project
     |
     v
Structured Editor Data
     |
     v
Preview Renderer
     |
     v
Interactive Website Preview
```
Preview should allow users and the professor to see the generated website as an actual working website experience rather than merely a screenshot.

Preview is part of SiteSketch.

Preview does not automatically mean public hosting.

---

# 26. DEPLOYMENT BOUNDARY
The production deployment target is SiteSketch itself.

Correct:

```
Internet
   |
   v
SiteSketch
   |
   +-- Project A
   +-- Project B
   +-- Project C
```
Do not automatically build:

```
Internet
   |
   +-- SiteSketch
   +-- Generated Website A
   +-- Generated Website B
   +-- Generated Website C
```
unless independent generated-site hosting is explicitly required.

---

# 27. PRODUCTION ARCHITECTURE
Recommended:

```
GitHub
   |
   v
Render Web Service
   |
   v
Gunicorn
   |
   v
Flask
   |
   +--> PostgreSQL
   |
   +--> OpenAI API
   |
   +--> optional object storage
```
The React frontend should be built and served according to the chosen repository/deployment architecture.

Do not add a separate production service unless required.

---

# 28. PRODUCTION RULES
Never deploy with development settings.

Before production:

- disable Flask debug mode;
- use Gunicorn;
- configure environment variables;
- configure PostgreSQL;
- run migrations;
- verify authentication;
- verify authorization;
- verify AI API configuration;
- verify frontend build;
- verify frontend/backend communication;
- verify preview;
- verify project persistence;
- verify HTTPS;
- verify error handling.
Never deploy with:

```
debug=True
```
Never use the Flask development server as the production server.

---

# 29. DATABASE MIGRATION RULE
Use migrations for schema changes.

When models change:

1. modify the models;
2. create a migration;
3. inspect the migration;
4. test it locally;
5. apply it to production when ready.
Keep migration files in Git.

Do not instruct the user to manually edit production database tables as the normal workflow.

---

# 30. SECURITY RULES
At minimum:

- secure password hashing;
- secure session handling;
- input validation;
- server-side authorization;
- CSRF protection where applicable;
- no plaintext passwords;
- no secrets in Git;
- no API keys in frontend code;
- no arbitrary execution of AI-generated code;
- validation of AI output;
- user project isolation;
- admin authorization.
Security should be handled at the appropriate backend boundary.

---

# 31. GIT/GITHUB WORKFLOW
Use:

```
Feature/change
     |
     v
Development
     |
     v
Testing
     |
     v
Commit
     |
     v
Push to GitHub
     |
     v
Deploy when ready
```
Commit messages should describe the actual change.

Examples:

```
feat: add project persistence
feat: integrate GrapesJS editor
feat: add AI website generation
feat: add React planning interface
fix: prevent cross-user project access
fix: validate AI website specification
```
Never commit:

- `.env`;
- API keys;
- database passwords;
- generated secrets;
- unnecessary local files;
- `node_modules`.

---

# 32. TESTING STRATEGY
Test requirements independently.

## Authentication
Test:

- registration;
- duplicate registration;
- login;
- invalid password;
- logout;
- session behavior.

## Planning
Test:

- website type;
- website purpose;
- recommendations;
- adding sections;
- removing sections;
- reordering sections.

## Content
Test:

- checklist appears;
- completion changes;
- completion persists.

## Projects
Test:

- create;
- save;
- load;
- edit;
- delete;
- user isolation.

## Visual editor
Test:

- editor loads;
- blocks load;
- block insertion;
- drag/drop;
- editing;
- styling;
- deletion;
- reordering;
- page switching;
- save;
- reload.

## AI
Test:

- valid prompt;
- invalid prompt;
- malformed AI response;
- missing fields;
- unsupported components;
- API failure;
- timeout;
- rate limit;
- safe error handling;
- generated result is editable;
- existing project remains unchanged after failure.

## Preview
Test:

- page navigation;
- links/buttons;
- responsive layout;
- rendering;
- multiple pages;
- visual consistency.

## Production
Test:

- public URL;
- HTTPS;
- database;
- migrations;
- authentication;
- authorization;
- AI API;
- frontend build;
- backend API;
- preview;
- persistence.

---

# 33. REGRESSION RULE
Every existing SiteSketch feature is a regression requirement.

When adding functionality:

1. do not break existing features;
2. test affected existing functionality;
3. test important unrelated functionality when the change is large;
4. do not rewrite working systems without a reason.
The original SiteSketch planning functionality must remain intact even after adding the advanced visual editor and AI generation.

---

# 34. DEVELOPMENT PHASES
Build incrementally.

## Phase 1 — Foundation
Set up:

- VS Code;
- Python;
- virtual environment;
- Git;
- GitHub;
- Flask;
- React;
- TypeScript;
- npm;
- SQLite;
- basic application structure.
Goal:

> Run a minimal SiteSketch application locally.

## Phase 2 — Original SiteSketch functionality
Implement:

1. registration/login;
2. website type;
3. website purpose;
4. deterministic recommendations;
5. add/remove sections;
6. move sections;
7. blueprint;
8. content checklist;
9. save/load projects.
Goal:

> The original proposal works end-to-end.

## Phase 3 — Visual Editor
Integrate GrapesJS.

Implement:

1. editor page;
2. SiteSketch blocks;
3. drag/drop;
4. component editing;
5. styling;
6. pages;
7. save/load editor data;
8. preview.
Goal:

> Users can visually construct and edit a website.

## Phase 4 — AI Generation
Implement:

1. user prompt;
2. Flask AI endpoint;
3. structured AI response;
4. validation;
5. conversion to SiteSketch/GrapesJS data;
6. generated website loaded into editor.
Goal:

> AI can generate an initial editable website.

## Phase 5 — Working Website Output
Implement enough functionality for generated sites to work as previews.

Test:

- navigation;
- multiple pages;
- buttons;
- responsive layout;
- visual consistency;
- interaction.
Goal:

> Generated output is interactive, not merely a screenshot.

## Phase 6 — Assets
Only if required:

- image upload;
- asset storage;
- image selection;
- image replacement.
Do not implement asset infrastructure before it is needed.

## Phase 7 — Production Database
Test the application with:

```
SQLite
```
and then production:

```
PostgreSQL
```
Use SQLAlchemy and migrations.

## Phase 8 — Deployment
Deploy SiteSketch itself.

```
GitHub
   |
   v
Render
   |
   v
Gunicorn + Flask
   |
   +--> PostgreSQL
   +--> OpenAI
   +--> optional storage
```
Goal:

> The professor can open one URL and use SiteSketch online.

---

# 35. DO NOT MAKE THESE COMMON MISTAKES

## Do not build a WordPress clone
Build only the visual website-building functionality required by SiteSketch.

## Do not build a drag-and-drop editor from scratch
Use GrapesJS.

## Do not let AI directly generate uncontrolled application code
Use:

```
AI
→ structured specification
→ validation
→ conversion
→ GrapesJS
```

## Do not replace deterministic recommendations with AI
Keep the recommendation engine predictable.

## Do not host every generated website
Host SiteSketch itself unless independent hosting is explicitly required.

## Do not introduce unnecessary microservices
Prefer one main Flask application.

## Do not introduce another frontend framework
React + TypeScript is the approved frontend architecture.

## Do not add many libraries
Prefer a small dependency set.

## Do not break existing planning features
Treat original functionality as a regression requirement.

## Do not hard-code secrets
Use environment variables.

## Do not trust frontend authorization
Enforce authorization on the Flask backend.

## Do not blindly trust AI output
Validate everything before converting it into application/editor data.

---

# 36. REQUIREMENT TRACEABILITY TABLE
Maintain this conceptual mapping:

RequirementImplementationRegistration/loginFlask authentication + databaseWebsite typeReact planning UI + Flask APIWebsite purposeReact planning UI + Flask APIRecommended sectionsDeterministic recommendation engineAdd/remove sectionsPlanner/editorMove sectionsPlanner/editorBlueprintReact UI / visual representationContent checklistReact + backend persistenceSave/load projectsFlask + SQLAlchemy + editor JSONAdmin managementFlask admin routes + React admin UIAdvanced drag/dropGrapesJSAI-generated websiteOpenAI + structured generationEditable AI outputGrapesJS project dataComplete working websitePreview/output systemSiteSketch onlineRender + GunicornGenerated-site independent hostingNOT assumed
---

# 37. ENVIRONMENT READINESS CHECKLIST
Before serious development:

```
[ ] VS Code ready
[ ] AI coding assistant available
[ ] Python installed
[ ] Node.js installed
[ ] npm installed
[ ] Git installed
[ ] GitHub repository created
[ ] Python virtual environment created
[ ] Flask installed
[ ] React configured
[ ] TypeScript configured
[ ] GrapesJS installed
[ ] requirements.txt created
[ ] package.json created
[ ] .gitignore created
[ ] .env created locally
[ ] secrets excluded from Git
[ ] local Flask backend runs
[ ] local React frontend runs
[ ] frontend can communicate with backend
[ ] local database works
```
Do not configure production infrastructure prematurely.

---

# 38. PRODUCTION READINESS CHECKLIST
Before deployment:

```
[ ] Application works locally
[ ] Original planning features work
[ ] Authentication works
[ ] Authorization works
[ ] React frontend works
[ ] TypeScript build succeeds
[ ] GrapesJS editor works
[ ] AI generation works
[ ] AI validation works
[ ] Generated website is editable
[ ] Preview works
[ ] Save/load works
[ ] PostgreSQL tested
[ ] Migrations tested
[ ] Secrets configured
[ ] Debug disabled
[ ] Gunicorn works
[ ] GitHub repository is clean
[ ] Render configured
[ ] Production database configured
[ ] OpenAI API configured
[ ] Asset storage configured if required
[ ] Public URL tested
```

---

# 39. FINAL PROJECT PRINCIPLE
SiteSketch should be built as:

```
Website Planning
       +
Deterministic Recommendations
       +
AI Website Generation
       +
React + TypeScript Application
       +
GrapesJS Visual Editing
       +
Working Website Preview
       +
Project Persistence
       =
SiteSketch
```
The advanced features extend the website-planning concept.

They do not replace it.

The final application should be:

> One online SiteSketch web application where users can plan a website, generate an initial website with AI, visually customize it using React/TypeScript and GrapesJS, preview the working result, and save their project.
Do not assume every generated website needs independent hosting or a domain.

---

# 40. GOLDEN RULE FOR EVERY AI CODING SESSION
Before writing code, remember:

> **DO NOT GUESS.**
> 
> Inspect the existing repository first.
> 
> Map every change to an approved requirement.
> 
> Use React + TypeScript for the frontend.
> 
> Use Flask + SQLAlchemy for the backend.
> 
> Use GrapesJS for visual website editing.
> 
> Use structured AI output with validation.
> 
> Do not silently change architecture.
> 
> Do not silently expand scope.
> 
> Do not build unnecessary infrastructure.
> 
> Preserve existing functionality.
> 
> Make the smallest coherent change.
> 
> Test what you changed.
> 
> Ask when something is genuinely ambiguous.