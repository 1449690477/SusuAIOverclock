param(
  [string]$Project = 'C:\Users\Administrator\Desktop\workbuddy-shiyi-pack\dango-desk',
  [string]$Output = 'C:\Users\Administrator\AppData\Local\Temp\opencode\susu155-source.zip'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# HOST ONLY: built-in .NET source serialization. Never load project JS, npm,
# tools, archives or dependencies. No external compressor and no payload runs.
if (!(Test-Path -LiteralPath $Project -PathType Container)) { throw 'Missing project' }
if (!(Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($Output)) -PathType Container)) { throw 'Missing output parent' }
if (Test-Path -LiteralPath $Output) { throw 'Refusing to overwrite existing source archive' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Project = [IO.Path]::GetFullPath($Project).TrimEnd('\')
$files = [Collections.Generic.List[string]]::new()
$excluded = [Collections.Generic.List[string]]::new()
$omit = @('node_modules','.git','dist-electron','release','release-next','release-final','quarantine','backups','evidence','__pycache__','_quarantine','_deprecated-omen-bridge','codex','codex-panghu','anti-gravity')
function Visit([string]$relative) {
  $full = [IO.Path]::Combine($Project, $relative)
  $attr = [IO.File]::GetAttributes($full)
  if (($attr -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Reparse source rejected: $relative" }
  $name = [IO.Path]::GetFileName($full)
  if ($omit -contains $name -or $name.StartsWith('.security-quarantine') -or $name -in @('_cli-layer-state.json','_inject-layer-state.json') -or $name.EndsWith('.pyc')) { $excluded.Add($relative); return }
  if (($attr -band [IO.FileAttributes]::Directory) -ne 0) {
    foreach ($child in [IO.Directory]::EnumerateFileSystemEntries($full)) { Visit ($child.Substring($Project.Length + 1)) }
  } else {
    # Opaque archives are not reviewed source. Do not carry hidden executables.
    if ([IO.Path]::GetExtension($name) -match '^\.(zip|7z|rar|tar|gz|xz|bz2|whl|iso)$') { $excluded.Add($relative); return }
    if ([IO.Path]::GetExtension($name) -match '^\.(exe|dll|pyd|node|scr|com|msi|sys)$') { throw "Executable extension in source: $relative" }
    $files.Add($relative)
  }
}
foreach ($name in @('package.json','package-lock.json','vite.config.mjs','tsconfig.json','LICENSE','electron','src','build\icon.png','build\portable-fast.nsi','build\library\library.json','scripts\pack-portable.cjs','scripts\before-build.cjs','scripts\preflight-security.cjs','scripts\apply-portable-patch.cjs','tests\security-preflight.test.cjs','tests\security-quarantine.test.cjs','packed-packs\NOTICE.txt','packed-packs\cursor','packed-packs\dsh','packed-packs\opencode','packed-packs\workbuddy','packed-packs\workbuddy-ai')) { Visit $name }
foreach ($file in [IO.Directory]::EnumerateFiles([IO.Path]::Combine($Project,'scripts'),'isolated-build*')) { Visit ($file.Substring($Project.Length + 1)) }
foreach ($file in [IO.Directory]::EnumerateFiles([IO.Path]::Combine($Project,'scripts'),'isolated-gui-smoke.*')) { Visit ($file.Substring($Project.Length + 1)) }
$manifest = [Collections.Generic.List[object]]::new()
$hash = [Security.Cryptography.SHA256]::Create()
$zip = [IO.Compression.ZipFile]::Open($Output, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($relative in ($files | Sort-Object -Unique)) {
    $bytes = [IO.File]::ReadAllBytes([IO.Path]::Combine($Project,$relative))
    if ($bytes.Length -ge 2 -and $bytes[0] -eq 77 -and $bytes[1] -eq 90) { throw "MZ binary in source: $relative" }
    $entryName = $relative.Replace('\','/')
    $sha = [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()
    $manifest.Add([ordered]@{path=$entryName;size=$bytes.Length;sha256=$sha})
    $entry = $zip.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
  }
  $report = [ordered]@{schemaVersion=1;createdUtc=[DateTime]::UtcNow.ToString('o');projectVersion='1.5.6';files=$manifest;excluded=$excluded;limitation='Source-only snapshot from incident host; not an antivirus verdict or hypervisor attestation.'}
  $json = $report | ConvertTo-Json -Depth 8
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $stream = $zip.CreateEntry('SOURCE-MANIFEST.json').Open()
  try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
} finally { $zip.Dispose(); $hash.Dispose() }
$archiveHash = Get-FileHash -LiteralPath $Output -Algorithm SHA256
[ordered]@{archive=$Output;sha256=$archiveHash.Hash.ToLowerInvariant();size=([IO.FileInfo]::new($Output)).Length;files=$manifest.Count;excluded=$excluded} | ConvertTo-Json -Depth 5
