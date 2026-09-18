# -*- coding: utf-8 -*-
"""Mirror Desktop cursor 破 (v1.2 lazy pack) into packed-packs/cursor."""
from __future__ import annotations

import shutil
from pathlib import Path

SRC = Path(r"C:\Users\Administrator\Desktop\workbuddy-shiyi-pack\cursor 破")
DST = Path(__file__).resolve().parents[1] / "packed-packs" / "cursor"
EXCLUDE_DIRS = {
    "__pycache__",
    ".git",
    "backups",
    "evidence",
    "实测记录",
}
EXCLUDE_FILES: set[str] = set()


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

    readme = (
        "Cursor 破甲懒人包 v1.2\n"
        "官方交流: https://susu.wiki/\n"
        "完整说明见 使用说明.txt\n"
    )
    (DST / "README-CN.txt").write_text(readme, encoding="utf-8")
    copied += 1

    guide = (DST / "使用说明.txt").read_text(encoding="utf-8", errors="replace")
    setup = (DST / "setup.py").read_text(encoding="utf-8", errors="replace")
    if "v1.2" not in guide.splitlines()[1]:
        raise SystemExit("使用说明.txt is not v1.2")
    if 'PACK_VERSION = "v1.2"' not in setup:
        raise SystemExit("setup.py is not v1.2")
    mdc = list((DST / "materials" / "rules").glob("*.mdc"))
    if len(mdc) != 18:
        raise SystemExit(f"expected 18 rules, got {len(mdc)}")
    for must in (
        "setup.py",
        "一键安装.bat",
        "一键卸载.bat",
        "使用说明.txt",
        "materials/tools/cursor_tamper_proxy.py",
        "materials/tools/stop_t1.py",
        "materials/AGENTS.md",
        "materials/.cursorrules",
        "materials/CLAUDE.md",
        "materials/rules/shiyi-00-core.mdc",
        "materials/rules/shiyi-G46-grok.mdc",
        "materials/rules/shiyi-G47-sandbox.mdc",
        "materials/rules/shiyi-T1-tamper.mdc",
        "materials/rules/shiyi-N1-normalize.mdc",
        "materials/rules/shiyi-N2-stages.mdc",
    ):
        if not (DST / must).exists():
            raise SystemExit(f"missing {must}")
    if (DST / "install_cursor.py").exists():
        raise SystemExit("old install_cursor.py leaked into packed kit")
    if (DST / "实测记录").exists():
        raise SystemExit("实测记录 leaked into packed kit")
    print(f"synced {copied} files -> {DST}")


if __name__ == "__main__":
    main()
