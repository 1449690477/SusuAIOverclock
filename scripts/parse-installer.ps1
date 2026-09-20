$err = $null
$tok = $null
$path = Join-Path $PSScriptRoot '..\packed-packs\codex\install-replica.ps1'
[void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $path), [ref]$tok, [ref]$err)
if ($err -and $err.Count) {
    $err | ForEach-Object { $_.ToString() }
    exit 1
}
Write-Output ("PARSE_OK tokens=" + $tok.Count)
exit 0
