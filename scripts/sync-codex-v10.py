#!/usr/bin/env python3
"""Synchronize standalone Codex v10.4 kit into Dango Desk packed-packs/codex.

Desktop-side hardening that must survive the refresh:
  1. models.json keeps serial tool execution for deepseek-v4-flash-vision-exp
  2. 1.4 embedded hook hash is registered so upgrades actually replace the file
  3. anti-interleave post-install self-check stays a hard failure
  4. software install path skips unbounded Desktop/Documents astra6 scans
  5. ColdBrew robocopy only runs when the source directory exists
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import shutil
import stat
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = pathlib.Path(r"C:\Users\Administrator\Desktop\新版\codex-break-kit-v10")
TARGET = ROOT / "packed-packs" / "codex"
SKIP_DIR_NAMES = {"__pycache__", "backups", ".git"}
LEGACY_HOOK_HASHES = [
    "7A3FF879F30E196621220DC06DE84E3EEB1779FF73A1E81B2207E8F2566ADF4F",
    "83C0F53E721E31F2D1A20AB51C99AB1AE06116A7DF53B2682AA580B01C87D7FF",
    "C3DCBFDAE222B870E3544CC62637B4D1F3C7E2E5099507DBF4AC90E0C9CE59BE",
    "F26CE9FC04F2191BF8642204B89CCAEDB3586F8FABC4165F7880342DCA1BE639",
    "E7BB41DDD452EC54FE15D50B9E05855269EA821F098F1F66BBD1265518E2F3EB",
    "9EBB426FC578F6F4397431C6B8328100E3753C583CE4588E9262ACFA7096D5A3",
    # Dango Desk 1.3.7 / 1.4 embedded hook. Missing this hash makes v10
    # treat the in-box script as a user custom file and skip the upgrade.
    "C18FE139D9B594E40BFFE26B9CA0CF53BE5C3EA996CD8B5D1D9D5F1D6947B7D6",
    # Standalone v10.4 kit before desktop comment patches.
    "B301B25FDECBF2D4A1F7E5B9E309DADF0E450B0A44222B254810C24A11A8E6E1",
]


def _on_rm_error(func, path, _exc):
    pathlib.Path(path).chmod(stat.S_IWRITE)
    func(path)


def mirror() -> tuple[int, int]:
    if not SOURCE.is_dir():
        raise SystemExit(f"source kit not found: {SOURCE}")
    if TARGET.exists():
        shutil.rmtree(TARGET, onerror=_on_rm_error)
    copied = 0
    skipped = 0
    for src in SOURCE.rglob("*"):
        rel = src.relative_to(SOURCE)
        if any(part in SKIP_DIR_NAMES for part in rel.parts):
            skipped += 1
            continue
        if src.is_dir():
            continue
        if src.suffix.lower() == ".pyc":
            skipped += 1
            continue
        dest = TARGET.joinpath(rel)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        copied += 1
    return copied, skipped


def patch_models() -> None:
    path = TARGET / "materials" / "models.json"
    raw = path.read_bytes()
    bom = raw.startswith(b"\xef\xbb\xbf")
    data = json.loads(raw.decode("utf-8-sig"))
    models = data.get("models") or []
    hit = False
    for model in models:
        if model.get("slug") == "deepseek-v4-flash-vision-exp":
            model["supports_parallel_tool_calls"] = False
            hit = True
            break
    if not hit:
        raise SystemExit("deepseek-v4-flash-vision-exp missing from models.json")
    out = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    # Node / Electron JSON.parse cannot consume a UTF-8 BOM.
    path.write_bytes(out.encode("utf-8"))
    if b'"supports_parallel_tool_calls": false' not in path.read_bytes():
        raise SystemExit("serial tool setting did not land")


def patch_hook_comments() -> None:
    path = TARGET / "materials" / "hooks" / "ishii_auto_route.py"
    text = path.read_text(encoding="utf-8")
    replacements = [
        (
            '    if "pretooluse" in key:\n        emit({"continue": True})',
            '    if "pretooluse" in key:\n'
            "        # v7.3 FIX: NEVER inject additionalContext on tool events. Codex splices\n"
            "        # it in as a developer message between the assistant tool_calls message\n"
            "        # and its tool output. Strict Chat Completions providers (DeepSeek et al.)\n"
            '        # reject that topology with HTTP 400 "No tool output found for tool call".\n'
            "        emit({\"continue\": True})",
        ),
        (
            '    if "subagentstart" in key:\n        emit({"continue": True})',
            '    if "subagentstart" in key:\n'
            "        # v7.3 FIX: same protocol-tearing hazard as PreToolUse — passthrough only.\n"
            '        emit({"continue": True})',
        ),
        (
            '    if "posttooluse" in key:\n        emit({"continue": True})',
            '    if "posttooluse" in key:\n'
            "        # v7.3 FIX: injecting after a tool call lands between tool output and the\n"
            "        # next assistant message — equally fatal for strict providers. Passthrough.\n"
            '        emit({"continue": True})',
        ),
    ]
    for old, new in replacements:
        if old not in text:
            raise SystemExit(f"hook patch anchor missing:\n{old}")
        text = text.replace(old, new, 1)
    if text.count("v7.3 FIX") < 3:
        raise SystemExit("v7.3 FIX comments did not land")
    path.write_text(text, encoding="utf-8", newline="\n")


def _ps_lines(raw: bytes) -> tuple[bool, list[str]]:
    bom = raw.startswith(b"\xef\xbb\xbf")
    text = raw[3:].decode("utf-8") if bom else raw.decode("utf-8")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if text.endswith("\n"):
        lines = text[:-1].split("\n")
        lines.append("")
    else:
        lines = text.split("\n")
    return bom, lines


def _write_ps(path: pathlib.Path, bom: bool, lines: list[str]) -> None:
    body = "\r\n".join(lines)
    if not body.endswith("\r\n"):
        body += "\r\n"
    data = body.encode("utf-8")
    path.write_bytes((b"\xef\xbb\xbf" + data) if bom else data)


def _find_line(lines: list[str], needle: str, start: int = 0) -> int:
    for i in range(start, len(lines)):
        if needle in lines[i]:
            return i
    raise SystemExit(f"installer anchor missing: {needle}")


def patch_installer() -> None:
    path = TARGET / "install-replica.ps1"
    bom, lines = _ps_lines(path.read_bytes())

    # 1) SkipAstra6 switch
    idx = _find_line(lines, "[switch]$SkipNamespaceFix")
    if not lines[idx].rstrip().endswith(","):
        lines[idx] = lines[idx].rstrip() + ","
    if not any("[switch]$SkipAstra6" in line for line in lines):
        lines.insert(idx + 1, "")
        lines.insert(idx + 2, "    [switch]$SkipAstra6")

    # 2) Register 1.4 / historical desktop hashes
    start = _find_line(lines, "$KNOWN_KIT_HOOK_HASHES = @(")
    end = _find_line(lines, ")", start)
    existing = "\n".join(lines[start : end + 1])
    for h in LEGACY_HOOK_HASHES:
        if h not in existing:
            lines.insert(end, f"    '{h}'")
            end += 1

    # 3) Guard ColdBrew robocopy
    robocopy_idx = None
    for i, line in enumerate(lines):
        if "robocopy (Join-Path $Mat 'ColdBrew')" in line:
            robocopy_idx = i
            break
    if robocopy_idx is None:
        raise SystemExit("ColdBrew robocopy line missing")
    prefix = lines[robocopy_idx][: len(lines[robocopy_idx]) - len(lines[robocopy_idx].lstrip())]
    if "Test-Path -LiteralPath (Join-Path $Mat 'ColdBrew')" not in "\n".join(
        lines[max(0, robocopy_idx - 8) : robocopy_idx + 1]
    ) or not lines[robocopy_idx].lstrip().startswith("if"):
        lines[robocopy_idx] = (
            prefix
            + "if (Test-Path -LiteralPath (Join-Path $Mat 'ColdBrew')) { "
            + lines[robocopy_idx].strip()
            + " }"
        )

    # 4) SkipAstra6 around the astra6 auto-detect block
    astra = _find_line(lines, "Set-Step '[+step] astra6 pool middleware")
    nine = _find_line(lines, "Set-Step '[9/9] 部署完整性自检'", astra)
    if not any("$SkipAstra6" in line and "astra6" in line.lower() for line in lines[astra:nine]):
        indent = lines[astra][: len(lines[astra]) - len(lines[astra].lstrip())]
        lines.insert(astra, indent + "$astraOk = $false")
        lines.insert(astra + 1, indent + "if ($SkipAstra6) {")
        lines.insert(astra + 2, indent + "    Write-Output '  [skip] astra6 home scan skipped (software install path)'")
        lines.insert(astra + 3, indent + "} else {")
        # The original astra block now sits inside else; close it before [9/9].
        nine = _find_line(lines, "Set-Step '[9/9] 部署完整性自检'", astra)
        lines.insert(nine, indent + "}")
        lines.insert(nine + 1, "")

    # 5) Anti-interleave hard self-check before install manifest
    ok_line = _find_line(lines, "[OK] 破甲核心组件部署完整")
    if not any("anti-interleave self-check" in line for line in lines):
        insert_at = ok_line + 1
        block = [
            "",
            "# v1.3.6 anti-interleave self-check: no injection on tool events anywhere.",
            "$hookText = Get-Content -LiteralPath (Join-Path $CodexHome 'hooks\\ishii_auto_route.py') -Raw",
            "if ($hookText -match '_ctx\\(\\s*.?PreToolUse|_ctx\\(\\s*.?PostToolUse|_ctx\\(\\s*.?SubagentStart') {",
            "    throw 'hooks 脚本仍含工具事件注入 -> 会触发 No tool output found for tool call (400)'",
            "}",
            "foreach ($toolEvt in @('PreToolUse', 'PostToolUse', 'SubagentStart')) {",
            "    if ($targetHooks.hooks -is [System.Collections.IDictionary] -and $targetHooks.hooks.Contains($toolEvt)) {",
            "        foreach ($entry in @($targetHooks.hooks.$toolEvt)) {",
            "            $blobCheck = ($entry | ConvertTo-Json -Compress -Depth 20)",
            "            if ($blobCheck -match 'ishii_auto_route|slo-runtime-hook') {",
            "                throw ('hooks.json 的工具事件 ' + $toolEvt + ' 仍挂着本 Kit 条目 -> 会撕开 tool_calls/tool-output 相邻性')",
            "            }",
            "        }",
            "    }",
            "}",
            "Write-Output '  [OK] 反夹层校验通过（hooks 零工具事件注入 / hooks.json 未注册工具事件）'",
        ]
        for offset, line in enumerate(block):
            lines.insert(insert_at + offset, line)

    _write_ps(path, True, lines)
    raw = path.read_bytes()
    if raw[:3] != b"\xef\xbb\xbf":
        raise SystemExit("installer BOM lost")
    text = raw.decode("utf-8-sig")
    if text.count("\n") != text.count("\r\n"):
        raise SystemExit("installer has bare LF")
    for must in (
        "[switch]$SkipAstra6",
        "C18FE139D9B594E40BFFE26B9CA0CF53BE5C3EA996CD8B5D1D9D5F1D6947B7D6",
        "anti-interleave self-check",
        "foreach ($toolEvt in @('PreToolUse', 'PostToolUse', 'SubagentStart'))",
        "ConvertTo-DeepDict",
    ):
        if must not in text:
            raise SystemExit(f"installer missing: {must}")


def main() -> int:
    copied, skipped = mirror()
    patch_models()
    patch_hook_comments()
    patch_installer()
    hook = TARGET / "materials" / "hooks" / "ishii_auto_route.py"
    print(f"copied={copied} skipped={skipped}")
    print(f"hook_sha256={hashlib.sha256(hook.read_bytes()).hexdigest().upper()}")
    print(f"target={TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
