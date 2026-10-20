<#
    i18n-check.ps1 — verifies that every t('key') used in the sources exists in
    both the French and the English dictionaries, and reports unused keys.

    Usage:  powershell -File tools\i18n-check.ps1
#>
[CmdletBinding()]
param([string]$Root = "")

$ErrorActionPreference = "Stop"
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }

$stringsPath = Join-Path $Root "app\js\strings.js"
$lines = Get-Content -LiteralPath $stringsPath -Encoding UTF8

# ---------------------------------------------------------------- dictionaries
$fr = @{}
$en = @{}
$mode = $null
foreach ($line in $lines) {
  if ($line -match '^\s*fr\s*:\s*\{') { $mode = 'fr'; continue }
  if ($line -match '^\s*en\s*:\s*\{') { $mode = 'en'; continue }
  if ($line -match '^\s*\};') { $mode = $null; continue }
  if ($mode -and $line -match "^\s*'([^']+)'\s*:") {
    $key = $Matches[1]
    if ($mode -eq 'fr') { $fr[$key] = $true } else { $en[$key] = $true }
  }
}

# ------------------------------------------------------------------- sources
$used = @{}
$dynamicPrefixes = @{}
$sourceFiles = Get-ChildItem -Path (Join-Path $Root "app") -Recurse -Include *.js, *.html -File
$sourceFiles += Get-ChildItem -Path (Join-Path $Root "laptop") -Recurse -Include *.js, *.html -File
$sourceFiles += Get-ChildItem -Path (Join-Path $Root "shared") -Recurse -Include *.js -File

foreach ($f in $sourceFiles) {
  $content = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8
  foreach ($m in [regex]::Matches($content, "\bt\(\s*'([a-zA-Z0-9_.]+)'")) {
    $k = $m.Groups[1].Value
    if (-not $used.ContainsKey($k)) { $used[$k] = @() }
    $used[$k] += $f.Name
  }
  foreach ($m in [regex]::Matches($content, '\bt\(\s*"([a-zA-Z0-9_.]+)"')) {
    $k = $m.Groups[1].Value
    if (-not $used.ContainsKey($k)) { $used[$k] = @() }
    $used[$k] += $f.Name
  }
  # Dynamic keys: t(`prefix.${…}`) or t('prefix.' + …)
  foreach ($m in [regex]::Matches($content, 't\(\s*`([a-zA-Z0-9_.]+)\.\$\{')) {
    $dynamicPrefixes[$m.Groups[1].Value] = $f.Name
  }
  foreach ($m in [regex]::Matches($content, "t\(\s*'([a-zA-Z0-9_.]+)\.'\s*\+")) {
    $dynamicPrefixes[$m.Groups[1].Value] = $f.Name
  }
}

# Keys reachable through a dynamic prefix count as used.
foreach ($prefix in $dynamicPrefixes.Keys) {
  foreach ($k in @($fr.Keys) + @($en.Keys)) {
    if ($k.StartsWith($prefix + ".") -and -not $used.ContainsKey($k)) { $used[$k] = @($dynamicPrefixes[$prefix]) }
  }
}

# Keys referenced from a definition table (VIEWS, META_FIELDS…) are written as
# plain string literals: look for them anywhere in the sources.
$allText = ($sourceFiles | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 }) -join "`n"
foreach ($k in @($fr.Keys) + @($en.Keys)) {
  if ($used.ContainsKey($k)) { continue }
  if ($allText -match "['`"]" + [regex]::Escape($k) + "['`"]") { $used[$k] = @('literal') }
}

# -------------------------------------------------------------------- report
$problems = 0
Write-Output "Dictionnaires : $($fr.Count) clés FR / $($en.Count) clés EN"
Write-Output "Clés utilisées dans les sources : $($used.Count)"
Write-Output ""

$missingFr = @($used.Keys | Where-Object { -not $fr.ContainsKey($_) } | Sort-Object)
$missingEn = @($used.Keys | Where-Object { -not $en.ContainsKey($_) } | Sort-Object)
$orphanEn = @($en.Keys | Where-Object { -not $fr.ContainsKey($_) } | Sort-Object)
$unused = @($fr.Keys | Where-Object { -not $used.ContainsKey($_) } | Sort-Object)

if ($missingFr.Count) {
  $problems += $missingFr.Count
  Write-Output "MANQUANTES EN FRANCAIS :"
  $missingFr | ForEach-Object { Write-Output "  - $_  (utilisée dans $($used[$_] -join ', '))" }
  Write-Output ""
}
if ($missingEn.Count) {
  $problems += $missingEn.Count
  Write-Output "MANQUANTES EN ANGLAIS :"
  $missingEn | ForEach-Object { Write-Output "  - $_  (utilisée dans $($used[$_] -join ', '))" }
  Write-Output ""
}
if ($orphanEn.Count) {
  $problems += $orphanEn.Count
  Write-Output "PRESENTES EN EN MAIS PAS EN FR :"
  $orphanEn | ForEach-Object { Write-Output "  - $_" }
  Write-Output ""
}
if ($unused.Count) {
  Write-Output "CLÉS DÉFINIES MAIS JAMAIS UTILISÉES ($($unused.Count)) :"
  $unused | ForEach-Object { Write-Output "  - $_" }
  Write-Output ""
}

if ($problems -eq 0) {
  Write-Output "OK — couverture i18n complète."
  exit 0
}
Write-Output "$problems problème(s) de traduction à corriger."
exit 1
