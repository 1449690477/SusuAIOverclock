# -*- coding: utf-8 -*-
"""Mirror Desktop wb破4.4 into packed-packs/workbuddy. Drop machine leftovers."""
from __future__ import annotations

import shutil
from pathlib import Path

SRC = Path(r"C:\Users\Administrator\Desktop\wb破4.4")
DST = Path(__file__).resolve().parents[1] / "packed-packs" / "workbuddy"
EXCLUDE_DIRS = {
    "_quarantine",
    "__pycache__",
    "backups",
    ".git",
}
EXCLUDE_FILES = {
    "_cli-layer-state.json",
    "_inject-layer-state.json",
}


def skip(rel: Path) -> bool:
    parts = set(rel.parts)
    if parts & EXCLUDE_DIRS:
        return True
    if rel.name in EXCLUDE_FILES:
        return True
    if rel.suffix in {".pyc", ".pyo"}:
        return True
    return False


def main() -> None:
    if not SRC.is_dir():
        raise SystemExit(f"missing source: {SRC}")
    if DST.exists():
        shutil.rmtree(DST)
    copied = 0
    for p in SRC.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(SRC)
        if skip(rel):
            continue
        dest = DST / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, dest)
        copied += 1
    readme = (DST / "README-CN.txt").read_text(encoding="utf-8", errors="replace")
    inst = (DST / "Install-WB-OneClick.ps1").read_text(encoding="utf-8", errors="replace")
    if "v4.4" not in readme.splitlines()[1]:
        raise SystemExit("README-CN.txt is not v4.4")
    if "v4.4" not in inst:
        raise SystemExit("installer is not v4.4")
    for must in (
        "patch-cli-layer.ps1",
        "patch-inject-layer.ps1",
        "verify-install.ps1",
        "selftest-upgrade.ps1",
        "materials/IDENTITY.md",
        "materials/MEMORY.md",
        "pristine-seed",
    ):
        if not (DST / must).exists():
            raise SystemExit(f"missing {must}")
    print(f"synced {copied} files -> {DST}")


if __name__ == "__main__":
    main()
