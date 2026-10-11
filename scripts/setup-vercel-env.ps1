# ============================================================
# Push SiteSketch's environment variables to Vercel (Production).
#
# Reads values from the local .env, so no secret is written into this
# script and you never retype a key. NODE_ENV and APP_URL are forced to
# production values, because the local .env intentionally holds dev ones.
#
#   $env:VERCEL_TOKEN = "paste-your-token"
#   powershell -ExecutionPolicy Bypass -File scripts\setup-vercel-env.ps1
#
# Then redeploy (Vercel only applies new variables on a new deployment).
# ============================================================

param(
    [string]$Token = $env:VERCEL_TOKEN,
    [string]$Project = "sitesketch"
)

$ErrorActionPreference = "Stop"

if (-not $Token) {
    Write-Host "Create a token at https://vercel.com/account/tokens" -ForegroundColor Yellow
    $Token = Read-Host "Paste your Vercel token"
}
if (-not $Token) { throw "No token provided." }

# ---- read values from .env -------------------------------------------------
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) { throw "No .env found at $envFile" }

$values = @{}
foreach ($line in Get-Content $envFile) {
    $l = $line.Trim()
    if (-not $l -or $l.StartsWith("#") -or -not $l.Contains("=")) { continue }
    $k, $v = $l -split "=", 2
    $values[$k.Trim()] = $v.Trim()
}

# local .env holds development settings; production needs these two changed
$values["NODE_ENV"] = "production"
$values["APP_URL"]  = "https://$Project.vercel.app"

$required = @("NODE_ENV","APP_URL","DATABASE_URL","SUPABASE_URL","SUPABASE_KEY","GEMINI_API_KEY","JWT_SECRET")
$missing = $required | Where-Object { -not $values.ContainsKey($_) -or -not $values[$_] }
if ($missing) { throw "These are missing or empty in .env: $($missing -join ', ')" }

$headers = @{ Authorization = "Bearer $Token" }

# ---- resolve the project ---------------------------------------------------
try {
    $proj = Invoke-RestMethod -Uri "https://api.vercel.com/v9/projects/$Project" -Headers $headers
} catch {
    throw "Could not find project '$Project'. Check the token has access to it."
}
$id = $proj.id
Write-Host "Project: $($proj.name)  ($id)" -ForegroundColor Cyan

# ---- clear any previous Production copies (so re-runs are clean) -----------
try {
    $existing = Invoke-RestMethod -Uri "https://api.vercel.com/v10/projects/$id/env" -Headers $headers
    foreach ($e in $existing.envs) {
        if ($e.target -contains "production" -and $required -contains $e.key) {
            $target = ($e.target | Where-Object { $_ -eq "production" }) -join ","
            Invoke-RestMethod -Method Delete `
                -Uri "https://api.vercel.com/v10/projects/$id/env/$($e.id)?target=$target" `
                -Headers $headers | Out-Null
            Write-Host "  replaced existing $($e.key)"
        }
    }
} catch {
    Write-Host "  (nothing to replace: $($_.Exception.Message))" -ForegroundColor DarkGray
}

# ---- create them -----------------------------------------------------------
$ok = 0
foreach ($key in $required) {
    $body = @{
        key    = $key
        value  = $values[$key]
        type   = "plain"
        target = @("production")
    } | ConvertTo-Json
    try {
        Invoke-RestMethod -Method Post -Uri "https://api.vercel.com/v10/projects/$id/env" `
            -Headers $headers -ContentType "application/json" -Body $body | Out-Null
        Write-Host "  added $key" -ForegroundColor Green
        $ok++
    } catch {
        Write-Host "  FAILED $key : $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "$ok of $($required.Count) variables set for Production." -ForegroundColor Cyan
Write-Host "Next: Deployments tab -> ... on the latest deploy -> Redeploy." -ForegroundColor Cyan
Write-Host "Then check https://$Project.vercel.app/api/health for `"`"missing`": []`"" -ForegroundColor Cyan