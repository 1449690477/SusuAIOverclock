# Sandbox WorkBuddy AI (intl) v1.3. Never writes real ~/.workbuddy-ai or real Programs\WorkBuddyAI.
# ASCII-only + UTF-8 BOM so Windows PowerShell 5.1 can parse it.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

$SrcKit = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\packed-packs\workbuddy-ai')).Path
$Ps1Name = 'Install-WBAI-LazyPack.ps1'
if (-not (Test-Path -LiteralPath (Join-Path $SrcKit $Ps1Name))) {
    throw "missing installer in $SrcKit"
}

$RealUser = $env:USERPROFILE
$GuardFiles = @(
    (Join-Path $RealUser '.workbuddy-ai\IDENTITY.md'),
    (Join-Path $RealUser '.workbuddy-ai\SOUL.md'),
    (Join-Path $RealUser '.workbuddy-ai\models.json'),
    (Join-Path $RealUser '.workbuddy\IDENTITY.md'),
    (Join-Path $env:LOCALAPPDATA 'Programs\WorkBuddyAI\resources\app.asar.unpacked\cli\product.json'),
    (Join-Path $env:LOCALAPPDATA 'Programs\WorkBuddyAI\resources\app.asar.unpacked\cli\dist\codebuddy.js')
)
$GuardBefore = @{}
foreach ($g in $GuardFiles) {
    if (Test-Path -LiteralPath $g) {
        $GuardBefore[$g] = (Get-FileHash -LiteralPath $g -Algorithm SHA256).Hash
    } else {
        $GuardBefore[$g] = 'ABSENT'
    }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$root = Join-Path $env:TEMP ("wbai-selftest-dango-" + $stamp)
$kit = Join-Path $root 'kit'
New-Item -ItemType Directory -Force -Path $kit | Out-Null
Write-Output "COPY_KIT $SrcKit -> $kit"
robocopy $SrcKit $kit /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed exit $LASTEXITCODE" }

$Ps1 = Join-Path $kit $Ps1Name

function Invoke-Setup([string]$HomeDir, [string]$ProgDir, [string[]]$ExtraArgs) {
    New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null
    New-Item -ItemType Directory -Force -Path $ProgDir | Out-Null
    $saved = $env:USERPROFILE
    $env:USERPROFILE = Join-Path $root ('_profile-' + ($ExtraArgs -join '-'))
    New-Item -ItemType Directory -Force -Path $env:USERPROFILE | Out-Null
    try {
        Write-Output ("PY powershell " + ($ExtraArgs -join ' ') + " -WBHomePath $HomeDir -WBProgPath $ProgDir")
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $Ps1 @ExtraArgs -WBHomePath $HomeDir -WBProgPath $ProgDir
        if ($LASTEXITCODE -ne 0) { throw ("setup exit " + $LASTEXITCODE + " args=" + ($ExtraArgs -join ' ')) }
    } finally {
        $env:USERPROFILE = $saved
    }
}

Write-Output ""
Write-Output "========== A CLEAN INSTALL =========="
$aHome = Join-Path $root 'home-clean'
$aProg = Join-Path $root 'prog-clean\WorkBuddyAI'
Invoke-Setup $aHome $aProg @('-NoOpenLinks', '-SkipTemplates')
foreach ($rel in @('IDENTITY.md', 'MEMORY.md', 'SOUL.md', 'models.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $aHome $rel))) { throw "A missing $rel" }
}
$aId = [System.IO.File]::ReadAllText((Join-Path $aHome 'IDENTITY.md'))
if ($aId -notmatch '石井') { throw 'A IDENTITY missing 石井' }
$aSoul = [System.IO.File]::ReadAllText((Join-Path $aHome 'SOUL.md'))
if ($aSoul -notmatch 'SHIYI-WB:BEGIN') { throw 'A SOUL missing marker' }
Write-Output "A_OK identity/soul/models"

Write-Output ""
Write-Output "========== B EXISTING INSTALL =========="
$bHome = Join-Path $root 'home-existing'
$bProg = Join-Path $root 'prog-existing\WorkBuddyAI'
New-Item -ItemType Directory -Force -Path $bHome | Out-Null
$oldId = "# old intl identity`nUSER-OWN-KEEP`nlegacy-v1.0`n"
[System.IO.File]::WriteAllText((Join-Path $bHome 'IDENTITY.md'), $oldId, (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText((Join-Path $bHome 'my-own.md'), "keep-me`n", (New-Object System.Text.UTF8Encoding($false)))
Invoke-Setup $bHome $bProg @('-NoOpenLinks', '-SkipTemplates')
$bId = [System.IO.File]::ReadAllText((Join-Path $bHome 'IDENTITY.md'))
if ($bId -notmatch '石井') { throw 'B IDENTITY not overwritten with pack' }
if (-not (Test-Path -LiteralPath (Join-Path $bHome 'my-own.md'))) { throw 'B user file wiped' }
Write-Output "B_OK overwrite+user file intact"

Write-Output ""
Write-Output "========== B UNINSTALL =========="
Invoke-Setup $bHome $bProg @('-Uninstall', '-NoOpenLinks')
$bAfter = [System.IO.File]::ReadAllText((Join-Path $bHome 'IDENTITY.md'))
if ($bAfter -notmatch 'USER-OWN-KEEP') { throw 'B uninstall did not restore old IDENTITY' }
if ($bAfter -match '零拒绝') { throw 'B uninstall left pack IDENTITY' }
if (-not (Test-Path -LiteralPath (Join-Path $bHome 'my-own.md'))) { throw 'B uninstall wiped user file' }
Write-Output "B_UNINSTALL_OK restored backup"

Write-Output ""
Write-Output "========== REAL HOME GUARD =========="
foreach ($g in $GuardFiles) {
    $now = 'ABSENT'
    if (Test-Path -LiteralPath $g) { $now = (Get-FileHash -LiteralPath $g -Algorithm SHA256).Hash }
    if ($now -ne $GuardBefore[$g]) { throw "REAL FILE CHANGED: $g" }
}
Write-Output "REAL_HOME_UNTOUCHED"
Write-Output "PASS workbuddy-ai v1.3 sandbox A/B"
Write-Output "ROOT $root"
exit 0
