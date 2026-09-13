# SiteSketch phase plan

## Current position

SiteSketch is in **Phase 3: release hardening**. The core MVP workflow is implemented:

- account registration and login
- Google and GitHub OAuth flows
- project creation and ownership checks
- planning, visual editing, saving, and preview
- PostgreSQL persistence
- production build and deployment configuration

Local type-checking, unit/auth tests, production builds, and OAuth redirect
configuration have been verified. Database-backed tests, browser E2E tests, a
green remote CI run, and production deployment are still release gates.

## Phase 0 - Repository baseline and cleanup

**Status: Complete**

### Deliverables

- Remove unused application, template, hook, and server-helper files.
- Remove dependencies that are no longer referenced.
- Keep the active UI primitives and product workflow intact.
- Record the cleanup in the lockfile.

### Exit criteria

- TypeScript check passes.
- Unit/auth tests pass.
- Production build passes.
- No imports reference deleted files.

## Phase 1 - Core MVP workflow

**Status: Complete**

### Deliverables

- Registration, login, logout, and protected sessions.
- Project creation, switching, rename, and delete.
- Project ownership enforcement in server routes.
- Plan, build, save, and preview workflow.
- Editor data persistence and reload behavior.
- Health and readiness endpoints.

### Exit criteria

- An authenticated user can create a project, edit it, save it, and open its
  preview.
- A user cannot read or modify another user's projects.
- The production build starts with the documented environment variables.

## Phase 2 - OAuth recovery and local integration

**Status: Complete locally**

### Deliverables

- Google OAuth authorization and callback routes.
- GitHub OAuth authorization and callback routes.
- OAuth state/nonce validation.
- Provider profile lookup and verified-email handling.
- Local callback URLs for `127.0.0.1` and `localhost`.
- Local credentials stored only in the ignored `.env` file.

### Exit criteria

- `/api/auth/google` returns a valid provider redirect.
- `/api/auth/github` returns a valid provider redirect.
- Callback failures are surfaced without creating an invalid session.
- No OAuth secret is tracked by Git.

### Scope note

Discord OAuth is not part of the repository history or current product scope.
It should be treated as a separate feature request rather than a recovery task.

## Phase 3 - Release hardening

**Status: In progress — environment validation completed where possible**

### Work items

1. Start PostgreSQL using Docker or a managed test database.
2. Apply the schema with `pnpm db:push`.
3. Run the ownership integration tests with `RUN_DB_TESTS=1`.
4. Install/enable the Playwright browser used by the E2E suite.
5. Run `pnpm test:e2e`.
6. Trigger GitHub Actions and confirm the complete CI workflow passes.
7. Review failures and add regression tests for any defect found.

### Recommended regression coverage

- OAuth success and provider failure paths.
- Project switching, rename, and delete.
- Unauthorized project access.
- Editor persistence after a page reload.
- Preview behavior on empty and populated projects.
- AI provider timeout and invalid-response handling.

### Exit criteria

- Database integration tests pass against PostgreSQL.
- Playwright E2E tests pass in CI.
- TypeScript, unit tests, E2E tests, and production build all pass in one
  remote CI run.
- No known release-blocking test failures remain.

### Validation recorded on 2026-09-12

- `pnpm check` passes.
- `pnpm test` passes with 12 tests passing; 2 PostgreSQL ownership tests are
  skipped because no database is available.
- `pnpm build` passes; Vite reports a non-blocking large JavaScript chunk.
- Playwright discovers the browser test, but the Chromium runtime could not be
  downloaded in this environment because the browser CDN request timed out.
- `/healthz` returns `200`.
- `/readyz` returns `503`, correctly indicating that PostgreSQL is unavailable.
- The latest remote CI failure was the old `pnpm/action-setup` version mismatch.
  The workflow now uses Corepack with the package manager version pinned in
  `package.json`; a new remote run is still required to confirm it.

### Remaining Phase 3 blockers

1. Make Docker/PostgreSQL available, then run `pnpm db:push` and the full
   database-backed test suite.
2. Make the Playwright Chromium runtime available, then run `pnpm test:e2e`.
3. Push the workflow change or otherwise trigger GitHub Actions and confirm one
   complete green CI run.

## Phase 4 - Production deployment

**Status: Not started**

### Work items

- Provision managed PostgreSQL.
- Configure production `DATABASE_URL`, `JWT_SECRET`, and AI provider secrets.
- Configure production Google and GitHub client credentials.
- Register HTTPS callback URLs:
  - `/api/auth/google/callback`
  - `/api/auth/github/callback`
- Deploy the production build.
- Run database migrations before serving traffic.
- Configure `/readyz` as the deployment health check.
- Verify HTTPS cookies, login, project persistence, editor save, and preview.

### Exit criteria

- A fresh production account can authenticate and use the complete MVP flow.
- Google and GitHub OAuth callbacks work on the production domain.
- `/healthz` and `/readyz` behave correctly.
- Secrets are configured through the hosting provider and are not committed.
- PostgreSQL backups and restore instructions are documented.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the deployment configuration details.

## Phase 5 - Post-launch stabilization

**Status: Planned**

### Work items

- Monitor server errors, readiness failures, and database health.
- Add error tracking and structured operational logs.
- Test backup restoration.
- Fix high-impact usability and reliability issues from real usage.
- Add rate limiting and abuse protection where needed.
- Keep dependencies and security updates current.

### Exit criteria

- A repeatable incident and recovery process exists.
- Backup restoration has been tested successfully.
- No unresolved high-severity production issues remain.

## Phase 6 - Product expansion

**Status: Future scope**

Potential features:

- Publish websites to public URLs.
- Custom domains.
- Public share links with access controls.
- Full multi-page site management.
- Content management features.
- Analytics.
- Billing and subscriptions.
- Additional OAuth providers, including Discord, if product requirements justify
  the added maintenance.

These features should not delay the Phase 3 release-hardening work unless a
business requirement explicitly changes the MVP scope.

## Execution order

Work through phases in order:

1. Phase 3 — release hardening
2. Phase 4 — production deployment
3. Phase 5 — post-launch stabilization
4. Phase 6 — product expansion

At the end of each phase, record the validation result and any newly discovered
work before starting the next phase.
