#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
B301 = "B301B25FDECBF2D4A1F7E5B9E309DADF0E450B0A44222B254810C24A11A8E6E1"

models = ROOT / "packed-packs" / "codex" / "materials" / "models.json"
raw = models.read_bytes()
if raw.startswith(b"\xef\xbb\xbf"):
    models.write_bytes(raw[3:])
    print("stripped models.json BOM")

ip = ROOT / "packed-packs" / "codex" / "install-replica.ps1"
raw = ip.read_bytes()
if raw[:3] != b"\xef\xbb\xbf":
    raise SystemExit("installer BOM missing")
text = raw[3:].decode("utf-8")
if text.count("\n") != text.count("\r\n"):
    raise SystemExit("installer has bare LF")

if B301 not in text:
    needle = "    'C18FE139D9B594E40BFFE26B9CA0CF53BE5C3EA996CD8B5D1D9D5F1D6947B7D6',\r\n"
    if needle not in text:
        raise SystemExit("C18FE139 line missing")
    text = text.replace(needle, needle + f"    '{B301}',\r\n", 1)
    print("added B301 hash")

old = "    [switch]$SkipNamespaceFix\r\n\r\n    [switch]$SkipAstra6"
new = "    [switch]$SkipNamespaceFix,\r\n\r\n    [switch]$SkipAstra6"
old2 = "    [switch]$SkipNamespaceFix\r\n    [switch]$SkipAstra6"
new2 = "    [switch]$SkipNamespaceFix,\r\n    [switch]$SkipAstra6"
if old in text:
    text = text.replace(old, new, 1)
    print("added param comma")
elif old2 in text:
    text = text.replace(old2, new2, 1)
    print("added param comma (compact)")
elif "[switch]$SkipNamespaceFix," in text:
    print("param comma already present")
else:
    raise SystemExit("param block not found")

idx = text.find("if ($SkipAstra6)")
if idx < 0:
    raise SystemExit("SkipAstra6 if missing")
window = text[max(0, idx - 220) : idx + 80]
if "$astraOk = $false" not in window:
    text = text[:idx] + "$astraOk = $false\r\n" + text[idx:]
    print("initialized $astraOk before SkipAstra6")
else:
    print("astraOk already initialized")

out = text.encode("utf-8")
if text.count("\n") != text.count("\r\n"):
    raise SystemExit("bare LF after patch")
ip.write_bytes(b"\xef\xbb\xbf" + out)
print("installer patched")
