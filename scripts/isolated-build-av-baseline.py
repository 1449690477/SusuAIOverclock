#!/usr/bin/env python3
"""Compare the AV-alerting runtime to the independently pinned official ZIP.
No exclusions, signature edits, payload execution or third-party uploads.
"""
import hashlib
import json
import pathlib
import pefile
import subprocess
import zipfile

base = pathlib.Path('/home/builder/susu155-final44')
project = base / 'project'
archive = base / 'downloads/electron-v44.4.3-win32-x64.zip'
expected = '790a355b684d5c7cc8dc3cdd8c4cca7c4b2d054685427c7554a956879a82e70b'
sha = lambda data: hashlib.sha256(data).hexdigest()
assert sha(archive.read_bytes()) == expected
with zipfile.ZipFile(archive) as z:
    official = z.read('electron.exe')
runtime = project / 'node_modules/electron/dist/electron.exe'
assert runtime.read_bytes() == official
reference = base / 'av-baseline/electron-official.exe'
reference.parent.mkdir(exist_ok=True)
with reference.open('xb') as f:
    f.write(official)
pkg = json.loads((project / 'package.json').read_text())
app = base / 'verification/nested-app' / (pkg['build']['productName'] + '.exe')


def text_sections(filename):
    pe = pefile.PE(str(filename), fast_load=True)
    return {s.Name.rstrip(b'\0').decode('ascii'): sha(s.get_data()) for s in pe.sections if s.Name.rstrip(b'\0') == b'.text'}


sections = text_sections(runtime)
assert sections and sections == text_sections(app), 'Application code section differs from official runtime'
scan = subprocess.run(['/usr/bin/nice', '-n', '15', '/usr/bin/clamscan', '--database=/var/lib/clamav', '--allmatch=yes', '--infected', '--max-scantime=600000', '--max-filesize=600M', '--max-scansize=2000M', '--alert-exceeds-max=yes', str(reference)], capture_output=True, text=True)
(base / 'reports/clamav-official-reference.txt').write_text(scan.stdout + scan.stderr)
result = {'buildId': 'susu155-electron44.4.3-final-20260920', 'electronVersion': '44.4.3', 'officialZipSha256': expected, 'officialRuntimeSha256': sha(official), 'officialRuntimeSize': len(official),
          'buildRuntimeByteIdenticalToOfficialZip': True, 'applicationTextSectionsMatchOfficialRuntime': True,
          'textSectionHashes': sections, 'referenceClamavExit': scan.returncode,
          'limitation': 'Byte identity establishes upstream provenance, not a virus-free verdict. No signature has been bypassed; content detections are reported separately.'}
(base / 'reports/antivirus-upstream-baseline.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
print(scan.stdout + scan.stderr)
