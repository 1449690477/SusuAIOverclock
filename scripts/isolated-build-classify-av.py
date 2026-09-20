#!/usr/bin/env python3
"""Prove content preservation and classify real final scan results, never filter."""
import collections
import hashlib
import json
import pathlib
import re
import sys

BASE = pathlib.Path('/home/builder/susu155-final44')
OLD = pathlib.Path('/home/builder/susu155')
PROJECT = BASE / 'project'
REPORTS = BASE / 'reports'
BUILD_ID = 'susu155-electron44.4.3-final-20260920'


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def inventory(root):
    result = {}
    for p in sorted(root.rglob('*')):
        assert not p.is_symlink(), p
        if p.is_file():
            result[p.relative_to(root).as_posix()] = sha(p)
    return result


packs = inventory(PROJECT / 'packed-packs')
assert packs == inventory(OLD / 'project/packed-packs'), 'Prompt/pack material changed'
library_path = PROJECT / 'build/library/library.json'
assert sha(library_path) == sha(OLD / 'project/build/library/library.json') == 'd8a93079dea6e3807099b79f30e24f8c7f912c73919d2286829f7aa5c15d38ba'
lock_review = json.loads((REPORTS / 'electron-lock-review.json').read_text())
assert sha(PROJECT / 'package-lock.json') == lock_review['afterSha256'] and not lock_review['outsideElectronClosure']
parent_files = ['electron/pack-source-policy.cjs', 'electron/core.cjs', 'electron/main.cjs', 'tests/security-quarantine.test.cjs']
parent_hashes = {name: sha(PROJECT / name) for name in parent_files}
for name in parent_files[:3]:
    assert 'missingExpectedEntries' in (PROJECT / name).read_text(), name
assert 'expected entries resolve nested paths without false missing warnings' in (PROJECT / parent_files[3]).read_text()
content = {'buildId': BUILD_ID, 'allPackMaterialFilesUnmodified': True, 'packFiles': len(packs),
           'librarySha256': sha(library_path), 'libraryUnmodified': True,
           'parentFixedFilesSha256': parent_hashes, 'lockSha256': sha(PROJECT / 'package-lock.json')}
(REPORTS / 'content-preservation.json').write_text(json.dumps(content, indent=2) + '\n')
if len(sys.argv) > 1 and sys.argv[1] == 'inputs':
    print(json.dumps(content, indent=2))
    raise SystemExit(0)

log = (REPORTS / 'clamav-scan.txt').read_text()
findings = []
for line in log.splitlines():
    m = re.fullmatch(r'(/.*): (\S+) FOUND', line)
    if not m:
        continue
    p, signature = pathlib.Path(m[1]), m[2]
    if '/project/packed-packs/' in str(p):
        scope = 'input-pack-document'
    elif p == library_path:
        scope = 'input-library-collection'
    elif p.suffix.lower() in {'.exe', '.7z', '.asar', '.zip'}:
        scope = 'output-container-or-executable'
    elif '/resources/packs/' in str(p):
        scope = 'output-pack-document-copy'
    elif p.name == 'library.json':
        scope = 'output-library-collection-copy'
    else:
        scope = 'other-input-or-output'
    findings.append({'path': str(p), 'signature': signature, 'scope': scope})
allowed_content_signatures = {'Win.Exploit.CVE_2015_6096-1', 'Img.Phishing.SvgJsPhishing-10044283-0', 'Html.Downloader.Satan-6249582-1'}
unexpected = [r for r in findings if r['signature'] not in allowed_content_signatures]
input_docs = sorted(set(r['path'] for r in findings if r['scope'] == 'input-pack-document'))
prior = json.loads((OLD / 'av-triage-20260920/exact-library-hit-entries.json').read_text())
prompts = json.loads(library_path.read_text())['prompts']
for row in prior['entries']:
    p = prompts[row['index']]
    assert p['id'] == row['id'] and hashlib.sha256(p['content'].encode()).hexdigest() == row['contentSha256']
stats = {}
for name in ['Known viruses', 'Scanned files', 'Scanned directories', 'Infected files']:
    m = re.search(r'^' + re.escape(name) + r':\s*(\d+)', log, re.MULTILINE)
    stats[name] = int(m[1]) if m else None
classification = {'buildId': BUILD_ID, 'scanSummary': stats, 'alertLines': len(findings),
  'countsBySignature': dict(collections.Counter(r['signature'] for r in findings)),
  'countsByScope': dict(collections.Counter(r['scope'] for r in findings)),
  'inputDocumentPaths': input_docs, 'inputDocumentCount': len(input_docs),
  'inputDocDistinctContents': len(set(sha(pathlib.Path(p)) for p in input_docs)),
  'unchangedLibraryPromptIdsWithContentAlerts': [r['id'] for r in prior['entries']],
  'perEntryEvidenceScope': 'Previous read-only full-engine triage remains applicable to byte-identical unchanged library; no splitting or encoding applied to this build.',
  'libraryCollectionAlert': 'Satan is whole-collection keyword co-occurrence, not an identified standalone downloader entry.',
  'unexpectedFindings': unexpected, 'limitsReported': 'Heuristics.Limits.Exceeded' in log,
  'contentPreservation': content, 'allFindings': findings,
  'verdict': 'Actual remaining AV detections are reported; not a virus-free or AV-pass certification.'}
(REPORTS / 'final-av-classification.json').write_text(json.dumps(classification, indent=2, ensure_ascii=False) + '\n')
print(json.dumps({k: v for k, v in classification.items() if k not in {'allFindings', 'inputDocumentPaths', 'contentPreservation'}}, indent=2))
assert stats['Scanned files'] is not None
assert not classification['limitsReported'], 'Retain this log and rescan affected paths with a larger budget'
assert not unexpected, 'Unexpected signature requires separate review; do not suppress it'
