# SiteSketch deployment

## Required production configuration

Set these environment variables in the runtime environment:

- `NODE_ENV=production`
- `PORT` (the platform-provided port)
- `DATABASE_URL` for PostgreSQL
- `JWT_SECRET` with at least 32 random characters
- `BUILT_IN_FORGE_API_URL` for the OpenAI-compatible AI provider base URL
- `BUILT_IN_FORGE_API_KEY` for the AI provider; keep this secret
- `AI_MODEL` set to a model ID returned by the provider's `/v1/models` endpoint

OAuth is optional. If enabled, configure the provider client credentials and
register these callback URLs:

- `/api/auth/google/callback`
- `/api/auth/github/callback`

Google login uses `prompt=select_account` so users can choose the Google
account they want to use. GitHub uses the currently authorized GitHub account
and requests the verified email scope. Never commit provider secrets; configure
them in the deployment platform's secret manager.

### AI provider audit

In the Render service shell, verify the variables are present without printing
their values:

```sh
test -n "$BUILT_IN_FORGE_API_URL" && echo "AI provider URL configured"
test -n "$BUILT_IN_FORGE_API_KEY" && echo "AI provider key configured"
test -n "$AI_MODEL" && echo "AI model configured: $AI_MODEL"
```

Then confirm the configured model is available. This prints model IDs only,
not the API key:

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $BUILT_IN_FORGE_API_KEY" \
  "$BUILT_IN_FORGE_API_URL/v1/models"
```

`AI_MODEL` must exactly match one of the returned `id` values. Do not paste
the key or the full environment output into logs or source control.

## Database setup

Run migrations before starting the application:

```sh
corepack pnpm db:push
```

For local development, start PostgreSQL with:

```sh
corepack pnpm setup:local
```

On Windows, install and run Docker Desktop first. The setup command creates
`.env` from `.env.example`, starts PostgreSQL, waits for its healthcheck, and
applies the Drizzle migrations.

For production, Neon or another managed PostgreSQL provider is recommended.
Copy its pooled or direct connection string into `DATABASE_URL`; do not commit
that value.

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

## OAuth provider setup

Create provider applications using the exact public HTTPS origin of the
deployed SiteSketch instance:

- Google Cloud Console: enable Google Identity Services and add
  `https://YOUR_DOMAIN/api/auth/google/callback` as an authorized redirect URI.
- GitHub Developer Settings: add
  `https://YOUR_DOMAIN/api/auth/github/callback` as the authorization callback URL.

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, and
`GITHUB_CLIENT_SECRET` in the hosting provider's secret manager. The server
rejects partially configured provider credentials at startup.
