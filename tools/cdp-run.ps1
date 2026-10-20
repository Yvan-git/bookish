<#
    cdp-run.ps1 — minimal Chrome DevTools Protocol driver.

    Why this exists: `msedge --headless --dump-dom --virtual-time-budget=N`
    advances *virtual* time instantly, so `setTimeout` fires immediately while
    real IndexedDB callbacks are still pending — the DOM is dumped before the
    database work completes and the run is non-deterministic.

    This driver launches Edge headless with a remote debugging port, attaches
    over WebSocket and evaluates a JavaScript expression in the page. The page
    runs in *real* time, so IndexedDB, network calls and timers behave exactly
    as they do in a normal browser.

    Usage:
      powershell -File tools\cdp-run.ps1 -Url http://localhost:8080/tools/uitest.html `
                 -Expr "window.__uitest" -TimeoutSec 120
#>
[CmdletBinding()]
param(
  [string]$Url = "http://localhost:8080/tools/uitest.html",
  [string]$Expr = "window.__uitest",
  [string]$ExprFile = "",
  [int]$TimeoutSec = 120,
  [int]$Port = 0,
  [string]$EdgePath = "",
  [switch]$KeepProfile,
  [string]$Screenshot = "",
  [int]$Width = 1280,
  [int]$Height = 900,
  [int]$WaitMs = 1500,
  [string[]]$ExtraArgs = @(),
  [switch]$GrantCamera
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if ($ExprFile) {
  $Expr = (Get-Content -LiteralPath $ExprFile -Raw -Encoding UTF8)
}

# --------------------------------------------------------------- edge binary
function Resolve-Edge {
  param([string]$Explicit)
  if ($Explicit -and (Test-Path $Explicit)) { return $Explicit }
  $candidates = @(
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  throw "Microsoft Edge introuvable. Passez -EdgePath <chemin>."
}
$edge = Resolve-Edge -Explicit $EdgePath

# ------------------------------------------------------------ launch browser
$profile = Join-Path $env:TEMP ("bookish-cdp-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $profile | Out-Null

$proc = $null
$ws = $null
$exitCode = 0

function Stop-Browser {
  if ($proc) {
    try { & taskkill.exe /PID $proc.Id /T /F 2>&1 | Out-Null } catch { }
  }
  if (-not $KeepProfile) {
    try { Remove-Item -Recurse -Force $profile -ErrorAction SilentlyContinue } catch { }
  }
}

# ------------------------------------------------------------- websocket cdp
function Send-Cdp {
  param($Socket, [int]$Id, [string]$Method, $Params)
  $payload = @{ id = $Id; method = $Method; params = $Params } | ConvertTo-Json -Depth 16 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $seg = New-Object System.ArraySegment[byte] (,$bytes)
  $Socket.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait() | Out-Null
}

function Receive-Cdp {
  param($Socket, [int]$TimeoutMs)
  $cts = New-Object System.Threading.CancellationTokenSource
  $cts.CancelAfter($TimeoutMs)
  $buf = New-Object byte[] 262144
  $ms = New-Object System.IO.MemoryStream
  try {
    do {
      $seg = New-Object System.ArraySegment[byte] (,$buf)
      $res = $Socket.ReceiveAsync($seg, $cts.Token).GetAwaiter().GetResult()
      if ($res.Count -gt 0) { $ms.Write($buf, 0, $res.Count) }
    } while (-not $res.EndOfMessage)
  } catch {
    return ""
  } finally { $cts.Dispose() }
  [Text.Encoding]::UTF8.GetString($ms.ToArray())
}

try {
  # ---------------------------------------------------------- find a target
  $target = $null
  $wsUrl = $null
  $deadline = (Get-Date).AddSeconds(60)

  while ((Get-Date) -lt $deadline -and -not $target) {
    if (-not $Port) { $Port = Get-Random -Minimum 9400 -Maximum 9999 }

    $edgeArgs = @(
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-features=Translate,MediaRouter",
      "--remote-allow-origins=*",
      "--remote-debugging-port=$Port",
      "--user-data-dir=$profile",
      $Url
    )
    if ($ExtraArgs) { $edgeArgs = $edgeArgs[0..($edgeArgs.Count - 2)] + $ExtraArgs + $Url }
    $proc = Start-Process -FilePath $edge -ArgumentList $edgeArgs -PassThru -WindowStyle Hidden

    # The DevTools HTTP endpoint appears a moment after the process starts.
    $httpDeadline = (Get-Date).AddSeconds(25)
    while ((Get-Date) -lt $httpDeadline) {
      try {
        $list = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 3
        $match = @($list | Where-Object { $_.type -eq "page" -and $_.url -like "http*" })[0]
        if ($match -and $match.webSocketDebuggerUrl) { $target = $match; $wsUrl = $match.webSocketDebuggerUrl; break }
      } catch { }
      if ($proc.HasExited) { break }
      Start-Sleep -Milliseconds 250
    }
    if ($target) { break }

    # Port busy or browser refused to start — try another one.
    Stop-Browser
    $proc = $null
    $Port = 0
  }

  if (-not $target) { throw "Aucune page accessible via le port de debug." }

  # ------------------------------------------------------------- connect
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  $ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(20)
  $connected = $false
  for ($i = 0; $i -lt 10 -and -not $connected; $i++) {
    try {
      [void]($ws.ConnectAsync([Uri]$wsUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult())
      $connected = $true
    } catch {
      Start-Sleep -Milliseconds 400
      try { $ws.Dispose() } catch { }
      $ws = New-Object System.Net.WebSockets.ClientWebSocket
      $ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(20)
    }
  }
  if (-not $connected) { throw "Connexion WebSocket au protocole DevTools impossible." }

  Send-Cdp -Socket $ws -Id 1 -Method "Runtime.enable" -Params @{}
  Send-Cdp -Socket $ws -Id 2 -Method "Page.enable" -Params @{}
  # Apply the requested viewport before evaluating, so the expression sees it.
  Send-Cdp -Socket $ws -Id 4 -Method "Emulation.setDeviceMetricsOverride" -Params @{
    width = $Width; height = $Height; deviceScaleFactor = 1; mobile = $false
  }
  if ($GrantCamera) {
    $origin = ([Uri]$Url).GetLeftPart([System.UriPartial]::Authority)
    Send-Cdp -Socket $ws -Id 5 -Method "Browser.grantPermissions" -Params @{
      origin = $origin
      permissions = @("videoCapture", "audioCapture")
    }
  }

  # -------------------------------------------------------- evaluate (retry)
  $console = New-Object System.Collections.Generic.List[string]
  $result = $null
  $errMsg = $null
  $id = 3
  $attempts = 0
  $deadline = (Get-Date).AddSeconds($TimeoutSec)

  while ((Get-Date) -lt $deadline) {
    $attempts++
    Send-Cdp -Socket $ws -Id $id -Method "Runtime.evaluate" -Params @{
      expression    = $Expr
      awaitPromise  = $true
      returnByValue = $true
      timeout       = ($TimeoutSec * 1000)
      userGesture   = $true
    }

    $answered = $false
    while ((Get-Date) -lt $deadline) {
      $remaining = [int]([Math]::Max(1000, ($deadline - (Get-Date)).TotalMilliseconds))
      $raw = Receive-Cdp -Socket $ws -TimeoutMs $remaining
      if (-not $raw) { continue }
      try { $msg = $raw | ConvertFrom-Json } catch { continue }

      if ($msg.method -eq "Runtime.consoleAPICalled") {
        $parts = @($msg.params.args | ForEach-Object {
          if ($_.value -ne $null) { [string]$_.value } elseif ($_.description) { [string]$_.description } else { "" }
        })
        $console.Add("[" + $msg.params.type + "] " + ($parts -join " "))
        continue
      }
      if ($msg.method -eq "Runtime.exceptionThrown") {
        $d = $msg.params.exceptionDetails
        $console.Add("[exception] " + $d.text + " " + $(if ($d.exception) { $d.exception.description } else { "" }))
        continue
      }
      if ($msg.id -eq $id) {
        $answered = $true
        if ($msg.result) {
          if ($msg.result.exceptionDetails) {
            $errMsg = $msg.result.exceptionDetails.text + " " + $(if ($msg.result.exceptionDetails.exception) { $msg.result.exceptionDetails.exception.description } else { "" })
          } else {
            $result = $msg.result.result
            if ($msg.result.result.subtype -eq "error") { $errMsg = $msg.result.result.description }
          }
        } else {
          $errMsg = "Réponse CDP vide"
        }
        break
      }
    }
    if (-not $answered) { break }

    # `window.__x` may not exist yet if the module script has not run: retry.
    # The promise is re-evaluated each time, so a slow page (live API calls)
    # simply keeps returning "undefined" until it settles: be generous here.
    $isUndefined = $false
    if ($result) { $isUndefined = ($null -eq $result.value -and $result.type -eq "undefined") }
    if ($isUndefined -and $attempts -lt 200) {
      $result = $null
      Start-Sleep -Milliseconds 500
      $id++
      continue
    }
    break
  }

  if ($console.Count) {
    Write-Output "---- console ----"
    $console | ForEach-Object { Write-Output $_ }
  }

  # ------------------------------------------------------------- screenshot
  if ($Screenshot) {
    try {
      Send-Cdp -Socket $ws -Id 91 -Method "Page.navigate" -Params @{ url = $Url }
      Start-Sleep -Milliseconds ([Math]::Max(1500, $WaitMs))
      Send-Cdp -Socket $ws -Id 92 -Method "Page.captureScreenshot" -Params @{ format = "png"; captureBeyondViewport = $true }
      $shotId = 92
      $shotDeadline = (Get-Date).AddSeconds(30)
      while ((Get-Date) -lt $shotDeadline) {
        $raw = Receive-Cdp -Socket $ws -TimeoutMs 15000
        if (-not $raw) { continue }
        try { $msg = $raw | ConvertFrom-Json } catch { continue }
        if ($msg.id -eq $shotId) {
          if ($msg.result -and $msg.result.data) {
            $bytes = [Convert]::FromBase64String($msg.result.data)
            [IO.File]::WriteAllBytes($Screenshot, $bytes)
            Write-Output "---- screenshot ----"
            Write-Output "$Screenshot ($($bytes.Length) octets)"
          }
          break
        }
      }
    } catch {
      Write-Output "---- screenshot error ----"
      Write-Output $_.Exception.Message
    }
  }

  if ($errMsg) {
    Write-Output "---- error ----"
    Write-Output $errMsg
    $exitCode = 2
  } else {
    Write-Output "---- result ----"
    if ($result -and $result.type -eq "string") { Write-Output $result.value }
    elseif ($result -is [string]) { Write-Output $result }
    else { $result | ConvertTo-Json -Depth 12 }
  }
}
catch {
  Write-Output "---- error ----"
  Write-Output $_.Exception.Message
  $exitCode = 2
}
finally {
  if ($ws) {
    try { $ws.Dispose() } catch { }
  }
  Stop-Browser
}
exit $exitCode
