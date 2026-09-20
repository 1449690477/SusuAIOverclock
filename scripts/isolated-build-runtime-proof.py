#!/usr/bin/env python3
"""Read-only proof of the complete official Windows runtime in the actual app."""
import hashlib
import json
import pathlib
import pefile
import sys
import zipfile

BASE = pathlib.Path('/home/builder/susu155-final44')
project = BASE / 'project'
app = pathlib.Path(sys.argv[1])
pkg = json.loads((project / 'package.json').read_text())
sha = lambda data: hashlib.sha256(data).hexdigest()
archive = BASE / 'downloads/electron-v44.4.3-win32-x64.zip'
assert sha(archive.read_bytes()) == '790a355b684d5c7cc8dc3cdd8c4cca7c4b2d054685427c7554a956879a82e70b'
stock = project / 'node_modules/electron/dist/electron.exe'
assert sha(stock.read_bytes()) == 'bf0fe749904ca9f713ccfb2427c519fa39d0bbd0337ba411ba08785802e8d548'
renamed = app / (pkg['build']['productName'] + '.exe')
# Only section headers/data are needed here. Avoid parsing every import/resource
# directory twice in a 2GB guest; this does not narrow the section comparison.
stock_pe, app_pe = pefile.PE(str(stock), fast_load=True), pefile.PE(str(renamed), fast_load=True)
text = lambda pe: {s.Name.decode().rstrip('\0'): sha(s.get_data()) for s in pe.sections if s.Name.rstrip(b'\0') == b'.text'}
assert text(stock_pe) and text(stock_pe) == text(app_pe), 'Runtime code sections changed'
files = []
builder_removed = {'version', 'resources/default_app.asar', 'LICENSE', 'LICENSES.chromium.html'}
with zipfile.ZipFile(archive) as z:
    for info in z.infolist():
        if info.is_dir() or info.filename == 'electron.exe':
            continue
        p = app / info.filename
        if not p.exists() and info.filename in builder_removed:
            files.append({'path': info.filename, 'status': 'builder-distribution-metadata/default-app omission'})
            continue
        assert p.is_file(), info.filename
        assert sha(p.read_bytes()) == sha(z.read(info)), info.filename
        files.append({'path': info.filename, 'status': 'byte-identical-to-official-zip', 'sha256': sha(p.read_bytes())})
source = (project / 'electron/pack-source-policy.cjs').read_text()
assert 'function missingExpectedEntries(' in source
for filename in ['core.cjs', 'main.cjs']:
    assert 'missingExpectedEntries(' in (project / 'electron' / filename).read_text()
report = {'buildId': 'susu155-electron44.4.3-final-20260920', 'electronVersion': '44.4.3',
          'applicationVersion': pkg['version'], 'officialStockExeSha256': sha(stock.read_bytes()),
          'applicationExeSha256': sha(renamed.read_bytes()), 'officialCodeSectionsPreserved': True,
          'runtimeTextSections': text(stock_pe), 'runtimeFiles': files,
          'parentMissingEntriesFixPresent': True, 'guiVerification': 'pending-for-this-build'}
(BASE / 'reports/runtime-proof.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'electronVersion': report['electronVersion'], 'runtimeFilesChecked': len(files), 'officialCodeSectionsPreserved': True}))
