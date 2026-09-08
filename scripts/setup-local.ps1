$ErrorActionPreference = "Stop"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker Desktop is required. Install it from https://www.docker.com/products/docker-desktop/ and run this command again."
}

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example. Review it before starting the app."
}

docker compose up -d postgres
if ($LASTEXITCODE -ne 0) {
  throw "PostgreSQL could not be started."
}

$ready = $false
$containerId = docker compose ps -q postgres
if (-not $containerId) {
  throw "PostgreSQL container was not created."
}
for ($attempt = 1; $attempt -le 30; $attempt++) {
  $status = docker inspect --format '{{.State.Health.Status}}' $containerId 2>$null
  if ($status -eq "healthy") {
    $ready = $true
    break
  }
  Start-Sleep -Seconds 2
}

if (-not $ready) {
  docker compose ps postgres
  throw "PostgreSQL did not become healthy within 60 seconds."
}

corepack pnpm db:push
if ($LASTEXITCODE -ne 0) {
  throw "Database migrations failed."
}

Write-Host "Local PostgreSQL is ready. Start SiteSketch with: corepack pnpm dev"
