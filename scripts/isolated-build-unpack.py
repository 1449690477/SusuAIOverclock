#!/usr/bin/env python3
"""Guest-only, fail-closed source-archive extraction.

WHY THIS EXISTS INSTEAD OF `unzip`
----------------------------------
Ubuntu/Debian ship Info-ZIP UnZip 6.00. Under the guest's C.UTF-8 locale it
rewrites every bit-11 (UTF-8) entry name into the OEM/CP437 glyph set. The 1.5.7
source archive holds 566 non-ASCII entries, so `unzip` produced 454 garbled
paths - `packed-packs/cursor/一键安装.bat` became
`packed-packs/cursor/ф╕АщФохоЙшгЕ.bat`. The pack's own launcher and the app's
expected-entry detection then could not find it, and the defect would have
shipped inside the portable exe. A minimal two-entry probe in the guest proves
the split: `unzip` writes 0xD1 0x84 0xE2 0x95 0x95 ... where Python's `zipfile`
writes 0xE4 0xB8 0x80 0xE9 0x94 0xAE ... for the same entry.

`zipfile` honours the general-purpose UTF-8 flag and returns the original str, so
extraction is done here instead. The archive itself is correct: every non-ASCII
central-directory name carries bit 11 and decodes as UTF-8.

WHAT IS PROVEN, AND AGAINST WHAT
--------------------------------
The comparison target is `SOURCE-MANIFEST.json`, written by the HOST export
(`isolated-build-export.ps1`) from the host filesystem before any transfer. No
guest-side step can reach it, so a mangled or truncated transfer cannot be
self-consistent. For every declared entry this script asserts:

  * the path exists verbatim (this is the check that would have stopped 1.5.7),
  * the byte size and sha256 match the host values (transfer content integrity),
  * the entry is not a symlink and does not escape the destination.

It also asserts the extracted path set equals the manifest path set exactly, that
all nine distributed pack trees are present, and that the copy of this script
inside the archive is byte-identical to the copy that ran.

python3 scripts/isolated-build-unpack.py --archive SRC.zip --dest DIR [--report J]
"""
import argparse
import hashlib
import json
import os
import pathlib
import sys
import zipfile

MANIFEST_NAME = 'SOURCE-MANIFEST.json'
SELF_NAME = 'scripts/isolated-build-unpack.py'
CURSOR_ENTRY_FILES = [
    'packed-packs/cursor/一键安装.bat',
    'packed-packs/cursor/一键卸载.bat',
    'packed-packs/cursor/使用说明.txt',
    'packed-packs/cursor/实测方法.txt',
]
EXPECTED_PACKS = ['cursor', 'dsh', 'claude', 'opencode', 'workbuddy', 'workbuddy-ai',
                  'codex', 'codex-panghu', 'anti-gravity']
CHUNK = 1 << 20


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(CHUNK), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--archive', required=True)
    parser.add_argument('--dest', required=True)
    parser.add_argument('--report', help='Optional path for the JSON report')
    args = parser.parse_args()

    dest = pathlib.Path(args.dest).resolve()
    archive = pathlib.Path(args.archive).resolve()
    assert sys.platform == 'linux', 'guest only'
    assert str(dest).startswith('/home/builder/'), f'refusing unexpected destination: {dest}'
    assert dest.is_dir(), f'missing destination: {dest}'
    assert archive.is_file(), f'missing archive: {archive}'

    with zipfile.ZipFile(archive) as bundle:
        raw = bundle.read(MANIFEST_NAME)
        manifest = json.loads(raw.decode('utf-8'))
        assert manifest['schemaVersion'] == 2, manifest.get('schemaVersion')
        assert sorted(manifest['packs']) == sorted(EXPECTED_PACKS), manifest.get('packs')
        declared = manifest['files']
        assert len(declared) > 5000, f'manifest is suspiciously small: {len(declared)}'

        entries = bundle.infolist()
        names = [item.filename for item in entries]
        assert len(names) == len(set(names)), 'duplicate entry names in archive'
        archive_names = sorted(name for name in names if name != MANIFEST_NAME)

        extracted = 0
        for item in entries:
            name = item.filename
            relative = pathlib.PurePosixPath(name)
            assert not relative.is_absolute() and '..' not in relative.parts, name
            target = dest.joinpath(*relative.parts)
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            mode = (item.external_attr >> 16) & 0o170000
            assert mode != 0o120000, f'archive symlink rejected: {name}'
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(item) as source, open(target, 'wb') as out:
                while True:
                    block = source.read(CHUNK)
                    if not block:
                        break
                    out.write(block)
            permissions = (item.external_attr >> 16) & 0o777
            # The host exporter never sets external attributes, so a documented
            # default is used rather than an accident: readable everywhere, writable
            # by the owner. Explicit bits in the archive win when present.
            os.chmod(target, permissions if permissions else 0o644)
            extracted += 1

    problems = {'missing': [], 'extra': [], 'sizeMismatch': [], 'hashMismatch': []}
    expected_paths = set()
    for record in declared:
        relative = pathlib.PurePosixPath(record['path'])
        expected_paths.add(record['path'])
        target = dest.joinpath(*relative.parts)
        if not target.is_file():
            problems['missing'].append(record['path'])
            continue
        if target.stat().st_size != record['size']:
            problems['sizeMismatch'].append(record['path'])
            continue
        if sha256_file(target) != record['sha256']:
            problems['hashMismatch'].append(record['path'])

    for name in archive_names:
        if name not in expected_paths:
            problems['extra'].append(name)

    non_ascii = sorted(name for name in expected_paths if any(ord(ch) > 127 for ch in name))

    report = {
        'archive': str(archive),
        'archiveSha256': sha256_file(archive),
        'destination': str(dest),
        'manifestEntries': len(declared),
        'archiveEntries': len(archive_names),
        'extractedFiles': extracted,
        'nonAsciiEntries': len(non_ascii),
        'nonAsciiSample': non_ascii[:5],
        'problems': {key: value[:20] for key, value in problems.items()},
        'problemCounts': {key: len(value) for key, value in problems.items()},
        'packs': sorted(manifest['packs']),
        'excludedByExport': len(manifest.get('excluded', [])),
        'restoredFromQuarantine': manifest.get('restoredFromQuarantine'),
        'limitation': ('Transfer-integrity gate only: it proves the archive arrived '
                       'intact and that names survived the transfer. It is not an '
                       'antivirus verdict and does not attest the host.'),
    }

    for key, value in problems.items():
        assert not value, f'{key} after extraction (first {len(value[:5])}): {value[:5]}'
    assert len(non_ascii) >= 500, f'expected >=500 non-ASCII paths, saw {len(non_ascii)}'
    assert manifest.get('restoredFromQuarantine') == [], \
        'the retired quarantine-restore mechanism must not reappear in the manifest'

    # The harness that ran must be the harness the reviewer can read inside the
    # archive. If the guest copy was swapped, this stops the build.
    shipped = dest / SELF_NAME
    assert shipped.is_file(), f'archive is missing {SELF_NAME}'
    report['unpackerSha256'] = sha256_file(shipped)
    assert report['unpackerSha256'] == sha256_file(pathlib.Path(__file__).resolve()), \
        'the running unpacker differs from the copy shipped in the archive'

    for name in CURSOR_ENTRY_FILES:
        assert name in expected_paths, f'manifest lost a Chinese pack entry: {name}'
        assert (dest / name).is_file(), f'name drift after extraction: {name}'

    if args.report:
        target = pathlib.Path(args.report)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
