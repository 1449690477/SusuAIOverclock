#!/usr/bin/env python3
"""Preserve this build's failed verification attempt; never touch other tasks."""
import hashlib
import json
import os
import pathlib
import shutil
import signal
import sys
import time

BASE = pathlib.Path('/home/builder/susu155-final44')
pid = int(sys.argv[1])
process = pathlib.Path('/proc') / str(pid)
argv = (process / 'cmdline').read_bytes().split(b'\0')
expected = str(BASE / 'project/scripts/isolated-build-runtime-proof.py').encode()
assert expected in argv and b'/usr/bin/python3' in argv, 'Refuse to signal anything but this exact owned verifier'
status = (process / 'status').read_text()
parent = int(next(line.split()[1] for line in status.splitlines() if line.startswith('PPid:')))
parent_args = (pathlib.Path('/proc') / str(parent) / 'cmdline').read_bytes()
assert b'isolated-build-verify.cjs\0artifact' in parent_args
record = {'verifierPid': pid, 'parentPid': parent, 'argv': [p.decode() for p in argv if p],
          'statusBefore': status, 'reason': 'Unneeded pefile directory parsing exceeded intended 2GB-guest memory budget; change to fast_load section-only comparison, same code-section/complete-runtime checks.'}
(BASE / 'logs/verifier-memory-interruption.json').write_text(json.dumps(record, indent=2) + '\n')
os.kill(pid, signal.SIGTERM)
for _ in range(60):
    p = pathlib.Path('/proc') / str(parent) / 'status'
    if not p.exists() or '\nState:\tZ' in p.read_text():
        break
    time.sleep(1)
else:
    raise RuntimeError('Parent still active; do not move artifacts')
attempt = BASE / 'previous-attempts/attempt1'
attempt.mkdir(parents=True, exist_ok=False)
shutil.copytree(BASE / 'reports', attempt / 'reports')
for source, name in [(BASE / 'project/release', 'release'), (BASE / 'verification', 'verification')]:
    source.rename(attempt / name)
exe = attempt / 'release/SusuAIOverclock-1.5.5-portable.exe'
record['preservedArtifact'] = str(exe)
record['sha256'] = hashlib.sha256(exe.read_bytes()).hexdigest()
record['size'] = exe.stat().st_size
(attempt / 'attempt-preservation.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({'preservedArtifact': str(exe), 'sha256': record['sha256'], 'size': record['size']}, indent=2))
