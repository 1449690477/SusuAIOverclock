# Sandbox Cursor lazy pack v1.2. Never writes real ~/.cursor.
# ASCII-only + UTF-8 BOM so Windows PowerShell 5.1 can parse it.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

$SrcKit = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\packed-packs\cursor')).Path
if (-not (Test-Path -LiteralPath (Join-Path $SrcKit 'setup.py'))) {
    throw "missing setup.py in $SrcKit"
}

$py = $null
foreach ($c in @('python', 'py')) {
    $cmd = Get-Command $c -ErrorAction SilentlyContinue
    if ($cmd) { $py = $cmd.Source; break }
}
if (-not $py) { throw "python 3.8+ not on PATH" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$root = Join-Path $env:TEMP ("cursor-selftest-dango-" + $stamp)
$kit = Join-Path $root 'kit'
New-Item -ItemType Directory -Force -Path $kit | Out-Null
Write-Output "COPY_KIT $SrcKit -> $kit"
robocopy $SrcKit $kit /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed exit $LASTEXITCODE" }

$Setup = Join-Path $kit 'setup.py'
$realRules = Join-Path $env:USERPROFILE '.cursor\rules'
$realDeploy = Join-Path $env:USERPROFILE '.cursor-shiyi-lazy'
$realSnap = @{}
if (Test-Path -LiteralPath $realRules) {
    Get-ChildItem -LiteralPath $realRules -File -ErrorAction SilentlyContinue | ForEach-Object {
        $realSnap[$_.FullName] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
}
$realDeployExisted = Test-Path -LiteralPath $realDeploy

function Assert-RealHomeUntouched {
    if ($realDeployExisted -ne (Test-Path -LiteralPath $realDeploy)) {
        throw "REAL HOME TOUCHED: .cursor-shiyi-lazy existence changed"
    }
    foreach ($kv in $realSnap.GetEnumerator()) {
        if (-not (Test-Path -LiteralPath $kv.Key)) { throw "REAL HOME TOUCHED: missing $($kv.Key)" }
        $now = (Get-FileHash -LiteralPath $kv.Key -Algorithm SHA256).Hash
        if ($now -ne $kv.Value) { throw "REAL HOME TOUCHED: hash changed $($kv.Key)" }
    }
}

function Invoke-Setup([string]$HomeRoot, [string[]]$ExtraArgs) {
    Write-Output "PY $py setup.py $($ExtraArgs -join ' ') --root $HomeRoot"
    & $py $Setup @ExtraArgs --root $HomeRoot
    if ($LASTEXITCODE -ne 0) { throw "setup.py exit $LASTEXITCODE args=$($ExtraArgs -join ' ')" }
}

Write-Output ""
Write-Output "========== SELFTEST =========="
& $py $Setup --selftest
if ($LASTEXITCODE -ne 0) { throw "selftest exit $LASTEXITCODE" }

# ---- A: clean machine ----
$homeA = Join-Path $root 'home-clean'
New-Item -ItemType Directory -Force -Path $homeA | Out-Null
Write-Output ""
Write-Output "========== A CLEAN INSTALL =========="
Invoke-Setup $homeA @('install', '--no-open')
$rulesA = Join-Path $homeA '.cursor\rules'
$mdcA = @(Get-ChildItem -LiteralPath $rulesA -Filter 'shiyi-*.mdc')
if ($mdcA.Count -ne 18) { throw "A expected 18 mdc, got $($mdcA.Count)" }
$stateA = Join-Path $homeA '.cursor-shiyi-lazy\installed.json'
if (-not (Test-Path -LiteralPath $stateA)) { throw "A missing installed.json" }
Invoke-Setup $homeA @('check')
Write-Output "A_OK 18 rules + installed.json"

# ---- B: already-configured machine ----
$homeB = Join-Path $root 'home-existing'
$rulesB = Join-Path $homeB '.cursor\rules'
New-Item -ItemType Directory -Force -Path $rulesB | Out-Null
$own = Join-Path $rulesB 'my-own.mdc'
$oldCore = Join-Path $rulesB 'shiyi-00-core.mdc'
Set-Content -LiteralPath $own -Value "USER-OWN-RULE" -Encoding ascii
Set-Content -LiteralPath $oldCore -Value "OLD-SHIYI-CORE" -Encoding ascii
$ownHash = (Get-FileHash -LiteralPath $own -Algorithm SHA256).Hash
Write-Output ""
Write-Output "========== B EXISTING INSTALL =========="
Invoke-Setup $homeB @('install', '--no-open')
$mdcB = @(Get-ChildItem -LiteralPath $rulesB -Filter 'shiyi-*.mdc')
if ($mdcB.Count -lt 18) { throw "B expected >=18 mdc, got $($mdcB.Count)" }
$newCore = Get-Content -LiteralPath $oldCore -Raw
if ($newCore -notmatch '石井|SHIYI|LOCAL_WORKSPACE') { throw "B core not replaced by kit" }
$ownNow = (Get-FileHash -LiteralPath $own -Algorithm SHA256).Hash
if ($ownNow -ne $ownHash) { throw "B user-own rule was modified" }
$bak = @(Get-ChildItem -LiteralPath $rulesB -Filter 'shiyi-00-core.mdc.bak.*')
if ($bak.Count -lt 1) { throw "B missing backup of existing shiyi-00-core.mdc" }
Invoke-Setup $homeB @('check')
Write-Output "B_OK overwrite+backup, user rule intact"

Write-Output ""
Write-Output "========== B UNINSTALL =========="
Invoke-Setup $homeB @('uninstall')
$restored = Get-Content -LiteralPath $oldCore -Raw
if ($restored.Trim() -ne 'OLD-SHIYI-CORE') { throw "B uninstall did not restore old core" }
$ownAfter = (Get-FileHash -LiteralPath $own -Algorithm SHA256).Hash
if ($ownAfter -ne $ownHash) { throw "B uninstall touched user-own rule" }
Write-Output "B_UNINSTALL_OK restored backup"

Assert-RealHomeUntouched
Write-Output "REAL_HOME_UNTOUCHED"
Write-Output "PASS cursor v1.2 sandbox A/B"
Write-Output "ROOT $root"
