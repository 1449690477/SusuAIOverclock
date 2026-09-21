#!/usr/bin/env python3
"""Guest-only packaged GUI verification. Never build or execute pack contents.

python3 scripts/isolated-gui-smoke.py --root BUILD_ROOT --runtime VERSION MODE
MODE: inspect|stage|wine|linux|linux-no-sandbox|finalize|review
Stage requires --runtime-sha256 from the independently retrieved official sums.
Outputs are versioned, unique directories under BUILD_ROOT/logs and reports.
Network isolation is per run, not a guest-wide firewall or an AV exclusion.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import zipfile

BASE = PROJECT = RUNTIME = WIN = STAGED = None
VERSION = RELEASE = ZIP = SHA = None
ARGS = None
# Authoritative lists mirror electron/security-policy.cjs and the same literals in
# isolated-gui-smoke.cjs; tests/security-quarantine.test.cjs asserts they still
# equal the policy, so drift fails the fast suite.
#   ALLOWED  == RELEASE_PACK_IDS      -> deploy allowlist, installable by default
#   RETIRED  == QUARANTINED_PACK_IDS  -> consent-required, blocked until consent
#   ALLOWED+RETIRED == DISTRIBUTED_PACK_IDS -> what actually ships in resources/packs
ALLOWED = ['cursor', 'dsh', 'claude', 'opencode', 'workbuddy', 'workbuddy-ai']
RETIRED = ['codex', 'codex-panghu', 'anti-gravity']
DISTRIBUTED = sorted(ALLOWED + RETIRED)
NESTED = {'cursor': ['materials/rules', 'materials/tools/cursor_tamper_proxy.py'],
          'workbuddy-ai': ['materials/IDENTITY.md', 'materials/MEMORY.md', 'materials/SOUL-snippet.txt']}
KEYS = ('HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CODEX_HOME',
        'DSH_HOME', 'WB_HOME', 'WBAI_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME',
        'XDG_DATA_HOME', 'XDG_RUNTIME_DIR', 'TMPDIR')


def digest(p):
    with open(p, 'rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def write(p, data):
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def node_path():
    if ARGS.node:
        assert Path(ARGS.node).is_file(), ARGS.node
        return Path(ARGS.node).resolve()
    choices = list((BASE / 'toolchain').glob('node-*/bin/node')) + list(Path('/opt').glob('node*/bin/node'))
    assert choices, 'No guest Node toolchain'
    return sorted(choices)[-1]


def manifest(root):
    assert root.is_dir(), f'Missing resource directory: {root}'
    out = {}
    for p in sorted(root.rglob('*')):
        assert not p.is_symlink(), f'Symlink not accepted in packaged resources: {p}'
        if p.is_file():
            out[str(p.relative_to(root))] = {'bytes': p.stat().st_size, 'sha256': digest(p)}
    return out


def download(url, dest):
    assert url.startswith('https://')
    req = urllib.request.Request(url, headers={'User-Agent': 'susu155-isolated-gui-verification'})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, 'wb') as f:
        shutil.copyfileobj(r, f)


def inspect():
    pkg = json.loads((PROJECT / 'package.json').read_text())
    assert pkg['version'] == ARGS.app_version
    assert json.loads((PROJECT / 'node_modules/electron/package.json').read_text())['version'] == VERSION
    portable = PROJECT / 'release' / pkg['build']['portable']['artifactName'].replace('${version}', pkg['version'])
    data = {'guest': os.uname().nodename, 'root': str(BASE), 'runtime': VERSION, 'node': str(node_path()),
            'executables': [str(p) for p in WIN.glob('*.exe')],
            'resourceTopLevel': sorted(p.name for p in (WIN / 'resources').iterdir()),
            'asarSHA256': digest(WIN / 'resources/app.asar'),
            'nodeVersion': subprocess.check_output([node_path(), '--version'], text=True).strip(),
            'playwright': json.loads((PROJECT / 'node_modules/playwright-core/package.json').read_text())['version'],
            'libraryFiles': [str(p.relative_to(WIN / 'resources')) for p in (WIN / 'resources/library').rglob('*.json')],
            'windowsElectronSHA256': digest(PROJECT / 'node_modules/electron/dist/electron.exe'),
            'portablePath': str(portable), 'portableSHA256': digest(portable),
            'packResourceDirectories': sorted(p.name for p in (WIN / 'resources/packs').iterdir() if p.is_dir()),
            'nestedPaths': [{'id': pack, 'path': rel, 'exists': (WIN / 'resources/packs' / pack / rel).exists()}
                            for pack, paths in NESTED.items() for rel in paths]}
    # v1.5.7: distribution is nine packs, deployment is six. The quarantined three
    # ship with a real payload so a registered consent has something to install.
    assert data['packResourceDirectories'] == DISTRIBUTED
    assert all(p['exists'] for p in data['nestedPaths'])
    if ARGS.artifact_sha256:
        assert data['portableSHA256'] == ARGS.artifact_sha256, 'Unexpected final portable artifact'
    write(BASE / 'reports' / f'gui-input-electron{VERSION}.json', data)
    print(json.dumps(data, ensure_ascii=False, indent=2), flush=True)


def stage():
    assert SHA, 'stage requires --runtime-sha256'
    inspect()
    RUNTIME.mkdir(parents=True, exist_ok=True)
    downloads = RUNTIME / 'downloads'
    downloads.mkdir(exist_ok=True)
    sums = downloads / 'SHASUMS256.txt'
    download(RELEASE + 'SHASUMS256.txt', sums)
    assert f'{SHA} *{ZIP}' in sums.read_text().splitlines()
    archive = downloads / ZIP
    if not archive.exists() or digest(archive) != SHA:
        download(RELEASE + ZIP, archive)
    assert digest(archive) == SHA
    # Independently re-check the npm tarball SRI and EVERY installed package file.
    lock = json.loads((PROJECT / 'package-lock.json').read_text())['packages']['node_modules/playwright-core']
    assert lock['resolved'].startswith('https://registry.npmjs.org/playwright-core/')
    tgz = downloads / 'playwright-core.tgz'
    download(lock['resolved'], tgz)
    algo, expected = lock['integrity'].split('-', 1)
    assert algo == 'sha512'
    actual = base64.b64encode(hashlib.sha512(tgz.read_bytes()).digest()).decode()
    assert actual == expected, 'Playwright npm SRI mismatch'
    checked = 0
    omitted_placeholders = []
    declared_files = set()
    with tarfile.open(tgz, 'r:gz') as tf:
        for member in tf:
            assert not member.issym() and not member.islnk()
            if not member.isfile():
                continue
            relative = Path(member.name).relative_to('package')
            assert '..' not in relative.parts
            installed = PROJECT / 'node_modules/playwright-core' / relative
            declared_files.add(str(relative))
            original = tf.extractfile(member).read()
            # Fresh builder may omit tiny version-control directory placeholders.
            # Record only absent *.gitkeep <=256 bytes, never skip code/data or
            # change either the installed package or actual packaged resources.
            if not installed.exists() and relative.name.endswith('.gitkeep') and member.size <= 256:
                omitted_placeholders.append({'path': str(relative), 'bytes': member.size,
                                             'sha256': hashlib.sha256(original).hexdigest()})
                continue
            assert installed.read_bytes() == original, str(installed)
            checked += 1
    installed_files = {str(p.relative_to(PROJECT / 'node_modules/playwright-core'))
                       for p in (PROJECT / 'node_modules/playwright-core').rglob('*') if p.is_file()}
    assert not (installed_files - declared_files), f'Unexpected Playwright files: {installed_files - declared_files}'
    dest = STAGED
    assert not dest.exists(), 'Refusing to overwrite an existing staged runtime'
    dest.mkdir()
    with zipfile.ZipFile(archive) as zf:
        for member in zf.infolist():
            rel = Path(member.filename)
            assert not rel.is_absolute() and '..' not in rel.parts
            assert ((member.external_attr >> 16) & 0o170000) != 0o120000, 'Runtime symlink not accepted'
            zf.extract(member, dest)
            mode = (member.external_attr >> 16) & 0o777
            if mode:
                (dest / rel).chmod(mode)
    before = manifest(WIN / 'resources')
    for name in ('app.asar', 'app.asar.unpacked', 'packs', 'library'):
        src = WIN / 'resources' / name
        if not src.exists():
            assert name == 'app.asar.unpacked', f'Missing {name}'
            continue
        target = dest / 'resources' / name
        if src.is_dir():
            shutil.copytree(src, target)
        else:
            shutil.copy2(src, target)
    after = manifest(dest / 'resources')
    for name, item in before.items():
        assert after.get(name) == item, f'Resource changed: {name}'
    data = {'officialURL': RELEASE + ZIP, 'sha256': SHA, 'checksumURL': RELEASE + 'SHASUMS256.txt',
            'root': str(BASE), 'runtime': VERSION, 'applicationVersion': ARGS.app_version,
            'stagedRuntime': str(dest), 'resourceFilesCompared': len(before),
            'appAsarSHA256': digest(dest / 'resources/app.asar'),
            'windowsElectronSHA256': digest(PROJECT / 'node_modules/electron/dist/electron.exe'),
            'playwright': {'version': lock['version'], 'url': lock['resolved'], 'integrity': lock['integrity'],
                           'installedFilesCompared': checked, 'omittedTinyGitkeep': omitted_placeholders}, 'noSourceRecompile': True}
    write(RUNTIME / 'resources-original.json', before)
    write(RUNTIME / 'stage-report.json', data)
    print(json.dumps(data, ensure_ascii=False, indent=2), flush=True)


def run(mode):
    assert os.getuid() != 0
    logs = BASE / 'logs'
    assert logs.is_dir()
    assert (RUNTIME / 'stage-report.json').is_file(), 'Stage and hash-verify runtime first'
    staged_report = json.loads((RUNTIME / 'stage-report.json').read_text())
    assert staged_report['runtime'] == VERSION and staged_report['root'] == str(BASE)
    if mode == 'linux-no-sandbox':
        prior = list(logs.glob(f'gui-electron{VERSION}-linux-*/launcher.log'))
        assert any('sandbox' in p.read_text(errors='replace').lower() and
                   ('FATAL' in p.read_text(errors='replace') or 'not permitted' in p.read_text(errors='replace'))
                   for p in prior), 'First record an actual default-sandbox launch failure'
    runpath = Path(tempfile.mkdtemp(prefix=f'gui-electron{VERSION}-{mode}-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-', dir=logs))
    # Every path exists before either Wine or Electron starts; no state migration.
    for key in KEYS:
        (runpath / 'profile' / key.lower()).mkdir(parents=True, mode=0o700)
    (runpath / 'screenshots').mkdir()
    (runpath / 'wine-prefix').mkdir(mode=0o700)
    write(runpath / 'resources-before.json', manifest(WIN / 'resources'))
    write(runpath / 'windows-runtime-before.json', manifest(PROJECT / 'node_modules/electron/dist'))
    pkg = json.loads((PROJECT / 'package.json').read_text())
    portable = PROJECT / 'release' / pkg['build']['portable']['artifactName'].replace('${version}', pkg['version'])
    portable_before = digest(portable)
    if ARGS.artifact_sha256:
        assert portable_before == ARGS.artifact_sha256
    write(runpath / 'input.json', {'root': str(BASE), 'runtime': VERSION, 'artifactSHA256': portable_before,
                                 'appAsarSHA256': digest(WIN / 'resources/app.asar'),
                                 'scripts': {p.name: digest(p) for p in Path(__file__).parent.glob('isolated-gui-smoke.*')}})
    # A private PID namespace makes the kernel reap this run's descendants if
    # its supervisor exits, including on timeout; no global process termination.
    cmd = ['sudo', '-n', '/usr/bin/timeout', '--kill-after=10s', '360s', 'unshare',
           '--net', '--pid', '--fork', '--kill-child', '--mount-proc', '--', '/usr/bin/python3',
           str(Path(__file__).resolve()), '--root', str(BASE), '--runtime', VERSION,
           '--app-version', ARGS.app_version, '--node', str(node_path()), '_network', mode, str(runpath)]
    write(runpath / 'command.json', cmd)
    print('RUN_DIR=' + str(runpath), flush=True)
    with open(runpath / 'launcher.log', 'w') as log:
        child = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT)
        try:
            rc = child.wait(timeout=380)
        except subprocess.TimeoutExpired:
            # Network child has its own bounded subprocess timeout as well.
            rc = 124
    unchanged = json.loads((runpath / 'resources-before.json').read_text()) == manifest(WIN / 'resources')
    win_unchanged = json.loads((runpath / 'windows-runtime-before.json').read_text()) == manifest(PROJECT / 'node_modules/electron/dist')
    stage_unchanged = None
    if (RUNTIME / 'stage-report.json').exists():
        orig = json.loads((RUNTIME / 'resources-original.json').read_text())
        staged = manifest(STAGED / 'resources')
        stage_unchanged = all(staged.get(k) == v for k, v in orig.items())
    record = {'exitCode': rc, 'originalResourcesUnchanged': unchanged,
              'projectWindowsElectronDistUnchanged': win_unchanged,
              'stagedPackagedResourcesUnchanged': stage_unchanged,
              'portableArtifactUnchanged': digest(portable) == portable_before,
              'portableArtifactSHA256': digest(portable)}
    write(runpath / 'completion.json', record)
    for name in ('launcher.log', 'report.json', 'completion.json', 'electron.log', 'main-trace.log'):
        p = runpath / name
        if p.exists():
            if name == 'report.json':
                r = json.loads(p.read_text())
                summary = {k: r.get(k) for k in ('status', 'mode', 'error', 'electronInfo', 'initialUiReadyMs', 'library', 'quarantineEvents', 'rendererErrors', 'console', 'failedRequests', 'limitations')}
                if summary.get('library'):
                    summary['library'] = {k: v for k, v in summary['library'].items() if k != 'prompts'}
                summary['checkCount'] = len(r.get('checks', []))
                summary['failedChecks'] = [x for x in r.get('checks', []) if not x['ok']]
                summary['quarantineRejections'] = sum(x.get('rejected', False) for x in r.get('quarantineIPC', []))
                summary['screenshots'] = r.get('screenshots', [])
                print('\n--- report summary ---\n' + json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
            else:
                print('\n--- ' + name + ' ---\n' + p.read_text(errors='replace'), flush=True)
    return rc


def network(mode, runpath):
    assert os.getuid() == 0
    subprocess.run(['/usr/sbin/ip', 'link', 'set', 'lo', 'up'], check=True)
    facts = {a: subprocess.check_output(['/usr/sbin/ip', '-j', a], text=True) for a in ('address', 'route')}
    facts['namespace'] = os.readlink('/proc/self/ns/net')
    assert json.loads(facts['route']) == [], 'Unexpected external route'
    assert [x['ifname'] for x in json.loads(facts['address'])] == ['lo']
    user = pwd.getpwnam('builder')
    os.setgroups([])
    os.setgid(user.pw_gid)
    os.setuid(user.pw_uid)
    write(runpath / 'network.json', facts)
    env = {'PATH': str(node_path().parent) + ':/usr/bin:/bin', 'LANG': 'C.UTF-8', 'USER': 'builder', 'LOGNAME': 'builder', 'DEBUG': 'pw:browser',
           'GUI_RUN_DIR': str(runpath), 'GUI_MODE': mode, 'GUI_RUNTIME_DIR': str(STAGED),
           'GUI_APP_VERSION': ARGS.app_version, 'DANGO_NO_GPU': '1', 'DANGO_TRACE': '1',
           'DANGO_TRACE_FILE': str(runpath / 'main-trace.log'), 'ELECTRON_ENABLE_LOGGING': '1',
           'WINEPREFIX': str(runpath / 'wine-prefix'), 'WINEARCH': 'win64', 'WINEDEBUG': '-all',
           'WINEDLLOVERRIDES': 'mscoree,mshtml=', 'GUI_EXECUTABLE': str(next(p for p in WIN.glob('*.exe') if 'uninstall' not in p.name.lower())) if mode == 'wine' else str(STAGED / 'electron')}
    for key in KEYS:
        env[key] = str(runpath / 'profile' / key.lower())
    env['TEMP'] = env['TMP'] = env['TMPDIR']
    if mode == 'wine':
        for key in ('USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CODEX_HOME', 'DSH_HOME', 'WB_HOME', 'WBAI_HOME'):
            env[key] = 'Z:' + env[key].replace('/', '\\')
    assert 'ELECTRON_RUN_AS_NODE' not in env
    write(runpath / 'launch-env.json', env)
    xvlog = open(runpath / 'xvfb.log', 'w')
    rd, wr = os.pipe()
    xvfb = subprocess.Popen(['/usr/bin/Xvfb', '-displayfd', str(wr), '-screen', '0', '1600x1200x24', '-nolisten', 'tcp'],
                            pass_fds=(wr,), stdout=xvlog, stderr=xvlog, env=env)
    os.close(wr)
    with os.fdopen(rd) as f:
        env['DISPLAY'] = ':' + f.readline().strip()
    cmd = [str(node_path()), str(Path(__file__).with_suffix('.cjs')), '--root', str(BASE), '--runtime', VERSION]
    # Do not perturb an initial sandbox launch with ptrace. Trace Wine and the
    # explicitly permitted no-sandbox fallback, including child exec attempts.
    if mode != 'linux':
        cmd = ['/usr/bin/strace', '--seccomp-bpf', '-f', '-tt', '-s', '2048', '-e', 'trace=execve', '-o', str(runpath / 'execve.log')] + cmd
    write(runpath / 'driver-command.json', cmd)
    try:
        result = subprocess.run(cmd, env=env, cwd=str(runpath), timeout=325)
        return result.returncode
    finally:
        # Only this fresh Wine prefix is affected. Never touch AV/build processes.
        if mode == 'wine':
            subprocess.run(['/usr/bin/wineserver', '-k'], env=env, timeout=15, check=False)
        xvfb.terminate()
        xvfb.wait(timeout=10)
        xvlog.close()


def finalize():
    """Export ONLY text reports/logs and screenshots, never executables/profiles."""
    dest = Path(tempfile.mkdtemp(prefix=f'gui-verification-{ARGS.app_version}-electron{VERSION}-', dir=BASE / 'reports'))
    runs = []
    passing = []
    for runpath in sorted((BASE / 'logs').glob(f'gui-electron{VERSION}-*')):
        if not (runpath / 'completion.json').exists():
            continue
        target = dest / runpath.name
        target.mkdir()
        for p in runpath.iterdir():
            if p.is_file() and p.suffix in ('.json', '.txt', '.log'):
                shutil.copy2(p, target / p.name)
        if (runpath / 'screenshots').is_dir():
            shutil.copytree(runpath / 'screenshots', target / 'screenshots')
        report = json.loads((runpath / 'report.json').read_text()) if (runpath / 'report.json').exists() else {}
        record = {'directory': str(runpath), 'evidenceDirectory': str(target), 'mode': report.get('mode'),
                  'status': report.get('status', 'LAUNCH_FAILED_WITHOUT_REPORT'), 'error': report.get('error'),
                  'checks': len(report.get('checks', [])), 'completion': json.loads((runpath / 'completion.json').read_text())}
        runs.append(record)
        if report.get('status') == 'PASS':
            passing.append((runpath, report))
    assert passing, 'No completed GUI pass to finalize'
    runpath, report = passing[-1]
    trace = (runpath / 'execve.log').read_text() if (runpath / 'execve.log').exists() else ''
    assert trace, 'A complete execution trace is required for final no-actions audit'
    calls = [line for line in trace.splitlines() if 'execve(' in line or 'execve resumed' in line]
    executable_paths = sorted(set(re.findall(r'execve\("([^"]+)"', trace)))
    expected = {str(node_path()), str(STAGED / 'electron'), str(STAGED / 'chrome_crashpad_handler'), '/proc/self/exe'}
    for directory in (str(node_path().parent), '/usr/bin', '/bin'):
        expected.update((directory + '/reg', directory + '/tasklist'))
    unexpected = [p for p in executable_paths if p not in expected]
    failed_probes = [line for line in calls if re.search(r'/reg"|/tasklist"', line)]
    assert not unexpected, f'Unexpected executable: {unexpected}'
    assert all('ENOENT' in line for line in failed_probes), 'Unexpected live Windows detection command'
    audit = {'scope': 'Complete successful Linux GUI controller and descendants, kernel execve trace',
             'executablePaths': executable_paths, 'unexpectedExecutables': unexpected,
             'windowsDetectionProbesAllENOENT': True, 'calls': calls}
    write(dest / 'exec-audit.json', audit)
    warnings = []
    for pack in report['hub']['packs']:
        if pack['source'] == 'embedded' and pack['warnings']:
            warnings.append({'id': pack['id'], 'warnings': pack['warnings'],
                             'reportedMissing': [{'path': n, 'actuallyExists': (Path(pack['path']) / n).exists()} for n in pack['missingEntries']]})
    screenshot_manifest = {str(p.relative_to(dest)): {'sha256': digest(p), 'bytes': p.stat().st_size} for p in dest.rglob('*.png')}
    write(dest / 'screenshots-sha256.json', screenshot_manifest)
    shutil.copy2(RUNTIME / 'stage-report.json', dest / 'runtime-verification.json')
    shutil.copy2(RUNTIME / 'downloads/SHASUMS256.txt', dest / 'electron-official-SHASUMS256.txt')
    processes = subprocess.check_output(['ps', '-eo', 'pid,ppid,comm,args'], text=True)
    (dest / 'processes-after.txt').write_text(processes)
    remaining = [line for line in processes.splitlines() if (str(STAGED / 'electron') in line or ('wine' in line and str(BASE / 'logs/gui-') in line))]
    assert not remaining, 'GUI process still running'
    stage_report = json.loads((RUNTIME / 'stage-report.json').read_text())
    input_report = json.loads((BASE / 'reports' / f'gui-input-electron{VERSION}.json').read_text())
    shutil.copy2(BASE / 'reports' / f'gui-input-electron{VERSION}.json', dest / 'input-verification.json')
    assert all(x['completion'].get('originalResourcesUnchanged') and x['completion'].get('projectWindowsElectronDistUnchanged')
               and x['completion'].get('stagedPackagedResourcesUnchanged') and x['completion'].get('portableArtifactUnchanged') for x in runs)
    summary = {'result': 'PASS_LINUX_ASAR_GUI_ONLY', 'root': str(BASE), 'runtime': VERSION, 'successfulRun': str(runpath), 'runs': runs,
               'checksPassed': len(report['checks']), 'screenshotsSuccessfulRun': len(report['screenshots']),
               'quarantineRejected': len(report['quarantineIPC']), 'quarantineActionEvents': report['quarantineEvents'],
               'library': {k: v for k, v in report['library'].items() if k != 'prompts'},
               'electronInfo': report['electronInfo'], 'rendererErrors': report['rendererErrors'],
               'console': report['console'], 'failedRequests': report['failedRequests'],
               'uiWarnings': warnings, 'buttonStates': report.get('buttonStates'), 'nestedPathsFixed': report.get('nestedPathsFixed'),
               'packagedResourceDirectories': input_report['packResourceDirectories'],
               'portableArtifactSHA256': input_report['portableSHA256'], 'appAsarSHA256': input_report['asarSHA256'],
               'runtimeVerification': stage_report, 'execAuditUnexpected': unexpected, 'remainingGuiProcesses': remaining,
               'limitations': report['limitations'],
               'scriptSHA256': {p.name: digest(p) for p in Path(__file__).parent.glob('isolated-gui-smoke.*')}}
    write(dest / 'SUMMARY.json', summary)
    text = [f'# Actual packaged GUI evidence — {ARGS.app_version}, Electron {VERSION}', '',
            f'Result: {summary["result"]}', f'Successful run: `{runpath}`',
            f'Checks: {len(report["checks"])}; screenshots: {len(report["screenshots"])}; quarantine IPC rejections: {len(report["quarantineIPC"])}.',
            'Windows-native GUI, portable self-extraction and allowed-pack installation functionality: NOT VERIFIED.',
            'Wine attempts from superseded builds are not new-build evidence. This folder contains only this root/runtime.',
            f'Current-runtime Wine attempts: {sum(x["mode"] == "wine" for x in runs)}.',
            f'Runtime/app info: {json.dumps(report["electronInfo"], ensure_ascii=False)}',
            'Original packaged app.asar/resources used without source recompilation. Official Linux launcher is not a separately built Linux release.',
            'Fresh precreated homes; network namespace has only loopback and no external route; ELECTRON_RUN_AS_NODE absent.',
            'Nine quarantine calls are genuine preload/main IPC rejections, not mocks. No allowed pack operation, client, hook, injection or restore was executed.',
            'Buttons are checked for real enabled/disabled state but install/uninstall/monitor buttons are never clicked.',
            f'Five corrected nested paths: {json.dumps(report.get("nestedPathsFixed"), ensure_ascii=False)}',
            f'Embedded-source warnings: {json.dumps(warnings, ensure_ascii=False)}',
            f'Library entries: {report["library"]["total"]}; actual plaintext detail and positive/empty search tested.',
            f'Renderer errors: {len(report["rendererErrors"])}; console messages: {len(report["console"])}; failed requests: {len(report["failedRequests"])}.',
            'Main-process log includes expected ERR_PACK_QUARANTINED rejections; review launcher.log for headless/runtime diagnostics.',
            f'Original resources compared: {stage_report["resourceFilesCompared"]}. Resources, Windows Electron dist and portable EXE unchanged after every attempt.',
            'Empty precreated configuration directories may be reported as installed; this does not verify a downstream client.',
            '', '## Actual attempts',
            *[f'- {Path(x["directory"]).name}: {x["status"]}, exit={x["completion"]["exitCode"]}, error={x["error"]}' for x in runs],
            '', '## Official runtime', RELEASE + ZIP, 'SHA-256: ' + stage_report['sha256'],
            'app.asar SHA-256: ' + input_report['asarSHA256'],
            '', '## Commands',
            'command.json / driver-command.json / launch-env.json / network.json preserve exact run settings.',
            '```sh', shlex.join(['python3', str(Path(__file__).resolve()), '--root', str(BASE), '--runtime', VERSION, 'linux-no-sandbox']), '```',
            '', '## Limits', *['- ' + x for x in report['limitations']],
            '- No AV disabled or exclusions added. No archive modified or created. Not an AV verdict.', '']
    (dest / 'README.md').write_text('\n'.join(text), encoding='utf-8')
    print('EVIDENCE_DIR=' + str(dest))
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, help='Isolated build root containing project/, logs/, reports/')
    parser.add_argument('--runtime', required=True, help='Official Electron version, e.g. 44.4.3')
    parser.add_argument('--runtime-sha256', help='Independently obtained official Linux x64 ZIP SHA-256 (required for stage)')
    parser.add_argument('--artifact-sha256', help='Expected final portable EXE SHA-256 (read-only identity check)')
    parser.add_argument('--app-version', default='1.5.7')
    parser.add_argument('--node', help='Explicit trusted guest Node executable, otherwise discover under this root or /opt')
    parser.add_argument('mode', choices=['inspect', 'stage', 'wine', 'linux', 'linux-no-sandbox', 'finalize', 'review', '_network'])
    parser.add_argument('extra', nargs='*')
    ARGS = parser.parse_args()
    BASE = Path(ARGS.root).resolve()
    VERSION = ARGS.runtime
    assert re.fullmatch(r'\d+\.\d+\.\d+', VERSION), 'Invalid official version'
    assert sys.platform == 'linux' and BASE.is_dir() and BASE.is_relative_to('/home/builder') and os.uname().nodename == 'susu155-build', 'Ubuntu guest only'
    PROJECT = BASE / 'project'
    RUNTIME = BASE / 'gui-runtime' / f'electron-{VERSION}'
    STAGED = RUNTIME / 'linux-x64'
    WIN = PROJECT / 'release/win-unpacked'
    RELEASE = f'https://github.com/electron/electron/releases/download/v{VERSION}/'
    ZIP = f'electron-v{VERSION}-linux-x64.zip'
    SHA = ARGS.runtime_sha256
    if SHA:
        assert re.fullmatch(r'[0-9a-f]{64}', SHA)
    if ARGS.artifact_sha256:
        assert re.fullmatch(r'[0-9a-f]{64}', ARGS.artifact_sha256)
    mode = ARGS.mode
    if mode == 'inspect':
        inspect()
    elif mode == 'stage':
        stage()
    elif mode == 'finalize':
        finalize()
    elif mode == '_network':
        assert len(ARGS.extra) == 2 and ARGS.extra[0] in ('wine', 'linux', 'linux-no-sandbox')
        runpath = Path(ARGS.extra[1]).resolve()
        assert runpath.is_relative_to(BASE / 'logs')
        sys.exit(network(ARGS.extra[0], runpath))
    elif mode == 'review':
        runpath = Path(ARGS.extra[0]).resolve()
        assert runpath.is_relative_to(BASE / 'logs')
        for name in ('electron.log', 'main-trace.log', 'launcher.log', 'network.json'):
            p = runpath / name
            if p.exists():
                print('\n--- ' + name + ' ---\n' + p.read_text(errors='replace'), flush=True)
        p = runpath / 'execve.log'
        if p.exists():
            calls = [x for x in p.read_text(errors='replace').splitlines() if 'execve(' in x or ('execve resumed' in x and '= 0' in x)]
            write(runpath / 'exec-audit.json', {'calls': calls})
            print(json.dumps({'execCalls': calls}, ensure_ascii=False, indent=2))
    else:
        assert mode in ('wine', 'linux', 'linux-no-sandbox')
        sys.exit(run(mode))
