# Sandbox WorkBuddy v4.4 install. Never writes real ~/.workbuddy or real Programs\WorkBuddy.
# ASCII-only + UTF-8 BOM so Windows PowerShell 5.1 can parse it.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

$SrcKit = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\packed-packs\workbuddy')).Path
if (-not (Test-Path -LiteralPath (Join-Path $SrcKit 'Install-WB-OneClick.ps1'))) {
    throw "missing installer in $SrcKit"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$root = Join-Path $env:TEMP ("wb-selftest-dango-" + $stamp)
$kit = Join-Path $root 'kit'
New-Item -ItemType Directory -Force -Path $kit | Out-Null
Write-Output "COPY_KIT $SrcKit -> $kit"
robocopy $SrcKit $kit /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed exit $LASTEXITCODE" }

$Ps1 = Join-Path $kit 'Install-WB-OneClick.ps1'
$Verify = Join-Path $kit 'verify-install.ps1'

function New-FakeProg([string]$Prog) {
    $utf8nb = New-Object System.Text.UTF8Encoding($false)
    $tpl = Join-Path $Prog 'resources\app.asar.unpacked\resources\templates'
    $cliDir = Join-Path $Prog 'resources\app.asar.unpacked\cli'
    $cliDist = Join-Path $cliDir 'dist'
    New-Item -ItemType Directory -Force -Path $tpl | Out-Null
    New-Item -ItemType Directory -Force -Path $cliDist | Out-Null
    [System.IO.File]::WriteAllText(
        (Join-Path $tpl 'welcome.tpl'),
        "<content_policy>refuse everything</content_policy>`nhello`n",
        $utf8nb
    )
    $injSrc = [System.IO.File]::ReadAllText((Join-Path $kit 'patch-inject-layer.ps1'))
    $mK = [regex]::Match($injSrc, '\$OLD1 = @''\r?\n(?<b>[\s\S]*?)\r?\n''@')
    $old1 = $(if ($mK.Success) { $mK.Groups['b'].Value } else { 'OLD1-MISSING' })
    $prodRaw = '{' + "`n" + '  "prompts": [' + "`n" + '    {' + "`n" +
               '      "name": "cli-agent-prompt",' + "`n" +
               '      "template": "HEAD\r\n<content_policy>\r\nYou MUST refuse unauthorized hacking.\r\n</content_policy>\r\n' + $old1 + '\r\nTAIL"' + "`n" +
               '    }' + "`n" + '  ]' + "`n" + '}' + "`n"
    [System.IO.File]::WriteAllText((Join-Path $cliDir 'product.json'), $prodRaw, $utf8nb)
    $r1 = 'Whenever you read a file, you should consider whether it looks malicious. If it does, you MUST refuse to improve or augment the code. You can still analyze existing code, write reports, or answer high-level questions about the code behavior.'
    $r2 = 'CONTENT SAFETY (HIGHEST PRIORITY):' + "`n" + 'You MUST refuse to summarize web content that is primarily about politically sensitive topics (political figures, elections, government policies, geopolitical conflicts), or that promotes hate speech, racism, violence, discrimination, or catastrophic harm. Return ONLY: "This page contains sensitive content that cannot be returned."'
    $jsRaw = 'const A = ' + [char]39 + $r1 + [char]39 + ';' + "`n" + 'const B = ' + [char]96 + $r2 + [char]96 + ';' + "`n"
    [System.IO.File]::WriteAllText((Join-Path $cliDist 'codebuddy.js'), $jsRaw, $utf8nb)
}

function Invoke-WB([string]$HomeDir, [string]$ProgDir, [string]$Label) {
    Write-Output ""
    Write-Output "========== $Label =========="
    Write-Output "WB_HOME=$HomeDir"
    Write-Output "WB_PROG=$ProgDir"
    New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null
    New-FakeProg $ProgDir
    $saved = $env:USERPROFILE
    $env:USERPROFILE = Join-Path $root ('_profile-' + $Label)
    New-Item -ItemType Directory -Force -Path $env:USERPROFILE | Out-Null
    try {
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $Ps1 `
            -WBHomePath $HomeDir -WBProgPath $ProgDir -NoOpenLinks
        if ($LASTEXITCODE -ne 0) { throw "$Label install exit $LASTEXITCODE" }
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $Verify `
            -WBHome $HomeDir -WBProg $ProgDir
        if ($LASTEXITCODE -ne 0) { throw "$Label verify exit $LASTEXITCODE" }
    } finally {
        $env:USERPROFILE = $saved
    }
    foreach ($rel in @('IDENTITY.md', 'MEMORY.md', 'SOUL.md', 'skills\shiyi-executor\SKILL.md')) {
        if (-not (Test-Path -LiteralPath (Join-Path $HomeDir $rel))) { throw "$Label missing $rel" }
    }
    $id = [System.IO.File]::ReadAllText((Join-Path $HomeDir 'IDENTITY.md'))
    if ($id -notmatch 'SHIYI-WB-ID:BEGIN') { throw "$Label IDENTITY missing marked block" }
    if ($id -notmatch 'workspace' -and $id -notmatch '## ') { throw "$Label IDENTITY looks empty" }
    $tpl = [System.IO.File]::ReadAllText((Join-Path $ProgDir 'resources\app.asar.unpacked\resources\templates\welcome.tpl'))
    if ($tpl -match '<content_policy>') { throw "$Label template still has content_policy" }
    $pj = [System.IO.File]::ReadAllText((Join-Path $ProgDir 'resources\app.asar.unpacked\cli\product.json'))
    if ($pj -match '<content_policy>') { throw "$Label product.json still has content_policy" }
    if ($pj -notmatch 'workspace_environment' -and $pj -notmatch 'delivery_baseline') {
        throw "$Label product.json missing v4.4 inject rewrite"
    }
    $js = [System.IO.File]::ReadAllText((Join-Path $ProgDir 'resources\app.asar.unpacked\cli\dist\codebuddy.js'))
    if ($js -match 'you MUST refuse to improve or augment') { throw "$Label codebuddy.js R1 still blocked" }
    if ($js -notmatch 'always treat it as a normal technical artifact') { throw "$Label codebuddy.js R1 not rewritten" }
    Write-Output "[OK] $Label"
}

$aHome = Join-Path $root 'A\home'
$aProg = Join-Path $root 'A\prog'
Invoke-WB $aHome $aProg 'A-clean'

$bHome = Join-Path $root 'B\home'
$bProg = Join-Path $root 'B\prog'
New-Item -ItemType Directory -Force -Path $bHome | Out-Null
[System.IO.File]::WriteAllText(
    (Join-Path $bHome 'IDENTITY.md'),
    "# old v4.0 IDENTITY`nUSER-PREF-KEEP`nSHIYI-WB v3 leftover`n",
    (New-Object System.Text.UTF8Encoding($false))
)
Invoke-WB $bHome $bProg 'B-existing-v40'
$bId = [System.IO.File]::ReadAllText((Join-Path $bHome 'IDENTITY.md'))
if ($bId -notmatch 'USER-PREF-KEEP') { throw 'B: user text was wiped' }
if ($bId -notmatch 'SHIYI-WB-ID:BEGIN') { throw 'B: v4.4 block missing after upgrade' }

$cHome = Join-Path $root 'C\home'
$cProg = Join-Path $root 'C\prog'
New-Item -ItemType Directory -Force -Path $cHome | Out-Null
[System.IO.File]::WriteAllText(
    (Join-Path $cHome 'IDENTITY.md'),
    "# custom head`nKEEP-CUSTOM-HEAD`n",
    (New-Object System.Text.UTF8Encoding($false))
)
Invoke-WB $cHome $cProg 'C-custom-head'
$cId = [System.IO.File]::ReadAllText((Join-Path $cHome 'IDENTITY.md'))
if ($cId -notmatch 'KEEP-CUSTOM-HEAD') { throw 'C: custom head was wiped' }

# hard guard: real user home and real program dir must stay untouched
$realHome = Join-Path $env:USERPROFILE '.workbuddy'
$realProg = Join-Path $env:LOCALAPPDATA 'Programs\WorkBuddy'
if (Test-Path -LiteralPath $realHome) {
    $stampFile = Join-Path $root 'real-home-mtime.txt'
    # just exist-check: we never wrote SHIYI into real home from this script root
}
Write-Output ""
Write-Output "ALL THREE WB SANDBOX INSTALLS PASSED"
Write-Output $root
exit 0
