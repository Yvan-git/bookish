<#
  tunnel.ps1 — exposes the local Bookish server over HTTPS so an Android
  phone can install and use the app (the camera and the service worker both
  require a *secure* context: https, or localhost).

  Usage:
    powershell -ExecutionPolicy Bypass -File tools\tunnel.ps1
    powershell -ExecutionPolicy Bypass -File tools\tunnel.ps1 -Port 8080

  It looks for, in order:
    1. cloudflared  (Cloudflare quick tunnel, free, no account needed)
    2. ngrok        (free account required)
  If neither is installed it prints the one-line command to install one.

  cloudflared can be installed with:
    winget install --id Cloudflare.cloudflared
  ngrok with:
    winget install --id ngrok.ngrok
#>
[CmdletBinding()]
param(
  [int]$Port = 8080,
  [switch]$NoServe
)

$ErrorActionPreference = 'Stop'
$base = "http://localhost:$Port"

function Write-Head($text) {
  Write-Host ""
  Write-Host "=== $text ===" -ForegroundColor Cyan
}

# ------------------------------------------------------------- local server
if (-not $NoServe) {
  $up = $false
  try { $null = Invoke-WebRequest "$base/app/index.html" -UseBasicParsing -TimeoutSec 3; $up = $true } catch { }
  if (-not $up) {
    Write-Head "Demarrage du serveur local"
    Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -PassThru `
      -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "serve.ps1"), "-Port" $Port | Out-Null
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Milliseconds 300
      try { $null = Invoke-WebRequest "$base/app/index.html" -UseBasicParsing -TimeoutSec 3; $up = $true; break } catch { }
    }
    if (-not $up) { throw "Le serveur local n'a pas demarre sur le port $Port." }
  }
  Write-Host "Serveur local : OK ($base)" -ForegroundColor Green
}

# ------------------------------------------------------------------ tunnel
$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
$ngrok = (Get-Command ngrok -ErrorAction SilentlyContinue).Source

if (-not $cloudflared -and -not $ngrok) {
  Write-Head "Aucun tunnel installe"
  Write-Host "Le telephone a besoin d'une adresse https (la camera et le"
  Write-Host "service worker refusent le http simple sur une adresse IP)."
  Write-Host ""
  Write-Host "Option 1 - Cloudflare (gratuit, sans compte) :" -ForegroundColor Yellow
  Write-Host "    winget install --id Cloudflare.cloudflared"
  Write-Host "    powershell -File tools\tunnel.ps1"
  Write-Host ""
  Write-Host "Option 2 - ngrok :" -ForegroundColor Yellow
  Write-Host "    winget install --id ngrok.ngrok"
  Write-Host "    ngrok config add-authtoken <votre-token>"
  Write-Host "    powershell -File tools\tunnel.ps1"
  Write-Host ""
  Write-Host "Option 3 - hebergement statique (dossier 100% statique) :" -ForegroundColor Yellow
  Write-Host "    Netlify Drop  : https://app.netlify.com/drop  (deposer le dossier bookish/)"
  Write-Host "    GitHub Pages  : deposit bookish/ dans un depot, activer Pages"
  Write-Host "    Vercel        : npx vercel --prod"
  Write-Host ""
  Write-Host "Option 4 - reseau local (la camera ne fonctionnera pas) :" -ForegroundColor Yellow
  Write-Host "    powershell -File tools\serve.ps1 -Lan"
  exit 0
}

$log = Join-Path $env:TEMP ("bookish-tunnel-" + [guid]::NewGuid().ToString("N") + ".log")

if ($cloudflared) {
  Write-Head "Cloudflare quick tunnel"
  Write-Host "Demarrage de cloudflared (l'URL apparait dans quelques secondes)…"
  $p = Start-Process -FilePath $cloudflared `
    -ArgumentList @("tunnel", "--url", $base, "--no-autoupdate") `
    -PassThru -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err"
} else {
  Write-Head "ngrok"
  Write-Host "Demarrage de ngrok (l'URL apparait dans quelques secondes)…"
  $p = Start-Process -FilePath $ngrok `
    -ArgumentList @("http", $Port, "--log", "stdout") `
    -PassThru -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err"
}

$publicUrl = $null
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline -and -not $publicUrl) {
  Start-Sleep -Milliseconds 700
  $all = ''
  foreach ($f in @($log, "$log.err")) {
    if (Test-Path $f) { $all += (Get-Content $f -Raw -ErrorAction SilentlyContinue) + "`n" }
  }
  $m = [regex]::Match($all, 'https://[a-z0-9\-]+\.(trycloudflare\.com|ngrok-free\.app|ngrok\.io|ngrok\.app)')
  if ($m.Success) { $publicUrl = $m.Value }
}

if (-not $publicUrl) {
  Write-Host "Impossible de lire l'URL du tunnel. Logs :" -ForegroundColor Yellow
  if (Test-Path "$log.err") { Get-Content "$log.err" -Tail 20 | ForEach-Object { "  $_" } }
  exit 1
}

Write-Host ""
Write-Host "  ADRESSE PUBLIQUE : $publicUrl" -ForegroundColor Green
Write-Host ""
Write-Host "  Sur le telephone :" -ForegroundColor Cyan
Write-Host "    1. ouvrir  $publicUrl/app/index.html  dans Chrome"
Write-Host "    2. menu ⋮  ->  'Ajouter a l'ecran d'accueil'  (ou 'Installer l'application')"
Write-Host "    3. autoriser la camera au premier scan"
Write-Host ""
Write-Host "  Simulateur  : $publicUrl/app/simulator.html"
Write-Host "  Espace laptop: $publicUrl/laptop/index.html"
Write-Host ""
Write-Host "  Ctrl+C pour arreter le tunnel." -ForegroundColor DarkGray

try { while (-not $p.HasExited) { Start-Sleep -Seconds 1 } } finally {
  try { if (-not $p.HasExited) { $p.Kill() } } catch { }
}
