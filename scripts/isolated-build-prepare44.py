#!/usr/bin/env python3
"""Guest-only Electron-only lock update. Preserves the previous build/evidence."""
import difflib
import hashlib
import json
import os
import pathlib
import subprocess

OLD = pathlib.Path('/home/builder/susu155')
BASE = pathlib.Path('/home/builder/susu155-final44')
assert os.uname().sysname == 'Linux'
BASE.mkdir(exist_ok=False)
for name in ['reports', 'logs', 'config', 'lock-update', 'cache/npm-lock']:
    (BASE / name).mkdir(parents=True, exist_ok=True)


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


old_archive = OLD / 'deliverables/SusuAIOverclock-1.5.5-portable-isolated.zip'
superseded = old_archive.with_name('SusuAIOverclock-1.5.5-portable-electron33.4.11-SUPERSEDED.zip')
assert sha(old_archive) == '88fd06a74d029661b40ddf0f2d9fe711021961cf89f38e4d8bc9c5cd47d8f29c'
assert not superseded.exists()
old_archive.rename(superseded)
previous = {'scope': 'previous Electron33 build, superseded; audit contents unchanged',
            'originalArchivePath': str(old_archive), 'archivePath': str(superseded), 'sha256': sha(superseded),
            'exePath': str(OLD / 'project/release/SusuAIOverclock-1.5.5-portable.exe'),
            'exeSha256': sha(OLD / 'project/release/SusuAIOverclock-1.5.5-portable.exe'),
            'newBuildId': 'susu155-electron44.4.3-final-20260920'}
(BASE / 'reports/superseded-build.json').write_text(json.dumps(previous, indent=2) + '\n')
work = BASE / 'lock-update'
package = pathlib.Path('/home/builder/susu155-final44-package.json')
assert json.loads(package.read_text())['devDependencies']['electron'] == '44.4.3'
(work / 'package.json').write_bytes(package.read_bytes())
old_lock = OLD / 'project/package-lock.json'
(work / 'before-package-lock.json').write_bytes(old_lock.read_bytes())
(work / 'package-lock.json').write_bytes(old_lock.read_bytes())
for kind in ['user', 'global']:
    (BASE / 'config' / f'npm-{kind}.npmrc').write_text('')
node = OLD / 'toolchain/node-v22.23.2-linux-x64/bin/node'
npm = OLD / 'toolchain/node-v22.23.2-linux-x64/lib/node_modules/npm/bin/npm-cli.js'
env = {'HOME': '/home/builder', 'USER': 'builder', 'LANG': 'C.UTF-8',
       'PATH': str(node.parent) + ':/usr/bin:/bin', 'npm_config_cache': str(BASE / 'cache/npm-lock'),
       'npm_config_userconfig': str(BASE / 'config/npm-user.npmrc'),
       'npm_config_globalconfig': str(BASE / 'config/npm-global.npmrc')}
argv = [str(node), str(npm), 'install', '--package-lock-only', '--ignore-scripts', '--include=dev',
        '--include=optional', '--registry=https://registry.npmjs.org', '--no-audit', '--no-fund']
print(json.dumps({'argv': argv, 'cwd': str(work)}), flush=True)
result = subprocess.run(argv, cwd=work, env=env, capture_output=True, text=True, timeout=900)
(BASE / 'logs/electron-only-lock-update.log').write_text(result.stdout + result.stderr)
print(result.stdout + result.stderr, flush=True)
assert result.returncode == 0
assert not (work / 'node_modules').exists(), 'Lock-only update must not install dependencies'
old = json.loads(old_lock.read_text())
new = json.loads((work / 'package-lock.json').read_text())


def closure(lock):
    packages = lock['packages']
    seen = set()
    def resolve(context, name):
        parent = pathlib.PurePosixPath(context)
        while str(parent) != '.':
            key = str(parent / 'node_modules' / name)
            if key in packages:
                return key
            parent = parent.parent
        key = 'node_modules/' + name
        return key if key in packages else None
    def visit(key):
        if key in seen:
            return
        seen.add(key)
        pkg = packages[key]
        for name in {**pkg.get('dependencies', {}), **pkg.get('optionalDependencies', {}), **pkg.get('peerDependencies', {})}:
            target = resolve(key, name)
            if target:
                visit(target)
    visit('node_modules/electron')
    return seen


old_root, new_root = old['packages'][''], new['packages']['']
expected_root = json.loads(json.dumps(old_root))
expected_root['devDependencies']['electron'] = '44.4.3'
assert new_root == expected_root, 'Unrelated root dependency change'
allowed = closure(old) | closure(new)
changed = []
for key in sorted(set(old['packages']) | set(new['packages'])):
    if key and old['packages'].get(key) != new['packages'].get(key):
        changed.append({'path': key, 'oldVersion': old['packages'].get(key, {}).get('version'),
                        'newVersion': new['packages'].get(key, {}).get('version'), 'withinElectronDependencyClosure': key in allowed})
outside = [row for row in changed if not row['withinElectronDependencyClosure']]
review = {'beforeSha256': sha(old_lock), 'afterSha256': sha(work / 'package-lock.json'),
          'changed': changed, 'outsideElectronClosure': outside, 'npmExit': result.returncode,
          'command': argv, 'nodeModulesInstalled': False}
(BASE / 'reports/electron-lock-review.json').write_text(json.dumps(review, indent=2) + '\n')
diff = ''.join(difflib.unified_diff(old_lock.read_text().splitlines(True), (work / 'package-lock.json').read_text().splitlines(True),
                                  fromfile='before/package-lock.json', tofile='after/package-lock.json'))
(BASE / 'reports/electron-lock.diff').write_text(diff)
print(json.dumps(review, indent=2))
assert not outside, 'Incidental dependency changes require explicit review; do not accept this lock automatically'
