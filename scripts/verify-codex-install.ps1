# Sandbox installer verification for Dango Desk 1.5 / Codex v10.4
# Three machine states. Never writes the real ~/.codex.
$ErrorActionPreference = 'Stop'
$Kit = Join-Path $PSScriptRoot '..\packed-packs\codex'
$Ps1 = Join-Path $Kit 'install-replica.ps1'
if (-not (Test-Path -LiteralPath $Ps1)) { throw "missing $Ps1" }

function Invoke-Install([string]$HomeDir, [string]$Label) {
    Write-Output ""
    Write-Output "========== $Label =========="
    Write-Output "CODEX_HOME=$HomeDir"
    $argList = @(
        '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', $Ps1,
        '-CodexHome', $HomeDir,
        '-NoOpenLinks', '-SkipAstra6', '-SkipNamespaceFix', '-Force'
    )
    & powershell.exe @argList
    if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit $LASTEXITCODE" }
    $must = @(
        'AGENTS.md',
        'hooks.json',
        'hooks\ishii_auto_route.py',
        'prompts\eni-solo-v4.0.0.md',
        'eni-solo',
        'slo-runtime\eni-solo'
    )
    foreach ($rel in $must) {
        $full = Join-Path $HomeDir $rel
        if (-not (Test-Path -LiteralPath $full)) { throw "$Label missing $rel" }
    }
    $py = Get-Content -LiteralPath (Join-Path $HomeDir 'hooks\ishii_auto_route.py') -Raw -Encoding UTF8
    if ($py -match 'emit\(_ctx\("(PreToolUse|PostToolUse|SubagentStart)"') {
        throw "$Label hook still injects on tool events"
    }
    $man = Get-ChildItem -LiteralPath $HomeDir -Filter 'eni-solo-replica-install-manifest-*.json' | Select-Object -First 1
    if (-not $man) { throw "$Label missing install manifest" }
    Write-Output "[OK] $Label"
}

$root = Join-Path $env:TEMP ("dango-codex-verify-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path $root | Out-Null

$a = Join-Path $root 'clean'
New-Item -ItemType Directory -Force -Path $a | Out-Null
Invoke-Install $a 'A-clean'

$b = Join-Path $root 'existing'
New-Item -ItemType Directory -Force -Path (Join-Path $b 'hooks') | Out-Null
@'
{"description":"preexisting","hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"python \"C:\\Users\\SomeoneElse\\.codex\\hooks\\ishii_auto_route.py\""}]}],"PreToolUse":[{"hooks":[{"type":"command","command":"python \"C:\\Users\\SomeoneElse\\.codex\\hooks\\ishii_auto_route.py\""}]}]}}
'@ | Set-Content -LiteralPath (Join-Path $b 'hooks.json') -Encoding UTF8
'print("old hook")' | Set-Content -LiteralPath (Join-Path $b 'hooks\ishii_auto_route.py') -Encoding UTF8
Invoke-Install $b 'B-existing'
$bHooks = Get-Content -LiteralPath (Join-Path $b 'hooks.json') -Raw -Encoding UTF8
if ($bHooks -match 'SomeoneElse') { throw 'B: other-user absolute path was not rewritten' }
if ($bHooks -match 'PreToolUse') { throw 'B: leftover kit PreToolUse not pruned' }

$c = Join-Path $root 'nonadmin'
New-Item -ItemType Directory -Force -Path (Join-Path $c 'hooks') | Out-Null
@'
{"description":"user","hooks":{"UserPromptSubmit":[],"MyCustomEvent":[{"hooks":[{"type":"command","command":"echo custom"}]}]}}
'@ | Set-Content -LiteralPath (Join-Path $c 'hooks.json') -Encoding UTF8
Invoke-Install $c 'C-nonadmin-custom-event'
$cHooks = Get-Content -LiteralPath (Join-Path $c 'hooks.json') -Raw -Encoding UTF8
if ($cHooks -notmatch 'MyCustomEvent') { throw 'C: user custom event was wiped' }
if ($cHooks -notmatch [regex]::Escape($c.Replace('\', '\\')) -and $cHooks -notmatch [regex]::Escape($c)) {
    throw 'C: hook command was not rewritten to this home'
}

Write-Output ""
Write-Output "ALL THREE SANDBOX INSTALLS PASSED"
Write-Output $root
exit 0
