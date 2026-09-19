# SiteSketch deployment

## Required production configuration

Set these environment variables in the runtime environment:

- `NODE_ENV=production`
- `PORT` (the platform-provided port)
- `DATABASE_URL` for PostgreSQL
- `JWT_SECRET` with at least 32 random characters
- `AI_PROVIDER=gemini` for Google Gemini through its OpenAI-compatible endpoint
- `BUILT_IN_FORGE_API_URL` for the OpenAI-compatible AI provider base URL
- `BUILT_IN_FORGE_API_KEY` for the hosted provider; keep this secret
- `AI_MODEL` set to a model ID returned by the provider's `/v1/models` endpoint

For Google Gemini on Render, set these values in the service Environment tab:

```text
AI_PROVIDER=gemini
BUILT_IN_FORGE_API_URL=https://generativelanguage.googleapis.com/v1beta/openai
BUILT_IN_FORGE_API_KEY=<your Gemini API key>
AI_MODEL=gemini-2.5-flash
```

Create the key in [Google AI Studio](https://aistudio.google.com/apikey), then
add it to Render as a secret environment variable. Never commit the key or
paste it into chat. Google documents this OpenAI-compatible endpoint at
[ai.google.dev/gemini-api/docs/openai](https://ai.google.dev/gemini-api/docs/openai).

For local, keyless generation with Ollama, use:

```sh
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b
```

Install Ollama from [ollama.com](https://ollama.com), then download the model
before starting SiteSketch:

```sh
ollama pull qwen2.5:7b
```

Ollama must be running wherever the SiteSketch server runs. This mode does not
send prompts to a hosted AI provider and does not require an API key.

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

For Gemini, confirm the service is using the expected provider settings without
printing the secret:

```sh
test "$AI_PROVIDER" = "gemini" && echo "Gemini provider selected"
test "$BUILT_IN_FORGE_API_URL" = "https://generativelanguage.googleapis.com/v1beta/openai" && echo "Gemini endpoint configured"
```

### Render deployment

Create a Render Web Service connected to this repository with:

- Build command: `corepack pnpm install --frozen-lockfile && corepack pnpm build`
- Start command: `corepack pnpm start`
- Health check path: `/readyz`

Add the required database, authentication, OAuth, and Gemini variables in the
Render Environment tab. Use Render's secret input for
`BUILT_IN_FORGE_API_KEY`. After deployment, verify generation from the public
domain while your development PC is offline.

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
