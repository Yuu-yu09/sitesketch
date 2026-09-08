# SiteSketch deployment

## Required production configuration

Set these environment variables in the runtime environment:

- `NODE_ENV=production`
- `PORT` (the platform-provided port)
- `DATABASE_URL` for PostgreSQL
- `JWT_SECRET` with at least 32 random characters

OAuth is optional. If enabled, configure the provider client credentials and
register these callback URLs:

- `/api/auth/google/callback`
- `/api/auth/github/callback`

Google login uses `prompt=select_account` so users can choose the Google
account they want to use. GitHub uses the currently authorized GitHub account
and requests the verified email scope. Never commit provider secrets; configure
them in the deployment platform's secret manager.

## Database setup

Run migrations before starting the application:

```sh
corepack pnpm db:push
```

For local development, start PostgreSQL with:

```sh
docker compose up -d postgres
```

## Build and run

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
NODE_ENV=production corepack pnpm start
```

The process exposes `/healthz` for liveness and `/readyz` for PostgreSQL
readiness. Configure the platform health check to use `/readyz`.

## Operational checklist

- Use HTTPS in production so authentication cookies are secure.
- Keep `JWT_SECRET` and OAuth secrets outside the repository.
- Back up PostgreSQL and test restoring a backup.
- Monitor `/readyz` and application errors.
- Configure the reverse proxy to forward `X-Forwarded-Proto`.

## Continuous integration

The GitHub Actions workflow in `.github/workflows/ci.yml` starts PostgreSQL,
applies migrations, runs TypeScript checks, unit tests, ownership integration
tests, Playwright browser tests, and the production build.
