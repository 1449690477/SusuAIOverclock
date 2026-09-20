#!/usr/bin/env python3
"""Builtin-only guest import. All entries/hashes checked before extraction."""
import hashlib
import json
import pathlib
import stat
import sys
import zipfile


def extract(archive, destination, source=True):
    destination = pathlib.Path(destination)
    if destination.exists():
        raise RuntimeError(f'Refusing existing extraction destination: {destination}')
    with zipfile.ZipFile(archive) as z:
        seen = set()
        entries = {}
        for info in z.infolist():
            name = info.filename
            p = pathlib.PurePosixPath(name)
            if not name or '\\' in name or ':' in name or p.is_absolute() or '..' in p.parts:
                raise RuntimeError(f'Unsafe archive path: {name}')
            if name.casefold() in seen:
                raise RuntimeError(f'Duplicate/case-colliding archive entry: {name}')
            seen.add(name.casefold())
            mode = info.external_attr >> 16
            if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
                raise RuntimeError(f'Non-regular archive entry: {name}')
            if info.is_dir():
                continue
            if info.file_size > 600 * 1024 * 1024:
                raise RuntimeError(f'Oversized entry: {name}')
            entries[name] = info
        if sum(i.file_size for i in entries.values()) > 2 * 1024**3:
            raise RuntimeError('Archive expansion limit exceeded')
        if source:
            manifest = json.loads(z.read('SOURCE-MANIFEST.json'))
            records = {r['path']: r for r in manifest['files']}
            assert len(records) == len(manifest['files'])
            assert set(entries) == set(records) | {'SOURCE-MANIFEST.json'}
            prohibited = {'node_modules', '.git', 'dist-electron', 'backups', 'evidence', '__pycache__', '_quarantine', '_deprecated-omen-bridge', 'codex', 'codex-panghu', 'anti-gravity'}
            for name in entries:
                p = pathlib.PurePosixPath(name)
                if prohibited.intersection(p.parts) or p.suffix.lower() in {'.exe', '.dll', '.pyd', '.node', '.scr', '.com', '.pyc', '.msi', '.sys', '.zip', '.7z', '.rar'}:
                    raise RuntimeError(f'Prohibited source: {name}')
                data = z.read(name)
                if data[:2] == b'MZ':
                    raise RuntimeError(f'MZ source: {name}')
                if name != 'SOURCE-MANIFEST.json':
                    assert len(data) == records[name]['size'], name
                    assert hashlib.sha256(data).hexdigest() == records[name]['sha256'], name
        destination.mkdir(parents=True)
        for name, info in entries.items():
            target = destination.joinpath(*pathlib.PurePosixPath(name).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as out:
                out.write(z.read(info))
    print(json.dumps({'archive': str(archive), 'destination': str(destination), 'files': len(entries), 'sourceValidated': source}))


if __name__ == '__main__':
    extract(sys.argv[1], sys.argv[2], '--distribution' not in sys.argv[3:])
