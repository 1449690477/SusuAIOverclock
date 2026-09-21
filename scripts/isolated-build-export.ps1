param(
  [string]$Project = 'C:\Users\Administrator\Desktop\workbuddy-shiyi-pack\dango-desk',
  [string]$Output = 'C:\Users\Administrator\AppData\Local\Temp\opencode\susu157-source.zip'
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
$hash = [Security.Cryptography.SHA256]::Create()
$shaOf = { param($bytes) [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() }

# Distribution is not a deploy permission. All nine pack trees ship so that a
# registered quarantine consent has an actual payload to install; RELEASE_PACK_IDS
# stays the deploy allowlist and the quarantined ids remain blocked at runtime
# until the user ticks the consent box. Keeping the two axes separate here is what
# fixes the v1.5.6 defect where the checkbox unlocked a pack that was never built
# into the artifact.
$packIds = @('cursor','dsh','claude','opencode','workbuddy','workbuddy-ai','codex','codex-panghu','anti-gravity')
$quarantinedPacks = @('codex','codex-panghu','anti-gravity')
$payloadPrefixes = @($quarantinedPacks | ForEach-Object { "packed-packs\$_\" })

function Test-PayloadPath([string]$relative) {
  foreach ($prefix in $payloadPrefixes) {
    if ($relative.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}

# Names excluded anywhere, because package.json's extraResources filter excludes
# them too (PACK_EXCLUSIONS in preflight-security.cjs: !**/backups/**,
# !**/evidence/**, !**/__pycache__/**, !**/_quarantine/**,
# !**/_deprecated-omen-bridge/**, !**/_cli-layer-state.json,
# !**/_inject-layer-state.json, !**/*.pyc, !**/.gitkeep). Keeping these
# basename-global is what holds host/guest parity for the artifact.
# `.gitkeep` is the odd one out: it is not a security exclusion, it is the
# builder's own hard-coded skip in builder-util copyDir (Go `app-builder
# copy-dir`), proven with a minimal fixture in the guest. Dropping it here keeps
# the source archive byte-for-byte in step with what actually ships.
$omitAnywhere = @('backups','evidence','__pycache__','_quarantine','_deprecated-omen-bridge','.gitkeep')
# Build outputs and hygiene directories that only exist at the project root. They
# must NOT be matched by basename: a pack legitimately vendors its own
# node_modules (opencode) and keeps its own release/ folder (codex-panghu), and
# both are inside the extraResources filter. Dropping them by basename alone made
# the guest source tree disagree with the filter, so v1.5.6 shipped an artifact
# silently missing packed-packs/opencode/node_modules and
# packed-packs/codex-panghu/keysmith/release.
$omitAtRoot = @('node_modules','.git','dist-electron','release','release-next','release-final')
function Visit([string]$relative) {
  $full = [IO.Path]::Combine($Project, $relative)
  $attr = [IO.File]::GetAttributes($full)
  if (($attr -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Reparse source rejected: $relative" }
  $name = [IO.Path]::GetFileName($full)
  $atRoot = -not $relative.Contains('\')
  if (($atRoot -and $omitAtRoot -contains $name) -or $omitAnywhere -contains $name -or $name.StartsWith('.security-quarantine') -or $name -in @('_cli-layer-state.json','_inject-layer-state.json') -or $name.EndsWith('.pyc')) { $excluded.Add($relative); return }
  if (($attr -band [IO.FileAttributes]::Directory) -ne 0) {
    foreach ($child in [IO.Directory]::EnumerateFileSystemEntries($full)) { Visit ($child.Substring($Project.Length + 1)) }
  } else {
    $extension = [IO.Path]::GetExtension($name).ToLowerInvariant()
    $payload = Test-PayloadPath $relative
    if ($extension -match '^\.(zip|7z|rar|tar|gz|xz|bz2|iso)$') { $excluded.Add($relative); return }
    # The panghu tree ships ensurepip's bundled wheel; without it the shipped
    # interpreter cannot bootstrap pip. It is opaque, so its hash is recorded.
    if ($extension -eq '.whl' -and -not $payload) { $excluded.Add($relative); return }
    # Opaque archives are not reviewed source. Do not carry hidden executables,
    # and do not carry executables outside the reviewed quarantined payload.
    if ($extension -match '^\.(exe|dll|pyd|node|scr|com|msi|sys)$' -and -not $payload) { throw "Executable extension in source: $relative" }
    $files.Add($relative)
  }
}
foreach ($id in $packIds) { Visit "packed-packs\$id" }
foreach ($name in @('package.json','package-lock.json','vite.config.mjs','tsconfig.json','LICENSE','electron','src','build\icon.png','build\portable-fast.nsi','build\library\library.json','scripts\pack-portable.cjs','scripts\before-build.cjs','scripts\preflight-security.cjs','scripts\apply-portable-patch.cjs','scripts\payload-dedetaint.json','tests\security-preflight.test.cjs','tests\security-quarantine.test.cjs','packed-packs\NOTICE.txt')) { Visit $name }
foreach ($file in [IO.Directory]::EnumerateFiles([IO.Path]::Combine($Project,'scripts'),'isolated-build*')) { Visit ($file.Substring($Project.Length + 1)) }
foreach ($file in [IO.Directory]::EnumerateFiles([IO.Path]::Combine($Project,'scripts'),'isolated-gui-smoke.*')) { Visit ($file.Substring($Project.Length + 1)) }

# v1.5.7: the quarantined payload does NOT come from the quarantine run any more.
# The 1.5.5 sweep moved five payloads into .security-quarantine-1.5.5, and those
# blobs are *themselves* wrapped by the host prepender (fixed text segment
# dd25f3ed..., offset 0x1000, length 0x7f000, identical to node_modules/7za.exe).
# Restoring them verbatim shipped the loader -- which is exactly why the guest
# preflight refused the build. The five payloads now live de-tainted inside
# packed-packs/ and are gated by a content-level baseline instead: exact clean
# size + sha256 per file, plus a scan that rejects any MZ file whose text window
# still matches the loader signature.
$dedetaintPath = [IO.Path]::Combine($Project,'scripts','payload-dedetaint.json')
if (-not (Test-Path -LiteralPath $dedetaintPath -PathType Leaf)) { throw "Missing de-taint baseline: $dedetaintPath" }
$dedetaint = [IO.File]::ReadAllText($dedetaintPath) | ConvertFrom-Json
if (-not $dedetaint.allPass) { throw 'De-taint baseline is not marked allPass; refusing to export' }
if (@($dedetaint.items).Count -ne 5) { throw "De-taint baseline must cover exactly 5 payloads, found $(@($dedetaint.items).Count)" }
$loaderSig = [string]$dedetaint.loader.textWindowSha256
$textOffset = [int]$dedetaint.loader.textWindowOffset
$textLength = [int]$dedetaint.loader.textWindowLength
$align = [int]$dedetaint.loader.alignment
$tailRecord = [int]$dedetaint.loader.tailRecordBytes
if ($loaderSig -notmatch '^[0-9a-f]{64}$') { throw "De-taint baseline has no usable loader text-window signature: $loaderSig" }
# The five payloads are expected clean in packed-packs/, but the incident host's
# prepender polls every 60-120 s for new *.exe and prepends a fixed loader to it.
# A payload written by the de-taint step therefore can be re-wrapped before this
# export runs. Rather than trusting the tree, the export self-heals: if a payload
# file's trailing cleanSize bytes hash to the pinned clean sha256, the leading
# (size - cleanSize) bytes are the loader and are dropped in memory. Nothing
# tainted reaches the archive and no .exe is ever rewritten on disk.
$baseline = @{}
foreach ($item in $dedetaint.items) { $baseline[[string]$item.entryPath] = $item }
if ($baseline.Count -ne 5) { throw "De-taint baseline entry paths are not unique ($($baseline.Count) keys for 5 items)" }

function Recover-Payload([string]$path, [string]$packRel, $item) {
  $bytes = [IO.File]::ReadAllBytes($path)
  $cleanSize = [int]$item.cleanSize
  $cleanSha = [string]$item.cleanSha256
  $record = [ordered]@{path=$packRel;onDiskSize=$bytes.Length;onDiskSha256=(& $shaOf $bytes);cleanSize=$cleanSize;cleanSha256=$cleanSha;stripped=$false}
  if ($bytes.Length -eq $cleanSize) {
    if ((& $shaOf $bytes) -ne $cleanSha) { throw "Payload size matches but content does not: $packRel" }
    return @{ bytes = $bytes; record = $record }
  }
  if ($bytes.Length -lt $cleanSize) { throw "Payload is shorter than the pinned clean copy: $packRel" }
  $head = $bytes.Length - $cleanSize
  if (($head % $align) -ne $tailRecord) { throw "Payload prefix is not the known prepender shape ($head % $align != $tailRecord): $packRel" }
  $body = [byte[]]::new($cleanSize)
  [Array]::Copy($bytes, $head, $body, 0, $cleanSize)
  if ((& $shaOf $body) -ne $cleanSha) { throw "Payload prefix is not a known prepender wrapper (trailing bytes do not match the pinned clean copy): $packRel" }
  if ($body.Length -lt 2 -or $body[0] -ne 77 -or $body[1] -ne 90) { throw "Recovered payload is not an MZ binary: $packRel" }
  $record.stripped = $true
  $record.stripOffset = $head
  return @{ bytes = $body; record = $record }
}

$zip = [IO.Compression.ZipFile]::Open($Output, [IO.Compression.ZipArchiveMode]::Create)
try {
  $manifest = [Collections.Generic.List[object]]::new()
  $payloadBinaries = [Collections.Generic.List[object]]::new()
  $taintedHits = [Collections.Generic.List[object]]::new()
  $dedetainted = [Collections.Generic.List[object]]::new()
  foreach ($relative in ($files | Sort-Object -Unique)) {
    $entryName = $relative.Replace('\','/')
    $bytes = $null
    if ($baseline.ContainsKey($entryName)) {
      $recovered = Recover-Payload ([IO.Path]::Combine($Project,$relative)) $entryName $baseline[$entryName]
      $bytes = $recovered.bytes
      $dedetainted.Add($recovered.record)
    } else {
      $bytes = [IO.File]::ReadAllBytes([IO.Path]::Combine($Project,$relative))
    }
    $payload = Test-PayloadPath $relative
    $isMz = ($bytes.Length -ge 2 -and $bytes[0] -eq 77 -and $bytes[1] -eq 90)
    if ($isMz -and -not $payload) { throw "MZ binary in source: $relative" }
    $sha = & $shaOf $bytes
    $manifest.Add([ordered]@{path=$entryName;size=$bytes.Length;sha256=$sha})
    if ($isMz) {
      $payloadBinaries.Add([ordered]@{path=$entryName;size=$bytes.Length;sha256=$sha})
      if ($bytes.Length -ge ($textOffset + $textLength)) {
        $window = [byte[]]::new($textLength)
        [Array]::Copy($bytes, $textOffset, $window, 0, $textLength)
        if ((& $shaOf $window) -eq $loaderSig) { $taintedHits.Add([ordered]@{path=$entryName;size=$bytes.Length;sha256=$sha}) }
      }
    }
    $entry = $zip.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
  }
  if ($taintedHits.Count -gt 0) {
    throw "Prepender-tainted binary in source archive: $((@($taintedHits | ForEach-Object { $_.path }) -join ', '))"
  }
  if ($dedetainted.Count -ne 5) { throw "Expected exactly 5 de-taint-checked payloads in the archive, got $($dedetainted.Count)" }
  $report = [ordered]@{
    schemaVersion=2
    createdUtc=[DateTime]::UtcNow.ToString('o')
    projectVersion='1.5.7'
    packs=$packIds
    files=$manifest
    payloadBinaries=$payloadBinaries
    dedetaintedPayload=$dedetainted
    loaderSignature=$loaderSig
    restoredFromQuarantine=@()
    excluded=$excluded
    limitation='Source-only snapshot from incident host; not an antivirus verdict or hypervisor attestation. The five pack payloads are carried de-tainted and are checked against a pinned clean size/hash baseline.'
  }
  $json = $report | ConvertTo-Json -Depth 8
  $enc = [Text.Encoding]::UTF8.GetBytes($json)
  $stream = $zip.CreateEntry('SOURCE-MANIFEST.json').Open()
  try { $stream.Write($enc,0,$enc.Length) } finally { $stream.Dispose() }
} finally { $zip.Dispose(); $hash.Dispose() }
$archiveHash = Get-FileHash -LiteralPath $Output -Algorithm SHA256
[ordered]@{archive=$Output;sha256=$archiveHash.Hash.ToLowerInvariant();size=([IO.FileInfo]::new($Output)).Length;files=$manifest.Count;payloadBinaries=$payloadBinaries.Count;dedetainted=$dedetainted.Count;excluded=$excluded.Count} | ConvertTo-Json -Depth 5
