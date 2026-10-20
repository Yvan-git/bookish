<#
    responsive-check.ps1 — checks that the application never overflows
    horizontally and that the navigation adapts (bottom bar on phones,
    sidebar on desktop) at several viewport widths.

    Usage:  powershell -File tools\responsive-check.ps1
#>
[CmdletBinding()]
param(
  [int]$Port = 8080,
  [string]$View = "library"
)

$ErrorActionPreference = "Stop"
$base = "http://localhost:$Port"

try { $null = Invoke-WebRequest -Uri "$base/app/index.html" -UseBasicParsing -TimeoutSec 3 } catch {
  $srv = Start-Process -FilePath "powershell.exe" -PassThru -WindowStyle Hidden `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "serve.ps1"), "-Port" $Port
  for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Milliseconds 300; try { $null = Invoke-WebRequest -Uri "$base/app/index.html" -UseBasicParsing -TimeoutSec 3; break } catch { } }
}

$sizes = @(
  @{ w = 320; h = 640;  label = "320 (petit téléphone)" },
  @{ w = 390; h = 844;  label = "390 (iPhone 14)" },
  @{ w = 768; h = 1024; label = "768 (tablette)" },
  @{ w = 1024; h = 800; label = "1024 (petit portable)" },
  @{ w = 1440; h = 900; label = "1440 (grand écran)" }
)

$expr = @"
(async () => {
  // Wait for the application to be fully booted (module + IndexedDB).
  for (let i = 0; i < 150; i++) {
    if (window.bookish && window.bookish.state && window.bookish.state.ready
        && document.querySelector('#bottom-nav')) break;
    await new Promise(r => setTimeout(r, 100));
  }
  await new Promise(r => setTimeout(r, 400));
  const de = document.documentElement;
  const nav = document.querySelector('#bottom-nav');
  const cs = nav ? getComputedStyle(nav) : null;
  const navVisible = nav ? cs.display !== 'none' && cs.visibility !== 'hidden' : false;
  const main = document.querySelector('#app-main');
  const overflow = de.scrollWidth - de.clientWidth;
  const offenders = [];
  document.querySelectorAll('#app-main *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > de.clientWidth + 2) {
      offenders.push((el.className || el.tagName) + ' right=' + Math.round(r.right));
    }
  });
  return JSON.stringify({
    w: window.innerWidth,
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    overflow: overflow,
    navVisible: navVisible,
    navMode: cs ? cs.flexDirection : '?',
    mainHeight: main ? main.scrollHeight : 0,
    offenders: offenders.slice(0, 5)
  });
})()
"@

$bad = 0
foreach ($s in $sizes) {
  $out = ""
  for ($try = 1; $try -le 3; $try++) {
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "cdp-run.ps1") `
      -Url "$base/app/index.html#/$View" -Expr $expr -TimeoutSec 60 -Width $s.w -Height $s.h 2>&1 | Out-String
    if ($out -match '"overflow":\s*(-?\d+)') { break }
    Start-Sleep -Milliseconds 700
  }
  $m = [regex]::Match($out, '"overflow":\s*(-?\d+)')
  $o = if ($m.Success) { [int]$m.Groups[1].Value } else { 999 }
  $nav = if ($out -match '"navVisible":\s*(true|false)') { $Matches[1] } else { "?" }
  $mode = if ($out -match '"navMode":\s*"([a-z-]+)"') { $Matches[1] } else { "?" }
  $expected = if ($s.w -ge 900) { "column" } else { "row" }
  $off = ([regex]::Match($out, '"offenders":\s*\[(.*?)\]', 'Singleline')).Groups[1].Value
  $status = if ($o -le 0) { "OK " } else { "OVERFLOW " ; }
  if ($o -gt 0) { $bad++ }
  if ($mode -ne $expected) { $status = "NAV  " ; $bad++ }
  "{0} {1,-22} viewport={2,5}  debordement={3,3}px  nav={4}/{5} (attendu {6}) {7}" -f $status, $s.label, $s.w, $o, $nav, $mode, $expected, $off
  if (-not $m.Success) { Write-Output "     (driver: " + (($out -split "`r?`n" | Where-Object { $_ -match 'error|Error' } | Select-Object -First 1) -join "") + ")" }
}
if ($bad) { Write-Output "$bad anomalie(s) de mise en page."; exit 1 }
Write-Output "Mise en page correcte a toutes les largeurs."
exit 0
