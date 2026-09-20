#!/usr/bin/env python3
"""Guest-only evidence/archive delivery, after actual artifact verification/AV."""
import hashlib
import json
import pathlib
import re
import zipfile

BASE = pathlib.Path('/home/builder/susu155-final44')
BUILD_ID = 'susu155-electron44.4.3-final-20260920'
PROJECT = BASE / 'project'
REPORTS = BASE / 'reports'


def digest(p):
    h = hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


result = json.loads((REPORTS / 'artifact-result.json').read_text())
assert result['buildId'] == BUILD_ID and result['electronVersion'] == '44.4.3'
source_proof = json.loads((REPORTS / 'source-proof.json').read_text())
assert source_proof['allSourceZipEntriesMatchGuestProject']
av = json.loads((REPORTS / 'antivirus-status.json').read_text())
assert av['buildId'] == BUILD_ID
classification = json.loads((REPORTS / 'final-av-classification.json').read_text())
exe = pathlib.Path(result['artifact'])
assert exe.parent == PROJECT / 'release'
assert digest(exe) == result['sha256']
assert exe.stat().st_size == result['size']
assert result['knownIocFindings'] == 0 and result['inspectionErrors'] == 0
logs = sorted((BASE / 'logs').glob('build-*.log'), key=lambda p: p.stat().st_mtime)
successful = [p for p in logs if 'PHASE=build EXIT=0' in p.read_text(errors='replace')]
assert successful, 'Missing successful build/test/verification log'
build_log = successful[-1].read_text(errors='replace')
counts = {}
for key in ['tests', 'pass', 'fail', 'skipped']:
    values = re.findall(r'^# ' + key + r' (\d+)\s*$', build_log, re.MULTILINE)
    assert values, f'Missing TAP count: {key}'
    counts[key] = int(values[-1])
assert counts['fail'] == 0
# No "clean" claim if AV signatures/scanning failed or findings need review.
delivery = {**result, 'antivirus': av, 'hostRawExeTransferred': False,
            'buildIdentity': BUILD_ID, 'sourceProof': source_proof,
            'antivirusClassification': classification,
            'supersedes': json.loads((REPORTS / 'superseded-build.json').read_text()),
            'releaseStatus': 'built; antivirus findings unresolved - not AV-cleared' if av.get('scanExit') == 1 else
                             'built; antivirus unavailable/incomplete' if av.get('scanExit') != 0 else 'built; antivirus scan completed without detections',
            'isolation': 'New Ubuntu guest, no shared folders/clipboard; infected host/hypervisor remains a residual risk',
            'tests': counts, 'successfulBuildLog': str(successful[-1]),
            'windowsGuiTested': False, 'guiVerification': {'status': 'pending-for-new-Electron44-build', 'inheritedElectron33GuiResultsApplied': False}}
(REPORTS / 'delivery-report.json').write_text(json.dumps(delivery, ensure_ascii=False, indent=2) + '\n')
# Hash the actual reviewed source snapshot as used in the guest; keep the
# original transfer manifest and explicitly expose later reviewed script edits.
manifest = json.loads((PROJECT / 'SOURCE-MANIFEST.json').read_text())
source_changes = []
for r in manifest['files']:
    p = PROJECT / r['path']
    current = digest(p)
    if current != r['sha256']:
        source_changes.append({'path': r['path'], 'originalSha256': r['sha256'], 'buildSha256': current})
(REPORTS / 'reviewed-source-updates.json').write_text(json.dumps(source_changes, indent=2) + '\n')
out = BASE / 'deliverables'
out.mkdir(exist_ok=True)
archive = out / 'SusuAIOverclock-1.5.5-portable-electron44.4.3-isolated.zip'
if archive.exists():
    raise RuntimeError('Refusing to overwrite existing delivery archive')
files = {exe.name: exe}
for parent, prefix in [(REPORTS, 'reports'), (BASE / 'logs', 'logs')]:
    for p in sorted(parent.rglob('*')):
        if p.is_file() and not p.is_symlink():
            files[f'{prefix}/{p.relative_to(parent).as_posix()}'] = p
for p in sorted((PROJECT / 'scripts').glob('isolated-build*')):
    if p.is_file():
        files[f'reproduce/{p.name}'] = p
for p in sorted((PROJECT / 'scripts').glob('isolated-gui-smoke.*')):
    if p.is_file():
        files[f'reproduce/gui-helpers-not-new-test-evidence/{p.name}'] = p
# Previous read-only AV triage is explicitly reference-only, not a GUI result
# or an AV verdict for the current artifact. Current scan/proof are above.
prior = pathlib.Path('/home/builder/susu155/av-triage-20260920/precise-av-triage-reports.zip')
if prior.exists():
    files['reference-only/previous-Electron33-content-triage-reports.zip'] = prior
for name in ['preflight-security.cjs', 'before-build.cjs', 'pack-portable.cjs', 'apply-portable-patch.cjs']:
    files[f'reproduce/{name}'] = PROJECT / 'scripts' / name
files['reproduce/package.json'] = PROJECT / 'package.json'
files['reproduce/package-lock.json'] = PROJECT / 'package-lock.json'
files['reproduce/SOURCE-MANIFEST.json'] = PROJECT / 'SOURCE-MANIFEST.json'
checksums = ''.join(f'{digest(p)}  {name}\n' for name, p in sorted(files.items()))
with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name, p in sorted(files.items()):
        z.write(p, name)
    z.writestr('SHA256SUMS.txt', checksums)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    h = hashlib.sha256()
    with z.open(exe.name) as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    assert h.hexdigest() == result['sha256'], 'EXE hash changed inside delivery ZIP'
summary = {'archive': str(archive), 'sha256': digest(archive), 'size': archive.stat().st_size,
           'exeSha256': result['sha256'], 'exeSize': result['size'], 'zipInternalExeHashVerified': True}
(out / 'archive-result.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))
