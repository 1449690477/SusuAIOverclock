param([string]$Release = 'C:\Users\Administrator\Desktop\workbuddy-shiyi-pack\dango-desk\release')
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $Release -PathType Container)) { throw 'Missing release directory' }
$old = Join-Path $Release 'SusuAIOverclock-1.5.5-portable-isolated.zip'
$dest = Join-Path $Release 'SusuAIOverclock-1.5.5-portable-electron33.4.11-SUPERSEDED.zip'
if (Test-Path -LiteralPath $dest) { throw 'Superseded archive already exists; do not overwrite evidence' }
$hash = (Get-FileHash -LiteralPath $old -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne '88fd06a74d029661b40ddf0f2d9fe711021961cf89f38e4d8bc9c5cd47d8f29c') { throw 'Previous archive hash mismatch' }
[IO.File]::Move($old, $dest)
$report = Join-Path $Release 'SusuAIOverclock-1.5.5-isolated-report.json'
$reportDest = Join-Path $Release 'SusuAIOverclock-1.5.5-electron33.4.11-SUPERSEDED-report.json'
if (Test-Path -LiteralPath $report) {
  if (Test-Path -LiteralPath $reportDest) { throw 'Previous report destination already exists' }
  [IO.File]::Move($report, $reportDest)
}
[ordered]@{supersededArchive=$dest;sha256=(Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash.ToLowerInvariant();previousReport=$reportDest;contentsModified=$false} | ConvertTo-Json
