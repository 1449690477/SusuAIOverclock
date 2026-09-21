'use strict';
// Guest only. Dependencies here are loaded exclusively after fresh npm ci/SRI.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const scanner = require('./preflight-security.cjs');
const root = path.resolve(__dirname, '..');
// Evidence destination must follow the tree being verified. A hardcoded path made
// every later release write its reports into the previous release's evidence
// directory and then trip the fresh-destination guard in artifact().
const base = process.env.ISOLATED_BUILD_BASE || '/home/builder/susu155-final44';
const buildId = process.env.ISOLATED_BUILD_ID || 'susu155-electron44.4.3-final-20260920';
const reports = path.join(base, 'reports');
const pins = { electron: '44.4.3', 'electron-builder': '25.1.8', 'app-builder-bin': '5.0.0-alpha.10', '7zip-bin': '5.2.0', esbuild: '0.21.5' };
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function write(name, data) { fs.writeFileSync(path.join(reports, name), JSON.stringify(data, null, 2) + '\n'); }
function run(command, args) {
  console.log(JSON.stringify({ command, args }));
  const r = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.error) throw r.error;
  assert.equal(r.status, 0, command);
  return r.stdout;
}
function inventory(dir) {
  const result = {};
  function visit(relative) {
    const file = path.join(dir, relative);
    const stat = fs.lstatSync(file);
    assert.ok(!stat.isSymbolicLink(), file);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(relative, name));
    else { assert.ok(stat.isFile(), file); result[relative.split(path.sep).join('/')] = { size: stat.size, sha256: sha(file) }; }
  }
  visit('');
  return result;
}
// Metadata-only listing. Used for the filter-parity comparison, where hashing the
// whole 350 MB source tree a third time would only double the cost.
function listFiles(dir) {
  const result = [];
  (function visit(relative) {
    const file = path.join(dir, relative);
    const stat = fs.lstatSync(file);
    assert.ok(!stat.isSymbolicLink(), file);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(relative, name));
    else result.push(relative.split(path.sep).join('/'));
  })('');
  return result;
}
// Minimal stand-in for the extraResources filter globs, limited to the shapes
// this project actually uses. An unsupported shape throws instead of silently
// matching nothing, which is the failure mode that hid the v1.5.6 gap.
function filterMatcher(patterns) {
  const keep = [], drop = [];
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!');
    const body = negated ? pattern.slice(1) : pattern;
    const parts = body.split('/');
    for (const part of parts) {
      if (part === '**' || part.startsWith('*.')) continue;
      if (part.includes('*')) throw new Error(`Unsupported filter glob: ${pattern}`);
    }
    const test = (relative) => {
      const segments = relative.split('/');
      if (parts.length === 2 && parts[1] === '**') return relative === parts[0] || relative.startsWith(`${parts[0]}/`);
      if (parts.length === 3 && parts[0] === '**' && parts[2] === '**') return segments.includes(parts[1]);
      if (parts.length === 2 && parts[0] === '**') {
        return parts[1].startsWith('*.') ? segments[segments.length - 1].endsWith(parts[1].slice(1)) : segments.includes(parts[1]);
      }
      if (parts.includes('**')) throw new Error(`Unsupported filter glob: ${pattern}`);
      return relative === body;
    };
    (negated ? drop : keep).push(test);
  }
  return relative => keep.some(test => test(relative)) && !drop.some(test => test(relative));
}
function lock() {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
  assert.equal(data.version, '1.5.7');
  assert.equal(data.packages[''].devDependencies.electron, pins.electron);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).devDependencies.electron, pins.electron);
  for (const [name, version] of Object.entries(pins)) assert.equal(data.packages[`node_modules/${name}`].version, version, name);
  for (const [name, pkg] of Object.entries(data.packages)) {
    if (!name) continue;
    assert.match(pkg.resolved, /^https:\/\/registry\.npmjs\.org\//, name);
    assert.match(pkg.integrity, /^sha512-/, name);
    assert.ok(!pkg.link, name);
  }
  const result = { pins, lockSha256: sha(path.join(root, 'package-lock.json')), registry: 'https://registry.npmjs.org', packages: Object.keys(data.packages).length - 1 };
  write('lock-validation.json', result);
  console.log(JSON.stringify(result));
}
function tools() {
  lock();
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  assert.equal(process.version, 'v22.23.2');
  for (const [name, version] of Object.entries(pins)) assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'))).version, version, name);
  // v1.5.7 transfer gate. Debian's Info-ZIP UnZip 6.00 rewrites every bit-11
  // (UTF-8) entry name into the OEM/CP437 glyph set under the guest's C.UTF-8
  // locale. The source archive has 566 non-ASCII entries, so `unzip` garbled 454
  // shipped paths -- packed-packs/cursor/一键安装.bat arrived as
  // packed-packs/cursor/ф╕АщФохоЙшгЕ.bat and the pack's own launcher became
  // unfindable. scripts/isolated-build-unpack.py does the extraction instead.
  // The target of this comparison is SOURCE-MANIFEST.json, written by the HOST
  // export from the host filesystem, so no guest step can make a mangled transfer
  // look self-consistent. It is also the only byte-level check of the transfer:
  // the filter-parity assertion below only compares the guest tree with itself.
  {
    const file = path.join(root, 'SOURCE-MANIFEST.json');
    assert.ok(fs.existsSync(file), 'SOURCE-MANIFEST.json 缺失，无法证明传输完整性');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(manifest.schemaVersion, 2);
    assert.deepEqual(manifest.packs.slice().sort(), [...scanner.DISTRIBUTED_PACK_IDS].sort());
    assert.deepEqual(manifest.restoredFromQuarantine, [], '已移除的隔离区恢复机制不得复活');
    const declared = new Map(manifest.files.map(entry => [entry.path, entry]));
    assert.equal(declared.size, manifest.files.length, '清单路径必须唯一');
    assert.ok(declared.size > 5000, `清单过小: ${declared.size}`);
    const nonAscii = [...declared.keys()].filter(name => /[^\x00-\x7f]/.test(name));
    assert.ok(nonAscii.length >= 500, `非 ASCII 清单路径过少: ${nonAscii.length}`);
    for (const name of nonAscii) {
      const target = path.join(root, name);
      assert.ok(fs.existsSync(target), `传输把文件名改坏了: ${name}`);
      const item = declared.get(name);
      assert.equal(fs.statSync(target).size, item.size, name);
      assert.equal(sha(target), item.sha256, name);
    }
    const packDeclared = [...declared.keys()].filter(name => name.startsWith('packed-packs/'));
    const packActual = listFiles(path.join(root, 'packed-packs')).map(name => `packed-packs/${name}`);
    assert.deepEqual(packDeclared.slice().sort(), packActual.slice().sort(),
      'packed-packs 的主机清单与客体解包树必须逐名一致');
    for (const name of ['packed-packs/cursor/一键安装.bat', 'packed-packs/cursor/一键卸载.bat',
      'packed-packs/cursor/使用说明.txt', 'packed-packs/cursor/实测方法.txt']) {
      assert.ok(fs.existsSync(path.join(root, name)), `中文入口名丢失: ${name}`);
    }
    write('source-transfer-integrity.json', {
      buildId, manifestSha256: sha(file), manifestEntries: declared.size, nonAsciiEntries: nonAscii.length,
      packEntries: packDeclared.length, unpackerSha256: sha(path.join(root, 'scripts/isolated-build-unpack.py')),
      nonAsciiSample: nonAscii.slice(0, 5),
      extractionTool: 'scripts/isolated-build-unpack.py (python3 zipfile, honours the UTF-8 entry flag)',
      supersededTool: 'Ubuntu Info-ZIP UnZip 6.00 - garbled 454 of 566 non-ASCII names',
    });
  }
  const records = [];
  for (const [relative, magic] of [
    ['electron/dist/electron.exe', '4d5a'],
    ['app-builder-bin/linux/x64/app-builder', '7f454c46'],
    ['7zip-bin/linux/x64/7za', '7f454c46'],
    ['@esbuild/linux-x64/bin/esbuild', '7f454c46'],
  ]) {
    const filename = path.join(root, 'node_modules', relative);
    scanner.assertNoLinks(filename);
    const bytes = fs.readFileSync(filename);
    assert.equal(bytes.subarray(0, magic.length / 2).toString('hex'), magic, relative);
    records.push({ relative, sha256: sha(filename), size: bytes.length, magic });
  }
  assert.equal(fs.readFileSync(path.join(root, 'node_modules/electron/path.txt'), 'utf8'), 'electron.exe');
  assert.equal(sha(path.join(root, 'node_modules/electron/dist/electron.exe')), 'bf0fe749904ca9f713ccfb2427c519fa39d0bbd0337ba411ba08785802e8d548');
  run(path.join(root, 'node_modules/@esbuild/linux-x64/bin/esbuild'), ['--version']);
  write('toolchain.json', { buildId, node: process.version, pins, records, nodeArchiveSha256: 'd60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307', electronArchiveSha256: '790a355b684d5c7cc8dc3cdd8c4cca7c4b2d054685427c7554a956879a82e70b' });
}
function artifact() {
  const exe = path.join(root, 'release/SusuAIOverclock-1.5.7-portable.exe');
  const launcherTemplate = fs.readFileSync(path.join(root, 'node_modules/app-builder-lib/templates/nsis/portable.nsi'), 'utf8');
  assert.ok(launcherTemplate.includes('${VERSION}-electron44.4.3'), 'Runtime-specific launcher cache identity missing');
  write('launcher-cache-identity.json', { buildId, applicationVersion: '1.5.7', cacheKey: '1.5.7-electron44.4.3', templateSha256: sha(path.join(root, 'node_modules/app-builder-lib/templates/nsis/portable.nsi')), reason: 'Never silently reuse superseded Electron33 same-version cache' });
  const verification = path.join(base, 'verification');
  assert.ok(!fs.existsSync(verification), 'Refusing stale verification destination');
  fs.mkdirSync(verification);
  const outer = path.join(verification, 'portable-unfolded');
  const nested = path.join(verification, 'nested-app');
  run('/usr/bin/7z', ['x', '-y', `-o${outer}`, exe]);
  const outerFiles = inventory(outer);
  const archives = Object.keys(outerFiles).filter(name => /app-64\.(7z|zip)$/.test(name));
  assert.equal(archives.length, 1, JSON.stringify(Object.keys(outerFiles)));
  run('/usr/bin/7z', ['x', '-y', `-o${nested}`, path.join(outer, archives[0])]);
  const nestedFiles = inventory(nested);
  const originalFiles = inventory(path.join(root, 'release/win-unpacked'));
  assert.deepEqual(nestedFiles, originalFiles, 'Actual embedded archive differs from win-unpacked');
  write('embedded-file-inventory.json', nestedFiles);
  const packs = path.join(nested, 'resources/packs');
  const dirs = fs.readdirSync(packs).filter(name => fs.lstatSync(path.join(packs, name)).isDirectory()).sort();
  // The quarantined three ship too: a registered consent must have a payload to
  // install. Their presence in the artifact is not a deploy permission — the
  // shared policy still blocks them until consent is registered.
  assert.deepEqual(dirs, [...scanner.DISTRIBUTED_PACK_IDS].sort());
  assert.ok(fs.existsSync(path.join(packs, 'NOTICE.txt')));
  // End-to-end proof of the v1.5.7 fix. In v1.5.6 the consent checkbox flipped
  // the policy gate but the artifact carried no payload, so resolvePackDir()
  // returned source:'none' and the install button stayed disabled for ever.
  // These five binaries are the ones the 1.5.5 hygiene sweep removed; each is
  // now injected into the source archive from its hash-verified quarantine blob
  // and must be present in the shipped executable.
  const quarantinedPayload = [
    'anti-gravity/materials/proxy/bin/antigravity-oauth-proxy.exe',
    'codex/materials/slo-runtime/eni-solo/sha256-r2-mixed-pinned-2b50f93a8d7716b5/slo-runtime-hook.exe',
    'codex-panghu/keysmith/python/python.exe',
    'codex-panghu/keysmith/python/Lib/venv/scripts/nt/python.exe',
    'codex-panghu/keysmith/python/Lib/venv/scripts/nt/pythonw.exe',
  ];
  const payloadRecords = [];
  for (const relative of quarantinedPayload) {
    const key = `resources/packs/${relative}`;
    const record = nestedFiles[key];
    assert.ok(record && record.size > 0, `quarantined payload missing from the artifact: ${key}`);
    const magic = fs.readFileSync(path.join(nested, 'resources/packs', ...relative.split('/'))).subarray(0, 2).toString('ascii');
    assert.equal(magic, 'MZ', key);
    payloadRecords.push({ path: key, ...record, magic });
  }
  for (const id of ['codex', 'codex-panghu', 'anti-gravity']) {
    const prefix = `resources/packs/${id}/`;
    assert.ok(Object.keys(nestedFiles).some(name => name.startsWith(prefix)), `quarantined tree empty in the artifact: ${id}`);
  }
  // The artifact's resources/packs must equal exactly what package.json's
  // extraResources filter selects from the source tree. v1.5.6 shipped an
  // artifact that silently lacked packed-packs/opencode/node_modules and
  // packed-packs/codex-panghu/keysmith/release, because the source exporter
  // dropped them by basename while the filter kept them.
  const packFilter = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    .build.extraResources.find(item => item.from === 'packed-packs');
  assert.equal(packFilter.to, 'packs');
  const selected = listFiles(path.join(root, 'packed-packs'))
    .filter(filterMatcher(packFilter.filter))
    .sort();
  const shipped = Object.keys(nestedFiles)
    .filter(name => name.startsWith('resources/packs/'))
    .map(name => name.slice('resources/packs/'.length))
    .sort();
  assert.deepEqual(shipped, selected, 'artifact resources/packs must equal the filter-selected source tree');
  write('pack-filter-parity.json', { files: selected.length, filter: packFilter.filter, selected });
  assert.ok(selected.length > 0);
  const printDeps = [];
  for (const name of Object.keys(nestedFiles)) {
    assert.ok(!/(^|\/)elevate\.exe$/i.test(name), name);
    if (/(^|\/)PrintDeps\.exe$/i.test(name)) {
      // Playwright's real production dependency diagnostic, freshly acquired
      // with npm SRI; never restore the infected host copy or use its size.
      const upstream = path.join(root, 'node_modules/playwright-core/bin/PrintDeps.exe');
      assert.equal(nestedFiles[name].sha256, sha(upstream), name);
      printDeps.push({ path: name, ...nestedFiles[name], origin: 'fresh npm ci, lockfile SRI-verified playwright-core' });
    }
  }
  const asar = require('@electron/asar');
  const appAsar = path.join(nested, 'resources/app.asar');
  const unpacked = path.join(verification, 'asar-extracted');
  asar.extractAll(appAsar, unpacked);
  const pkg = JSON.parse(fs.readFileSync(path.join(unpacked, 'package.json')));
  assert.equal(pkg.version, '1.5.7');
  const req = createRequire(path.join(unpacked, 'package.json'));
  const dependencies = {};
  for (const dependency of Object.keys(pkg.dependencies)) dependencies[dependency] = req.resolve(dependency);
  const asarFiles = inventory(unpacked);
  for (const name of Object.keys(asarFiles)) {
    assert.ok(!/(^|\/)elevate\.exe$/i.test(name), name);
    if (/(^|\/)PrintDeps\.exe$/i.test(name)) assert.equal(asarFiles[name].sha256, sha(path.join(root, 'node_modules/playwright-core/bin/PrintDeps.exe')), name);
  }
  write('asar-file-inventory.json', asarFiles);
  const report = scanner.scanPaths([exe, outer, nested, unpacked]);
  write('artifact-known-ioc.json', report);
  console.log(scanner.formatReport(report));
  assert.equal(report.ok, true);
  const pkgRoot = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const pe = run('/usr/bin/python3', [path.join(__dirname, 'isolated-build-pe.py'), exe, path.join(nested, `${pkgRoot.build.productName}.exe`)]);
  fs.writeFileSync(path.join(reports, 'pe-versions.jsonl'), pe);
  run('/usr/bin/python3', [path.join(__dirname, 'isolated-build-runtime-proof.py'), nested]);
  const result = { buildId, electronVersion: pins.electron, guiVerification: 'pending-for-this-build; previous Electron33 GUI results are not applied', artifact: exe, sha256: sha(exe), size: fs.statSync(exe).size, embeddedPackageVersion: pkg.version, packs: dirs, quarantinedPayload: payloadRecords, dependencies, printDeps, embeddedArchiveMatchesWinUnpacked: true, scannedBinaries: report.filesScanned, knownIocFindings: report.findings.length, inspectionErrors: report.errors.length, windowsGuiTested: false, limitation: scanner.LIMITATION };
  write('artifact-result.json', result);
  console.log(JSON.stringify(result, null, 2));
}
fs.mkdirSync(reports, { recursive: true });
const mode = process.argv[2];
if (mode === 'lock') lock();
else if (mode === 'tools') tools();
else if (mode === 'artifact') artifact();
else throw new Error('Expected lock, tools or artifact');
