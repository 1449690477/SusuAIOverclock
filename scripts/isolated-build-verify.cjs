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
function lock() {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
  assert.equal(data.version, '1.5.6');
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
  const exe = path.join(root, 'release/SusuAIOverclock-1.5.6-portable.exe');
  const launcherTemplate = fs.readFileSync(path.join(root, 'node_modules/app-builder-lib/templates/nsis/portable.nsi'), 'utf8');
  assert.ok(launcherTemplate.includes('${VERSION}-electron44.4.3'), 'Runtime-specific launcher cache identity missing');
  write('launcher-cache-identity.json', { buildId, applicationVersion: '1.5.6', cacheKey: '1.5.6-electron44.4.3', templateSha256: sha(path.join(root, 'node_modules/app-builder-lib/templates/nsis/portable.nsi')), reason: 'Never silently reuse superseded Electron33 same-version cache' });
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
  assert.deepEqual(dirs, [...scanner.RELEASE_PACK_IDS].sort());
  assert.ok(fs.existsSync(path.join(packs, 'NOTICE.txt')));
  const printDeps = [];
  for (const name of Object.keys(nestedFiles)) {
    assert.ok(!name.split('/').some(p => scanner.QUARANTINED_PACK_IDS.includes(p)), name);
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
  assert.equal(pkg.version, '1.5.6');
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
  const result = { buildId, electronVersion: pins.electron, guiVerification: 'pending-for-this-build; previous Electron33 GUI results are not applied', artifact: exe, sha256: sha(exe), size: fs.statSync(exe).size, embeddedPackageVersion: pkg.version, packs: dirs, dependencies, printDeps, embeddedArchiveMatchesWinUnpacked: true, scannedBinaries: report.filesScanned, knownIocFindings: report.findings.length, inspectionErrors: report.errors.length, windowsGuiTested: false, limitation: scanner.LIMITATION };
  write('artifact-result.json', result);
  console.log(JSON.stringify(result, null, 2));
}
fs.mkdirSync(reports, { recursive: true });
const mode = process.argv[2];
if (mode === 'lock') lock();
else if (mode === 'tools') tools();
else if (mode === 'artifact') artifact();
else throw new Error('Expected lock, tools or artifact');
