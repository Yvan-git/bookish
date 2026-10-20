<#
    run-tests.ps1 — runs the whole Bookish test suite in headless Edge.

    Starts the local static server (if needed), then drives five pages through
    the DevTools protocol:
      * tools/selftest.html  — unit & integration tests (ISBN, XLSX, BnF UNIMARC)
      * tools/uitest.html    — end-to-end UI tests of the mobile application
      * tools/simtest.html   — tests of the desktop simulator
      * tools/laptest.html   — tests of the laptop workspace
      * tools/camtest.html   — tests of the real camera scanner (needs -GrantCamera)

    Usage:  powershell -File tools\run-tests.ps1 [-Port 8080] [-Only uitest]
#>
[CmdletBinding()]
param(
  [int]$Port = 8080,
  [string]$Only = "",
  [switch]$NoServe
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$root = Split-Path -Parent $PSScriptRoot
$base = "http://localhost:$Port"

function Write-Head([string]$text) {
  Write-Output ""
  Write-Output "============================================================"
  Write-Output $text
  Write-Output "============================================================"
}

# --------------------------------------------------------------- static server
$server = $null
if (-not $NoServe) {
  try {
    $probe = Invoke-WebRequest -Uri "$base/app/index.html" -UseBasicParsing -TimeoutSec 3
    if ($probe.StatusCode -ne 200) { throw "bad status" }
    Write-Output "Serveur déjà en écoute sur $base"
  } catch {
    Write-Output "Démarrage du serveur statique sur le port $Port…"
    $server = Start-Process -FilePath "powershell.exe" -PassThru -WindowStyle Hidden `
      -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "serve.ps1"), "-Port" $Port
    $ok = $false
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Milliseconds 300
      try {
        $probe = Invoke-WebRequest -Uri "$base/app/index.html" -UseBasicParsing -TimeoutSec 3
        if ($probe.StatusCode -eq 200) { $ok = $true; break }
      } catch { }
    }
    if (-not $ok) { throw "Le serveur statique n'a pas démarré sur le port $Port." }
  }
}

# ------------------------------------------------------------------- suites
$suites = @(
  @{ name = "selftest"; url = "$base/tools/selftest.html"; expr = "window.__selftest" },
  @{ name = "uitest";   url = "$base/tools/uitest.html";   expr = "window.__uitest" },
  @{ name = "simtest";  url = "$base/tools/simtest.html";  expr = "window.__simtest" },
  @{ name = "laptest";  url = "$base/tools/laptest.html";  expr = "window.__laptest" },
  @{ name = "camtest";  url = "$base/tools/camtest.html";  expr = "window.__camtest"; camera = $true }
)

$results = @()
$failed = 0

# Native commands writing to stderr must not abort the script.
$ErrorActionPreference = "Continue"

foreach ($suite in $suites) {
  if ($Only -and $suite.name -ne $Only) { continue }
  Write-Head "Suite : $($suite.name)"
  $extra = @()
  if ($suite.camera) { $extra += "-GrantCamera" }
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "cdp-run.ps1") `
    -Url $suite.url -Expr $suite.expr -TimeoutSec 240 @extra 2>&1
  $text = ($out | Out-String)
  $lines = $text -split "`r?`n" | Where-Object { $_ -match '^\s*"(PASS|FAIL|WARN|INFO)\s' }
  foreach ($l in $lines) { Write-Output ($l.Trim() -replace '^"', '' -replace '",?$', '' -replace '\\u0027', "'") }
  $verdict = ($text | Select-String -Pattern '"verdict":\s*"([^"]+)"' -AllMatches).Matches
  $v = if ($verdict.Count) { $verdict[0].Groups[1].Value } else { "résultat indisponible" }
  if ($v -eq "résultat indisponible") {
    $fallback = ($text | Select-String -Pattern '"title":\s*"([^"]+)"' -AllMatches).Matches
    if ($fallback.Count) {
      $v = if ($fallback[0].Groups[1].Value -match 'OK') { 'TOUS LES TESTS SONT PASSÉS' } else { $fallback[0].Groups[1].Value }
    }
  }
  $results += [pscustomobject]@{ Suite = $suite.name; Verdict = $v }
  if ($v -notmatch 'PASSÉS|PASSED|OK') { $failed++ }
}

# ------------------------------------------------------------ extra checks
if (-not $Only) {
  Write-Head "Vérification des traductions"
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "i18n-check.ps1")
  if ($LASTEXITCODE -ne 0) { $failed++ }
  $results += [pscustomobject]@{ Suite = "i18n"; Verdict = $(if ($LASTEXITCODE -eq 0) { "TOUS LES TESTS SONT PASSÉS" } else { "ÉCHEC" }) }

  Write-Head "Mise en page responsive"
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "responsive-check.ps1") -Port $Port
  if ($LASTEXITCODE -ne 0) { $failed++ }
  $results += [pscustomobject]@{ Suite = "responsive"; Verdict = $(if ($LASTEXITCODE -eq 0) { "TOUS LES TESTS SONT PASSÉS" } else { "ÉCHEC" }) }
}

Write-Head "Récapitulatif"
$results | Format-Table -AutoSize | Out-String | Write-Output

if ($server) { try { $server.Kill() } catch { } }

if ($failed) { Write-Output "$failed suite(s) en échec."; exit 1 }
Write-Output "Toutes les suites sont vertes."
exit 0
