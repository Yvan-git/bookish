<#
    shots.ps1 — captures screenshots of the main pages for a quick visual check.

    Usage:  powershell -File tools\shots.ps1 [-OutDir .\_shots]
#>
[CmdletBinding()]
param(
  [string]$OutDir = "",
  [int]$Port = 8080
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $root "_shots" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$base = "http://localhost:$Port"

# make sure the server is up
try {
  $probe = Invoke-WebRequest -Uri "$base/app/index.html" -UseBasicParsing -TimeoutSec 3
} catch {
  $srv = Start-Process -FilePath "powershell.exe" -PassThru -WindowStyle Hidden `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "serve.ps1"), "-Port" $Port
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 300
    try { $probe = Invoke-WebRequest -Uri "$base/app/index.html" -UseBasicParsing -TimeoutSec 3; break } catch { }
  }
}

$pages = @(
  @{ name = "app-scan";     url = "$base/app/index.html#/scan";     w = 430;  h = 900 },
  @{ name = "app-library";  url = "$base/app/index.html#/library";  w = 430;  h = 900 },
  @{ name = "app-stats";    url = "$base/app/index.html#/stats";    w = 430;  h = 1100 },
  @{ name = "app-settings"; url = "$base/app/index.html#/settings"; w = 430;  h = 1100 },
  @{ name = "app-desktop";  url = "$base/app/index.html#/library";  w = 1280; h = 900 },
  @{ name = "simulator";    url = "$base/app/simulator.html";       w = 1440; h = 950 },
  @{ name = "laptop";       url = "$base/laptop/index.html";        w = 1440; h = 950 }
)

foreach ($p in $pages) {
  $out = Join-Path $OutDir ($p.name + ".png")
  Write-Output "Capture $($p.name)…"
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "cdp-run.ps1") `
    -Url $p.url -Expr "document.title" -TimeoutSec 60 -Screenshot $out -Width $p.w -Height $p.h -WaitMs 2500 |
    Select-String -Pattern "screenshot|error" | ForEach-Object { "  " + $_.Line.Trim() }
}
Write-Output ""
Write-Output "Captures dans $OutDir"
