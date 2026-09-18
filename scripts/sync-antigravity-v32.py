# -*- coding: utf-8 -*-
"""Mirror anti-gravity-v3.2 into packed-packs/anti-gravity. Drop machine leftovers."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

SRC = Path(r"C:\Users\Administrator\Desktop\workbuddy-shiyi-pack\新建文件夹\_zip\anti-gravity-v3.2")
DST = Path(__file__).resolve().parents[1] / "packed-packs" / "anti-gravity"
EXCLUDE_DIRS = {
    "backups",
    "__pycache__",
    ".git",
    "evidence",
}
EXCLUDE_FILES: set[str] = set()


def skip(rel: Path) -> bool:
    parts = set(rel.parts)
    if parts & EXCLUDE_DIRS:
        return True
    if rel.name in EXCLUDE_FILES:
        return True
    if rel.name.startswith("install-manifest-"):
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

    (DST / "materials" / "evidence").mkdir(parents=True, exist_ok=True)
    manifest = {
        "name": "anti-gravity-shiyi-kit",
        "version": "3.2.0",
        "target": "Antigravity",
        "customization_channels": "triple (rules/ag-armor.md + skills/coldbrew-breakout + plugins/coldbrew-breakout)",
    }
    (DST / "install-manifest-3.2.0.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    copied += 1

    readme = (DST / "README-CN.txt").read_text(encoding="utf-8", errors="replace")
    inst = (DST / "Install-AntiGravity.ps1").read_text(encoding="utf-8", errors="replace")
    if "v3.2" not in readme.splitlines()[0]:
        raise SystemExit("README-CN.txt is not v3.2")
    if "v3.2" not in inst:
        raise SystemExit("installer is not v3.2")
    for must in (
        "Install-AntiGravity.ps1",
        "verify-install.ps1",
        "selftest-upgrade.ps1",
        "Uninstall.ps1",
        "seed-pristine.ps1",
        "pristine-seed/app-update.yml.orig",
        "materials/rules/ag-armor.md",
        "materials/plugin/skills/coldbrew-breakout/SKILL.md",
        "materials/plugin/rules/AGENTS.md",
        "materials/scripts/ag_patch_agents.ps1",
        "materials/proxy/bin/antigravity-oauth-proxy.exe",
    ):
        if not (DST / must).exists():
            raise SystemExit(f"missing {must}")
    if (DST / "backups").exists():
        raise SystemExit("backups leaked into packed kit")
    print(f"synced {copied} files -> {DST}")


if __name__ == "__main__":
    main()
