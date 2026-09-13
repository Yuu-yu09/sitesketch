# SiteSketch tools

This note explains the main tools used in SiteSketch, why they were chosen, and what each one does.

## Frontend

| Tool | Why we use it | What it is for |
| --- | --- | --- |
| React | Builds the user interface from reusable components. | Landing pages, authentication screens, dashboard views, and workspace controls. |
| Vite | Provides a fast local development server and production frontend build. | Running the client locally and creating optimized browser assets. |
| Wouter | Keeps page navigation small and lightweight. | Routes such as the landing page, auth page, and dashboard. |
| Tailwind CSS and project CSS | Speeds up layout work while allowing SiteSketch-specific styling. | Responsive layouts, spacing, colors, typography, focus states, and mobile behavior. |
| Lucide React | Provides consistent accessible interface icons. | Navigation, save, project, preview, and account actions. |

## Application and API

| Tool | Why we use it | What it is for |
| --- | --- | --- |
| Node.js | Runs the server-side JavaScript application. | API requests, authentication, sessions, and database operations. |
| Express | Provides the HTTP server foundation. | Serving the application and handling server routes. |
| tRPC | Keeps client and server API calls type-safe. | Project, authentication, generation, save, and ownership operations. |

## Database and persistence

| Tool | Why we use it | What it is for |
| --- | --- | --- |
| PostgreSQL | Stores user, session, project, and editor data reliably. | Persistent application data. |
| Supabase | Provides managed PostgreSQL access for development and future production use. | Database hosting, connection management, and database administration. |
| Drizzle ORM | Provides typed database queries and schema management. | Defining tables, pushing schema changes, and reading or updating records. |
| Transaction pooler | Avoids local connection problems with the hosted database. | Efficient pooled PostgreSQL connections for local development. |
| `sitesketch` PostgreSQL schema | Keeps SiteSketch tables isolated. | Prevents SiteSketch migrations from affecting unrelated tables in the same database. |

## Authentication and security

| Tool or method | Why we use it | What it is for |
| --- | --- | --- |
| Email and password authentication | Supports users who do not want to use a social provider. | Account registration and sign-in. |
| Google OAuth | Provides a familiar one-click sign-in option. | Google account authorization and account linking. |
| GitHub OAuth | Supports developers and GitHub users. | GitHub account authorization and account linking. |
| JWT session cookies | Keeps authenticated sessions available across requests. | Securely identifying signed-in users. |
| Scrypt password hashing | Avoids storing plain-text passwords. | One-way password protection with per-user salts. |
| OAuth state and nonce validation | Protects the OAuth callback flow. | Preventing forged or mismatched authorization responses. |

## Website editing and preview

| Tool | Why we use it | What it is for |
| --- | --- | --- |
| GrapesJS | Provides a visual editing canvas instead of requiring users to write code. | Editing page blocks, content, styles, and responsive layouts. |
| Sandboxed preview iframe | Separates generated preview content from the application interface. | Rendering saved HTML and CSS safely inside SiteSketch. |
| Local storage prompt handoff | Keeps the landing-page prompt while a user signs in or registers. | Passing the initial idea into the workspace without exposing it in a URL. |

## Testing and quality checks

| Tool | Why we use it | What it is for |
| --- | --- | --- |
| TypeScript | Catches incorrect data shapes and API usage before runtime. | Type checking the client and server. |
| Vitest | Provides fast automated tests for application behavior. | Authentication, OAuth, session, and server regression tests. |
| Playwright | Tests the product in a real browser. | Registration, project creation, editor saving, navigation, and preview flows. |
| Google Chrome channel | Lets local Playwright runs use an already-installed browser when the managed browser download is unavailable. | Local E2E validation only; CI installs its managed browser normally. |
| GitHub Actions | Runs repeatable checks on pushes and pull requests. | Database setup, schema push, type checking, tests, E2E, and production builds. |

## Development and deployment

| Tool | Why we use it | What it is for |
| --- | --- | --- |
| pnpm | Installs dependencies and runs repository scripts consistently. | Development, checking, testing, and building commands. |
| Git | Tracks changes and provides safe collaboration history. | Branches, commits, pull requests, and rollback points. |
| GitHub | Hosts the repository and pull requests. | Code review, collaboration, and CI results. |
| Render | Intended application hosting target. | Running the production SiteSketch server and frontend. |

## How they work together

1. React and Vite provide the browser interface.
2. Express and tRPC connect the interface to server operations.
3. Drizzle stores data in the isolated PostgreSQL `sitesketch` schema.
4. Email, Google, and GitHub authentication create secure sessions.
5. GrapesJS handles visual editing, while the sandboxed iframe displays previews.
6. TypeScript, Vitest, Playwright, and GitHub Actions verify that changes work before release.

