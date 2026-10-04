param([string]$SpecPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$specs = Get-Content -Raw -Encoding UTF8 -LiteralPath $SpecPath | ConvertFrom-Json
foreach ($s in $specs) {
  $bmp = New-Object System.Drawing.Bitmap ([int]$s.width), ([int]$s.height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $style = [System.Drawing.FontStyle]::Regular
  if ($s.bold) { $style = [System.Drawing.FontStyle]::Bold }
  $font = New-Object System.Drawing.Font([string]$s.font, [single]$s.fontPx, $style, [System.Drawing.GraphicsUnit]::Pixel)
  foreach ($c in $s.cells) {
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = 'Near'
    if ($c.align -eq 'right') { $sf.Alignment = 'Far' }
    if ($c.align -eq 'center') { $sf.Alignment = 'Center' }
    $sf.LineAlignment = 'Center'
    $sf.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
    $sf.Trimming = [System.Drawing.StringTrimming]::None
    $rect = New-Object System.Drawing.RectangleF ([single]$c.x), ([single]0), ([single]$c.w), ([single]$s.height)
    $g.DrawString([string]$c.text, $font, [System.Drawing.Brushes]::Black, $rect, $sf)
    $sf.Dispose()
  }
  $bmp.Save([string]$s.file, [System.Drawing.Imaging.ImageFormat]::Png)
  $font.Dispose(); $g.Dispose(); $bmp.Dispose()
}