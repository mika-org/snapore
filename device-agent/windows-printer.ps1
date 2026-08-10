[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('discover', 'print')]
  [string]$Mode,
  [string]$QueueName,
  [string]$FilePath,
  [int]$Copies = 1,
  [string]$MediaName = '4x6',
  [ValidateSet('portrait', 'landscape')]
  [string]$Orientation = 'portrait',
  [bool]$Borderless = $true
)

$ErrorActionPreference = 'Stop'

if ($Mode -eq 'discover') {
  if (-not (Get-Command Get-Printer -ErrorAction SilentlyContinue)) {
    throw 'Windows PrintManagement module tidak tersedia.'
  }
  @(Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus, WorkOffline, Type) | ConvertTo-Json -Compress
  exit 0
}

if ([string]::IsNullOrWhiteSpace($QueueName)) { throw 'QueueName wajib diberikan.' }
if ([string]::IsNullOrWhiteSpace($FilePath)) { throw 'FilePath wajib diberikan.' }
$resolvedFile = (Resolve-Path -LiteralPath $FilePath -ErrorAction Stop).Path

Add-Type -AssemblyName System.Drawing
$document = New-Object System.Drawing.Printing.PrintDocument
$image = $null
$handler = $null
try {
  $document.PrinterSettings.PrinterName = $QueueName
  if (-not $document.PrinterSettings.IsValid) { throw "Queue printer '$QueueName' tidak valid." }
  $document.PrinterSettings.Copies = [int16][Math]::Max(1, [Math]::Min(10, $Copies))
  $document.PrintController = New-Object System.Drawing.Printing.StandardPrintController
  $document.DefaultPageSettings.Landscape = $Orientation -eq 'landscape'
  if ($Borderless) { $document.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0) }

  $mediaPattern = switch -Regex ($MediaName) {
    '^4\s*x\s*6$' { '4.?x.?6|10.?x.?15|postcard'; break }
    '^5\s*x\s*7$' { '5.?x.?7|13.?x.?18'; break }
    '^6\s*x\s*8$' { '6.?x.?8|15.?x.?20'; break }
    default { [regex]::Escape($MediaName) }
  }
  $paper = @($document.PrinterSettings.PaperSizes) | Where-Object { $_.PaperName -match $mediaPattern } | Select-Object -First 1
  if ($paper) { $document.DefaultPageSettings.PaperSize = $paper }

  $image = [System.Drawing.Image]::FromFile($resolvedFile)
  $handler = [System.Drawing.Printing.PrintPageEventHandler]{
    param($sender, $eventArgs)
    $bounds = $eventArgs.PageBounds
    $scale = [Math]::Max($bounds.Width / $image.Width, $bounds.Height / $image.Height)
    $width = [int][Math]::Ceiling($image.Width * $scale)
    $height = [int][Math]::Ceiling($image.Height * $scale)
    $x = [int](($bounds.Width - $width) / 2)
    $y = [int](($bounds.Height - $height) / 2)
    $eventArgs.Graphics.DrawImage($image, $x, $y, $width, $height)
    $eventArgs.HasMorePages = $false
  }
  $document.add_PrintPage($handler)
  $document.Print()
  [pscustomobject]@{ queueName = $QueueName; status = 'SPOOLING'; mediaName = $MediaName } | ConvertTo-Json -Compress
} finally {
  if ($handler) { $document.remove_PrintPage($handler) }
  if ($image) { $image.Dispose() }
  $document.Dispose()
}
