# -*- coding: utf-8 -*-
"""Mirror Desktop WorkBuddyAI lazy pack v1.3 into packed-packs/workbuddy-ai."""
from __future__ import annotations

import shutil
from pathlib import Path

SRC = Path(r"C:\Users\Administrator\Desktop\WorkBuddyAI-石井懒人包-v1.3")
DST = Path(__file__).resolve().parents[1] / "packed-packs" / "workbuddy-ai"
EXCLUDE_DIRS = {
    "__pycache__",
    "backups",
    ".git",
    "evidence",
    "实测记录",
}
EXCLUDE_FILES = {
    "DATA-LAYER-VERIFY.md",
}


def skip(rel: Path) -> bool:
    if set(rel.parts) & EXCLUDE_DIRS:
        return True
    if rel.name in EXCLUDE_FILES:
        return True
    if rel.suffix in {".pyc", ".pyo", ".zip"}:
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
    inst = (DST / "Install-WBAI-LazyPack.ps1").read_text(encoding="utf-8", errors="replace")
    if "v1.3" not in readme.splitlines()[1] and "v1.3" not in readme.splitlines()[0]:
        raise SystemExit("README-CN.txt is not v1.3")
    if "v1.3" not in inst:
        raise SystemExit("installer is not v1.3")
    for must in (
        "Install-WBAI-LazyPack.ps1",
        "Verify-LazyPack.ps1",
        "一键安装-双击这里.cmd",
        "卸载-恢复原状.cmd",
        "体检-自检.cmd",
        "materials/IDENTITY.md",
        "materials/MEMORY.md",
        "materials/SOUL-snippet.txt",
        "materials/models.json",
        "tools/verify_all.py",
    ):
        if not (DST / must).exists():
            raise SystemExit(f"missing {must}")
    print(f"synced {copied} files -> {DST}")


if __name__ == "__main__":
    main()
