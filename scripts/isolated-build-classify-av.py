#!/usr/bin/env python3
"""Prove content preservation and classify real final scan results, never filter."""
import collections
import hashlib
import json
import os
import pathlib
import re
import sys

# Evidence root, build identity and the legacy snapshot must all follow the tree
# being classified. The 1.5.5 defaults made a newer release compare itself against
# the wrong predecessor and overwrite that predecessor's report.
BASE = pathlib.Path(os.environ.get('ISOLATED_BUILD_BASE', '/home/builder/susu155-final44'))
OLD = pathlib.Path(os.environ.get('ISOLATED_BUILD_PREDECESSOR', '/home/builder/susu155'))
PROJECT = BASE / 'project'
REPORTS = BASE / 'reports'
BUILD_ID = os.environ.get('ISOLATED_BUILD_ID', 'susu155-electron44.4.3-final-20260920')


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def inventory(root):
    result = {}
    for p in sorted(root.rglob('*')):
        assert not p.is_symlink(), p
        if p.is_file():
            result[p.relative_to(root).as_posix()] = sha(p)
    return result


# v1.5.7: the reviewed baseline is the host-written SOURCE-MANIFEST inside the
# extracted archive, not the superseded 1.5.5 tree. The 1.5.5 tree cannot serve as
# the baseline any more: the 1.5.7 export legitimately carries the five quarantined
# payloads de-tainted inside packed-packs/, and the 1.5.5 tree never had them (the
# hygiene sweep had moved them into .security-quarantine-1.5.5). Any divergence
# outside that declared set is still a failure.
manifest = json.loads((PROJECT / 'SOURCE-MANIFEST.json').read_text())
declared = {r['path']: (r['size'], r['sha256']) for r in manifest['files']}
dedetaint = json.loads((PROJECT / 'scripts/payload-dedetaint.json').read_text())
payload_entries = {item['entryPath']: item for item in dedetaint['items']}
assert len(payload_entries) == 5, len(payload_entries)

packs = inventory(PROJECT / 'packed-packs')
pack_declared = {name: value[1] for name, value in declared.items() if name.startswith('packed-packs/')}
pack_actual = {f'packed-packs/{name}': value for name, value in packs.items()}
assert pack_declared == pack_actual, 'Pack material does not match the reviewed source manifest'
for name, item in payload_entries.items():
    assert pack_actual.get(name) == item['cleanSha256'], f'Payload is not the de-tainted copy: {name}'

library_path = PROJECT / 'build/library/library.json'
library_sha = sha(library_path)
assert declared['build/library/library.json'][1] == library_sha, 'Library differs from the reviewed source manifest'
legacy_library_sha = 'd8a93079dea6e3807099b79f30e24f8c7f912c73919d2286829f7aa5c15d38ba'
legacy_predecessor_present = (OLD / 'project/packed-packs').is_dir()
legacy_notes = ('Predecessor tree not staged in this guest; the reviewed manifest above is the baseline.'
                if not legacy_predecessor_present else
                'Predecessor tree staged; the only permitted divergence is the five declared '
                'quarantined payloads now carried de-tainted inside packed-packs/.')
parent_files = ['electron/pack-source-policy.cjs', 'electron/core.cjs', 'electron/main.cjs', 'tests/security-quarantine.test.cjs']
parent_hashes = {name: sha(PROJECT / name) for name in parent_files}
for name in parent_files[:3]:
    assert 'missingExpectedEntries' in (PROJECT / name).read_text(), name
assert 'expected entries resolve nested paths without false missing warnings' in (PROJECT / parent_files[3]).read_text()
content = {'buildId': BUILD_ID, 'allPackMaterialFilesUnmodified': True, 'packFiles': len(packs),
           'librarySha256': library_sha, 'libraryUnmodified': True,
           'legacyLibrarySha256': legacy_library_sha,
           'libraryMatchesLegacySnapshot': library_sha == legacy_library_sha,
           'quarantinedPayloadsCarriedDetainted': sorted(payload_entries),
           'baseline': 'host-written SOURCE-MANIFEST.json (schemaVersion %s), %d entries'
                       % (manifest['schemaVersion'], len(declared)),
           'predecessorStaged': legacy_predecessor_present, 'predecessorNotes': legacy_notes,
           'parentFixedFilesSha256': parent_hashes}
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
allowed_content_signatures = {'Win.Exploit.CVE_2015_6096-1', 'Img.Phishing.SvgJsPhishing-10044282-4', 'Img.Phishing.SvgJsPhishing-10044283-0', 'Html.Downloader.Satan-6249582-1'}
unexpected = [r for r in findings if r['signature'] not in allowed_content_signatures]
input_docs = sorted(set(r['path'] for r in findings if r['scope'] == 'input-pack-document'))
# The previous read-only full-engine triage stays reference-only and is applied
# only when it is actually staged in this guest.
triage = OLD / 'av-triage-20260920/exact-library-hit-entries.json'
prior = json.loads(triage.read_text()) if triage.exists() else None
if prior:
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
  'unchangedLibraryPromptIdsWithContentAlerts': [r['id'] for r in prior['entries']] if prior else [],
  'previousTriageApplied': bool(prior),
  'perEntryEvidenceScope': 'Previous read-only full-engine triage remains applicable to byte-identical unchanged library; no splitting or encoding applied to this build.' if prior else 'Previous triage bundle not staged in this guest; not applied and not claimed.',
  'libraryCollectionAlert': 'Satan is whole-collection keyword co-occurrence, not an identified standalone downloader entry.',
  'unexpectedFindings': unexpected, 'limitsReported': 'Heuristics.Limits.Exceeded' in log,
  'contentPreservation': content, 'allFindings': findings,
  'verdict': 'Actual remaining AV detections are reported; not a virus-free or AV-pass certification.'}
(REPORTS / 'final-av-classification.json').write_text(json.dumps(classification, indent=2, ensure_ascii=False) + '\n')
print(json.dumps({k: v for k, v in classification.items() if k not in {'allFindings', 'inputDocumentPaths', 'contentPreservation'}}, indent=2))
assert stats['Scanned files'] is not None
assert not classification['limitsReported'], 'Retain this log and rescan affected paths with a larger budget'
assert not unexpected, 'Unexpected signature requires separate review; do not suppress it'
