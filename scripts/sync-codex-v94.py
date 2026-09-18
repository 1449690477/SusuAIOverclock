#!/usr/bin/env python3
"""Synchronize the standalone Codex v9.4 kit into Dango Desk.

The embedded app has two local hardening decisions that must survive a kit
refresh: models.json keeps serial tool execution, and the installer retains
the desktop app's Hashtable/self-check fixes. Those files are merged in the
working tree rather than blindly replaced by the standalone archive.
"""
from __future__ import annotations

import hashlib
import pathlib
import shutil
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / "新建文件夹" / "codex" / "codex破 v9.4 (握手去冲突 + hooks最小化 + 路由兜底).zip"
TARGET = ROOT / "packed-packs" / "codex"
PROTECTED = {
    "install-replica.ps1",
    "materials/hooks/ishii_auto_route.py",
    "materials/models.json",
}


def safe_member(name: str) -> pathlib.Path:
    rel = pathlib.PurePosixPath(name)
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError(f"unsafe archive path: {name}")
    return TARGET.joinpath(*rel.parts)


def main() -> int:
    if not SOURCE.is_file():
        raise SystemExit(f"source archive not found: {SOURCE}")
    TARGET.mkdir(parents=True, exist_ok=True)
    copied = 0
    skipped = 0
    with zipfile.ZipFile(SOURCE) as archive:
        if archive.testzip() is not None:
            raise SystemExit("source archive CRC check failed")
        for info in archive.infolist():
            if info.is_dir():
                continue
            name = info.filename.replace("\\", "/")
            if name in PROTECTED or name == "_pack_v81.py" or name.endswith(".pyc") or "__pycache__/" in name:
                skipped += 1
                continue
            destination = safe_member(name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as source, destination.open("wb") as target:
                shutil.copyfileobj(source, target, length=1 << 20)
            copied += 1

    for path in sorted(TARGET.rglob("*"), reverse=True):
        if path.is_file() and (path.suffix == ".pyc" or "__pycache__" in path.parts):
            path.unlink()
        elif path.is_dir() and path.name == "__pycache__":
            shutil.rmtree(path)

    models = (TARGET / "materials" / "models.json").read_bytes()
    if b'"supports_parallel_tool_calls": false' not in models:
        raise SystemExit("protected models.json lost serial tool setting")
    hook = TARGET / "materials" / "hooks" / "ishii_auto_route.py"
    print(f"copied={copied} skipped_protected_or_build={skipped}")
    print(f"hook_sha256={hashlib.sha256(hook.read_bytes()).hexdigest()}")
    print(f"target={TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
