#!/usr/bin/env python3
"""Guest-only final transfer/source/embedded-input byte comparison."""
import hashlib
import json
import os
import pathlib
import sys
import zipfile

# Evidence root must follow the tree being verified; a hardcoded 1.5.5 root made
# a later release read the previous release's reports.
base = pathlib.Path(os.environ.get('ISOLATED_BUILD_BASE', '/home/builder/susu155-final44'))
project = base / 'project'
archive = pathlib.Path(sys.argv[1])


def sha(data):
    return hashlib.sha256(data).hexdigest()


with zipfile.ZipFile(archive) as z:
    manifest = json.loads(z.read('SOURCE-MANIFEST.json'))
    # payloadBinaries is every MZ file the export ships -- all of them inside the
    # three quarantined pack trees, because an MZ anywhere else aborts the export.
    # The five de-tainted payloads are a separate, pinned subset
    # (dedetaintedPayload); asserting payloadBinaries == 5 was stale the moment
    # the quarantined trees legitimately carried their own bundled binaries
    # (python.exe, 7za, ...). "No executable outside the quarantined trees" is
    # proven by the per-file MZ assertion below, not by a hardcoded count.
    payload_paths = {record['path'] for record in manifest['payloadBinaries']}
    dedetainted_paths = {record['path'] for record in manifest['dedetaintedPayload']}
    assert len(dedetainted_paths) == 5, len(dedetainted_paths)
    assert dedetainted_paths <= payload_paths, sorted(dedetainted_paths - payload_paths)
    assert payload_paths and all(name.startswith('packed-packs/') for name in payload_paths), sorted(payload_paths)[:5]
    assert manifest.get('restoredFromQuarantine') == [], 'the retired quarantine-restore mechanism must not reappear'
    for record in manifest['files']:
        name = record['path']
        relative = pathlib.PurePosixPath(name)
        assert not relative.is_absolute() and '..' not in relative.parts
        target = project / name
        assert target.resolve().is_relative_to(project.resolve())
        assert not target.is_symlink()
        data = target.read_bytes()
        if name in payload_paths:
            assert data[:2] == b'MZ', name
        else:
            assert data[:2] != b'MZ', name
        assert len(data) == record['size'] and sha(data) == record['sha256'], name
        assert sha(z.read(name)) == record['sha256'], name
    (base / 'reports' / 'FINAL-SOURCE-MANIFEST.json').write_bytes(z.read('SOURCE-MANIFEST.json'))


def inventory(root):
    return {p.relative_to(root).as_posix(): sha(p.read_bytes()) for p in sorted(root.rglob('*')) if p.is_file()}


nested = base / 'verification/nested-app'
asar = base / 'verification/asar-extracted'
pack_source = inventory(project / 'packed-packs')
pack_output = inventory(nested / 'resources/packs')
pack_diff = {'missing': sorted(set(pack_source) - set(pack_output)),
             'unexpected': sorted(set(pack_output) - set(pack_source)),
             'changed': sorted(p for p in set(pack_source) & set(pack_output) if pack_source[p] != pack_output[p])}
(base / 'reports/pack-source-diff.json').write_text(json.dumps(pack_diff, indent=2) + '\n')
print(json.dumps(pack_diff, indent=2))
# electron-builder's default .git* exclusion omits repository placeholders.
# Accept only empty/newline-only .gitkeep placeholders, never missing code.
omitted_empty_gitkeep = [name for name in pack_diff['missing']
                         if pathlib.PurePosixPath(name).name == '.gitkeep'
                         and (project / 'packed-packs' / name).read_bytes() in (b'', b'\n', b'\r\n')]
assert pack_diff['missing'] == omitted_empty_gitkeep and not pack_diff['unexpected'] and not pack_diff['changed'], 'Pack source/resource difference'
assert inventory(project / 'electron') == inventory(asar / 'electron'), 'Electron source/ASAR difference'
assert inventory(project / 'dist-electron') == inventory(asar / 'dist-electron'), 'Vite output/ASAR difference'
assert (project / 'build/library/library.json').read_bytes() == (nested / 'resources/library/library.json').read_bytes()
result = {'sourceArchive': str(archive), 'sourceArchiveSha256': sha(archive.read_bytes()),
          'sourceFilesMatched': len(manifest['files']), 'allSourceZipEntriesMatchGuestProject': True,
          'embeddedPacksMatchSourceBytesExceptEmptyGitkeep': True, 'omittedEmptyGitkeep': omitted_empty_gitkeep,
          'embeddedElectronMatchesSourceBytes': True,
          'embeddedFrontendMatchesViteBytes': True, 'embeddedLibraryMatchesSourceBytes': True}
(base / 'reports/source-proof.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
