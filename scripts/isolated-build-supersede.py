#!/usr/bin/env python3
"""Record which build this one supersedes, with whatever the guest can prove.

`isolated-build-bundle.py` refuses to package without `reports/superseded-build.json`.
The 1.5.5 harness wrote it from a hardcoded predecessor tree; a later release must
not silently inherit that description, and it must not invent one either. This
script hashes the predecessor artifact when it is actually staged in the guest and
records `artifactPresent: false` plus the declared facts when it is not.

python3 scripts/isolated-build-supersede.py --predecessor-root DIR --version V \
    [--artifact RELATIVE/PATH.exe] [--attempt ID] [--note TEXT]
"""
import argparse
import hashlib
import json
import os
import pathlib

BASE = pathlib.Path(os.environ.get('ISOLATED_BUILD_BASE', '/home/builder/susu155-final44'))
BUILD_ID = os.environ.get('ISOLATED_BUILD_ID', 'susu155-electron44.4.3-final-20260920')


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--predecessor-root', required=True)
parser.add_argument('--version', required=True)
parser.add_argument('--artifact')
parser.add_argument('--attempt')
parser.add_argument('--note', action='append', default=[])
args = parser.parse_args()

root = pathlib.Path(args.predecessor_root)
record = {
    'supersededVersion': args.version,
    'supersededBy': BUILD_ID,
    'supersededArtifact': None,
    'supersededArtifactSha256': None,
    'supersededArtifactSize': None,
    'artifactPresent': False,
    'attempt': args.attempt,
    'notes': args.note,
    'scope': ('This build replaces the named predecessor. The predecessor is not carried in '
              'this release and its own evidence is not re-asserted here.'),
}
if args.artifact:
    candidate = root / args.artifact
    record['supersededArtifact'] = str(candidate)
    if candidate.is_file():
        record['artifactPresent'] = True
        record['supersededArtifactSha256'] = digest(candidate)
        record['supersededArtifactSize'] = candidate.stat().st_size
    else:
        record['notes'] = list(record['notes']) + [
            f'Predecessor artifact not staged in this guest: {candidate}']

target = BASE / 'reports' / 'superseded-build.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(record, ensure_ascii=False, indent=2))
