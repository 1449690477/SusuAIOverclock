# Sandbox Antigravity v3.2 install. Never writes real ~/.gemini or real Programs\antigravity.
# ASCII-only + UTF-8 BOM so Windows PowerShell 5.1 can parse it.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

$SrcKit = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\packed-packs\anti-gravity')).Path
if (-not (Test-Path -LiteralPath (Join-Path $SrcKit 'Install-AntiGravity.ps1'))) {
    throw "missing installer in $SrcKit"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$root = Join-Path $env:TEMP ("ag-selftest-dango-" + $stamp)
$kit = Join-Path $root 'kit'
New-Item -ItemType Directory -Force -Path $kit | Out-Null
Write-Output "COPY_KIT $SrcKit -> $kit"
robocopy $SrcKit $kit /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed exit $LASTEXITCODE" }

$Ps1 = Join-Path $kit 'Install-AntiGravity.ps1'
$Verify = Join-Path $kit 'verify-install.ps1'
$SeedYml = Join-Path $kit 'pristine-seed\app-update.yml.orig'

$realYml = Join-Path $env:LOCALAPPDATA 'Programs\antigravity\resources\app-update.yml'
$realArmor = Join-Path $env:USERPROFILE '.gemini\config\rules\ag-armor.md'
$realYmlHash = $null
$realArmorHash = $null
if (Test-Path -LiteralPath $realYml) { $realYmlHash = (Get-FileHash -LiteralPath $realYml -Algorithm SHA256).Hash }
if (Test-Path -LiteralPath $realArmor) { $realArmorHash = (Get-FileHash -LiteralPath $realArmor -Algorithm SHA256).Hash }

function New-FakeApp([string]$AppDir) {
    $res = Join-Path $AppDir 'resources'
    New-Item -ItemType Directory -Force -Path $res | Out-Null
    Copy-Item -LiteralPath $SeedYml -Destination (Join-Path $res 'app-update.yml') -Force
}

function Invoke-AG([string]$HomeDir, [string]$AppDir, [string]$Label) {
    Write-Output ""
    Write-Output "========== $Label =========="
    Write-Output "USERPROFILE=$HomeDir"
    Write-Output "APPDIR=$AppDir"
    New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null
    New-FakeApp $AppDir
    $savedUser = $env:USERPROFILE
    $savedLocal = $env:LOCALAPPDATA
    $savedTemp = $env:TEMP
    $savedTmp = $env:TMP
    $savedProxy = $env:AGY_PROXY_DIR
    $env:USERPROFILE = $HomeDir
    $env:LOCALAPPDATA = Join-Path $root ('_local-' + $Label)
    $env:TEMP = Join-Path $root ('_tmp-' + $Label)
    $env:TMP = $env:TEMP
    $fakeProxy = Join-Path $root ('_proxy-' + $Label)
    New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA | Out-Null
    New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
    New-Item -ItemType Directory -Force -Path $fakeProxy | Out-Null
    $env:AGY_PROXY_DIR = $fakeProxy
    $cfg = Join-Path $HomeDir '.gemini\config'
    try {
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $Ps1 `
            -AppDir $AppDir -NoOpenLinks -Force
        if ($LASTEXITCODE -ne 0) { throw "$Label install exit $LASTEXITCODE" }
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $Verify `
            -GeminiConfig $cfg
        if ($LASTEXITCODE -ne 0) { throw "$Label verify exit $LASTEXITCODE" }
    } finally {
        $env:USERPROFILE = $savedUser
        $env:LOCALAPPDATA = $savedLocal
        $env:TEMP = $savedTemp
        $env:TMP = $savedTmp
        if ($null -eq $savedProxy) { Remove-Item Env:AGY_PROXY_DIR -ErrorAction SilentlyContinue } else { $env:AGY_PROXY_DIR = $savedProxy }
    }
    foreach ($rel in @(
        'rules\ag-armor.md',
        'skills\coldbrew-breakout\SKILL.md',
        'plugins\coldbrew-breakout\plugin.json',
        'plugins\coldbrew-breakout\rules\AGENTS.md'
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $cfg $rel))) { throw "$Label missing $rel" }
    }
    $yml = [System.IO.File]::ReadAllText((Join-Path $AppDir 'resources\app-update.yml'))
    if ($yml -notmatch '127\.0\.0\.1:1/manifest/') { throw "$Label freeze did not rewrite app-update.yml" }
    Write-Output "[OK] $Label"
}

$aHome = Join-Path $root 'A\home'
$aApp = Join-Path $root 'A\app'
Invoke-AG $aHome $aApp 'A-clean'

$bHome = Join-Path $root 'B\home'
$bApp = Join-Path $root 'B\app'
$bShadow = Join-Path $bHome '.gemini\config\skills\coldbrew-breakout'
New-Item -ItemType Directory -Force -Path $bShadow | Out-Null
[System.IO.File]::WriteAllText(
    (Join-Path $bShadow 'SKILL.md'),
    'OLD-SHADOW-VERSION 2320B',
    (New-Object System.Text.UTF8Encoding($false))
)
Invoke-AG $bHome $bApp 'B-existing-shadow'
$bSkill = [System.IO.File]::ReadAllText((Join-Path $bHome '.gemini\config\skills\coldbrew-breakout\SKILL.md'))
if ($bSkill -match 'OLD-SHADOW-VERSION') { throw 'B: old shadow skill was not replaced' }
$bBak = @(Get-ChildItem -LiteralPath (Join-Path $bHome '.gemini\config\skills') -Directory -Filter 'coldbrew-breakout.pre-agv32-*' -ErrorAction SilentlyContinue)
if ($bBak.Count -lt 1) { throw 'B: old shadow was not moved aside' }

$cHome = Join-Path $root 'C\home'
$cApp = Join-Path $root 'C\app'
$cRule = Join-Path $cHome '.gemini\config\rules\my-own.md'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $cRule) | Out-Null
[System.IO.File]::WriteAllText($cRule, 'USER-OWN-RULE-KEEP-ME', (New-Object System.Text.UTF8Encoding($false)))
Invoke-AG $cHome $cApp 'C-custom-rule'
$cKeep = [System.IO.File]::ReadAllText($cRule)
if ($cKeep -notmatch 'USER-OWN-RULE-KEEP-ME') { throw 'C: user rule was wiped' }

if ($realYmlHash) {
    $after = (Get-FileHash -LiteralPath $realYml -Algorithm SHA256).Hash
    if ($after -ne $realYmlHash) { throw 'HARD GUARD: real app-update.yml changed' }
}
if ($realArmorHash) {
    $afterA = (Get-FileHash -LiteralPath $realArmor -Algorithm SHA256).Hash
    if ($afterA -ne $realArmorHash) { throw 'HARD GUARD: real ag-armor.md changed' }
}

Write-Output ""
Write-Output "ALL THREE AG SANDBOX INSTALLS PASSED"
Write-Output $root
exit 0
