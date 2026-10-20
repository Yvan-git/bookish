<#
  Generates the PWA icons (no external tooling required).
  Usage:  powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
#>
param(
  [string]$OutDir = (Join-Path $PSScriptRoot '..\app\icons')
)

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function New-BookIcon {
  param(
    [int]$Size,
    [string]$FilePath,
    [double]$Pad = 0.0,       # 0.18 for maskable (safe zone)
    [double]$RadiusRatio = 0.22
  )

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)

  # Background: rounded square with a burgundy gradient.
  $inset = [float]($Size * $Pad)
  $rectSize = [float]($Size - 2 * $inset)
  $radius = [float]($Size * $RadiusRatio)

  $shape = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $radius * 2
  $shape.AddArc($inset, $inset, $d, $d, 180, 90)
  $shape.AddArc($inset + $rectSize - $d, $inset, $d, $d, 270, 90)
  $shape.AddArc($inset + $rectSize - $d, $inset + $rectSize - $d, $d, $d, 0, 90)
  $shape.AddArc($inset, $inset + $rectSize - $d, $d, $d, 90, 90)
  $shape.CloseFigure()

  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point($Size, $Size)),
    [System.Drawing.Color]::FromArgb(255, 150, 62, 72),
    [System.Drawing.Color]::FromArgb(255, 106, 30, 38)
  )
  $g.FillPath($brush, $shape)
  $brush.Dispose()

  # Open book glyph (white).
  $cx = [float]($Size / 2)
  $cy = [float]($Size / 2)
  $w = [float]($Size * 0.30)   # half width
  $h = [float]($Size * 0.21)   # half height

  $book = New-Object System.Drawing.Drawing2D.GraphicsPath
  # left page
  $book.AddBezier(
    ($cx - $w), ($cy - $h * 0.55),
    ($cx - $w * 0.62), ($cy - $h * 1.02),
    ($cx - $w * 0.28), ($cy - $h * 0.92),
    ($cx - 0.5), ($cy - $h * 0.72)
  )
  $book.AddLine(($cx - 0.5), ($cy - $h * 0.72), ($cx - 0.5), ($cy + $h * 0.86))
  $book.AddBezier(
    ($cx - 0.5), ($cy + $h * 0.86),
    ($cx - $w * 0.30), ($cy + $h * 0.66),
    ($cx - $w * 0.64), ($cy + $h * 0.78),
    ($cx - $w), ($cy + $h * 0.55)
  )
  $book.CloseFigure()
  # right page
  $book.AddBezier(
    ($cx + $w), ($cy - $h * 0.55),
    ($cx + $w * 0.62), ($cy - $h * 1.02),
    ($cx + $w * 0.28), ($cy - $h * 0.92),
    ($cx + 0.5), ($cy - $h * 0.72)
  )
  $book.AddLine(($cx + 0.5), ($cy - $h * 0.72), ($cx + 0.5), ($cy + $h * 0.86))
  $book.AddBezier(
    ($cx + 0.5), ($cy + $h * 0.86),
    ($cx + $w * 0.30), ($cy + $h * 0.66),
    ($cx + $w * 0.64), ($cy + $h * 0.78),
    ($cx + $w), ($cy + $h * 0.55)
  )
  $book.CloseFigure()

  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 250, 248))
  $g.FillPath($white, $book)
  $white.Dispose()

  # Spine.
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(90, 117, 36, 45), [float]($Size * 0.018))
  $g.DrawLine($pen, $cx, ($cy - $h * 0.72), $cx, ($cy + $h * 0.86))
  $pen.Dispose()

  $book.Dispose()
  $shape.Dispose()

  $bmp.Save($FilePath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  Write-Host "wrote $FilePath ($Size x $Size)"
}

New-BookIcon -Size 192 -FilePath (Join-Path $OutDir 'icon-192.png')
New-BookIcon -Size 512 -FilePath (Join-Path $OutDir 'icon-512.png')
New-BookIcon -Size 512 -FilePath (Join-Path $OutDir 'icon-maskable-512.png') -Pad 0.12 -RadiusRatio 0.5

Write-Host "Icons generated in $OutDir"
