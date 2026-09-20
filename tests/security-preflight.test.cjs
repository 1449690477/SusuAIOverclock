'use strict';

// Parser/policy/scope checks; no samples executed and no file writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const scanner = require('../scripts/preflight-security.cjs');
const policy = require('../electron/security-policy.cjs');
const root = path.join(__dirname, '..');

test('build allowlist matches runtime policy and exact resource filters', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.version, '1.5.5');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(pkg.devDependencies.electron, '44.4.3');
  assert.equal(lock.packages[''].devDependencies.electron, '44.4.3');
  assert.equal(lock.packages['node_modules/electron'].version, '44.4.3');
  assert.deepEqual(scanner.RELEASE_PACK_IDS, policy.RELEASE_PACK_IDS);
  assert.deepEqual(scanner.QUARANTINED_PACK_IDS, Object.keys(policy.QUARANTINED_PACKS));
  assert.deepEqual(pkg.build.extraResources.find(r => r.from === 'packed-packs').filter, scanner.RELEASE_RESOURCE_FILTER);
  assert.ok(pkg.scripts['pack:portable'].startsWith('node scripts/preflight-security.cjs && '));
});

test('empty or non-PE input is not represented as antivirus-cleared', () => {
  for (const input of [Buffer.alloc(0), Buffer.from('ordinary text')]) {
    const result = scanner.scanBuffer(input);
    assert.equal(result.findings.length, 0);
    assert.equal(result.errors.length, 0);
    assert.deepEqual(result.sections, []);
  }
  assert.match(scanner.LIMITATION, /not an antivirus verdict/);
});

test('truncated and malformed PE headers produce inspection errors', () => {
  const short = scanner.scanBuffer(Buffer.from('MZ'));
  assert.equal(short.errors[0].code, 'PE_INSPECTION_ERROR');
  const outOfBounds = Buffer.alloc(64);
  outOfBounds.write('MZ');
  outOfBounds.writeUInt32LE(0xffffffff, 0x3c);
  assert.equal(scanner.scanBuffer(outOfBounds).errors[0].code, 'PE_INSPECTION_ERROR');
});

test('PE parser bounds-checks raw sections and preserves valid metadata', () => {
  const data = Buffer.alloc(512);
  data.write('MZ');
  data.writeUInt32LE(64, 0x3c);
  data.write('PE\0\0', 64);
  data.writeUInt16LE(1, 70);
  data.writeUInt16LE(2, 84);
  data.writeUInt16LE(0x10b, 88);
  data.write('.text', 90);
  data.writeUInt32LE(32, 98);
  data.writeUInt32LE(64, 106);
  data.writeUInt32LE(256, 110);
  assert.deepEqual(scanner.parsePESections(data), [{ name: '.text', rawOffset: 256, rawSize: 64, virtualSize: 32 }]);
  data.writeUInt32LE(510, 110);
  assert.equal(scanner.scanBuffer(data).errors[0].code, 'PE_INSPECTION_ERROR');
});

test('build hooks scan before writing dependencies or executing the builder', () => {
  for (const [name, operation] of [
    ['scripts/apply-portable-patch.cjs', 'disablePortableElevateHelper();'],
    ['scripts/pack-portable.cjs', 'spawnSync(process.execPath'],
    ['scripts/before-build.cjs', 'assertPortableBuilderPatched();'],
  ]) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    assert.ok(source.indexOf('assertBuildInputsSafe(') >= 0);
    assert.ok(source.indexOf(operation) > source.indexOf('assertBuildInputsSafe('), name);
    assert.doesNotMatch(source, /restore7za\(/);
  }
});

test('only default Windows-target builder caches carry fixed platform exclusions', () => {
  const env = {
    LOCALAPPDATA: path.join(root, 'scope-local-appdata'),
    ELECTRON_BUILDER_CACHE: path.join(root, 'scope-custom-cache'),
    SIGNTOOL_PATH: path.join(root, 'scope-custom-cache', 'winCodeSign', 'winCodeSign-2.6.0', 'darwin', 'selected.exe'),
  };
  const targets = scanner.getDefaultTargets(root, env);
  const caches = targets.filter(target => ['builder-cache', 'builder-cache-override'].includes(target.kind));
  assert.equal(caches.length, 2);
  assert.deepEqual(scanner.WINDOWS_CACHE_EXCLUDED_TREES.map(tree => tree.relativePath), [
    'winCodeSign/winCodeSign-2.6.0/darwin',
    'winCodeSign/winCodeSign-2.6.0/linux',
  ]);
  for (const target of targets) {
    if (['win32', 'linux'].includes(process.platform) && caches.includes(target)) {
      assert.deepEqual(target.excludedPlatformTrees, scanner.WINDOWS_CACHE_EXCLUDED_TREES);
    } else {
      assert.equal(target.excludedPlatformTrees, undefined, target.kind);
    }
  }
  assert.ok(targets.some(target => target.kind === 'SIGNTOOL_PATH' && target.path === env.SIGNTOOL_PATH));
});

test('clean cross-build uses beforePack and normal dependency collection, never old shim', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.build.beforePack, './scripts/before-build.cjs');
  assert.equal(pkg.build.beforeBuild, undefined);
  assert.equal(pkg.build.npmRebuild, false);
  const hook = fs.readFileSync(path.join(root, 'scripts/before-build.cjs'), 'utf8');
  assert.doesNotMatch(hook, /return false;|_nodeModulesHandledExternally\s*=/);
  const wrapper = fs.readFileSync(path.join(root, 'scripts/pack-portable.cjs'), 'utf8');
  assert.doesNotMatch(wrapper, /app-builder-shim|nsis-3\.0\.4\.1/);
  assert.match(wrapper, /'--publish', 'never'/);
  assert.match(wrapper, /delete env\[key\]/);
  const portablePatch = fs.readFileSync(path.join(root, 'scripts/apply-portable-patch.cjs'), 'utf8');
  assert.ok(portablePatch.includes('${VERSION}-electron44.4.3'));
  assert.ok(portablePatch.includes('template.split(oldCacheKey).length !== 2'));
});

test('Linux tools include Windows Electron and native Linux builders; links remain strict', () => {
  const targets = scanner.getDefaultTargets(root, {});
  if (process.platform === 'linux') {
    for (const suffix of ['electron/dist/electron.exe', 'app-builder-bin/linux/x64/app-builder', '7zip-bin/linux/x64/7za', '@esbuild/linux-x64/bin/esbuild']) {
      assert.ok(targets.some(t => t.kind === 'required-build-tool' && t.path === path.join(root, 'node_modules', suffix)), suffix);
      assert.equal(targets.find(t => t.kind === 'required-build-tool' && t.path === path.join(root, 'node_modules', suffix)).requiredFormat, suffix.endsWith('.exe') ? 'pe' : 'elf64-x64');
    }
  }
  assert.ok(targets.filter(t => t.kind === 'build-input').every(t => !t.excludedPlatformTrees));
  assert.match(scanner.CLEAN_BUILD_GUIDANCE, /new clean guest/);
});

test('cache exclusions are exact rooted trees, not global platform-name filters', () => {
  const cache = path.join(root, 'scope-cache');
  const target = { path: cache, excludedPlatformTrees: scanner.WINDOWS_CACHE_EXCLUDED_TREES };
  for (const tree of scanner.WINDOWS_CACHE_EXCLUDED_TREES) {
    assert.equal(scanner.getExcludedPlatformTree(path.join(cache, tree.relativePath), target), tree);
    assert.equal(scanner.getExcludedPlatformTree(path.join(cache, tree.relativePath, '10.12', 'lib', 'libcrypto.dylib'), target), tree);
    assert.equal(scanner.getExcludedPlatformTree(path.join(cache, tree.relativePath), { path: cache }), null);
  }
  for (const relative of [
    'winCodeSign/winCodeSign-2.6.0/appxAssets/helper.exe',
    'winCodeSign/winCodeSign-2.6.0/openssl-ia32/libssl.dll',
    'winCodeSign/winCodeSign-2.6.0/windows-10/x64/signtool.exe',
    'winCodeSign/winCodeSign-2.6.0/windows-6/signtool.exe',
    'winCodeSign/winCodeSign-2.6.0/rcedit-ia32.exe',
    'winCodeSign/winCodeSign-2.6.0/rcedit-x64.exe',
    'winCodeSign/winCodeSign-2.6.0/darwin-extra/tool.exe',
    'winCodeSign/winCodeSign-2.6.0/linux.exe',
    'winCodeSign/winCodeSign-9.9.9/darwin/libcrypto.dylib',
    'unknown-tool/darwin/tool.exe',
    'nsis/linux/tool.exe',
    '../outside/winCodeSign/winCodeSign-2.6.0/darwin/libcrypto.dylib',
  ]) {
    assert.equal(scanner.getExcludedPlatformTree(path.join(cache, relative), target), null, relative);
  }
});

test('scoped cache traversal reports exclusions but rejects consumed and explicit links', t => {
  // In-memory filesystem metadata exercises the actual visitor without writing
  // fixtures, opening binaries, or depending on symlink-creation privileges.
  const cache = path.join(root, 'scope-cache');
  const vendor = path.join(cache, 'winCodeSign', 'winCodeSign-2.6.0');
  const excludedLinks = [
    path.join(vendor, 'darwin', 'libcrypto.dylib'),
    path.join(vendor, 'linux', 'libssl.so'),
  ];
  const consumedLinks = [
    path.join(vendor, 'windows-10', 'signtool.exe'),
    path.join(vendor, 'openssl-ia32', 'libssl.dll'),
    path.join(vendor, 'rcedit-x64.exe'),
    path.join(cache, 'unknown-tool', 'darwin', 'unknown.exe'),
    path.join(cache, 'winCodeSign', 'winCodeSign-9.9.9', 'darwin', 'unknown.exe'),
  ];
  const links = new Set([...excludedLinks, ...consumedLinks]);
  const directories = new Map();
  for (const filename of links) {
    let child = filename;
    while (path.dirname(child) !== child) {
      const parent = path.dirname(child);
      if (!directories.has(parent)) directories.set(parent, new Set());
      directories.get(parent).add(path.basename(child));
      child = parent;
    }
  }
  t.mock.method(fs, 'lstatSync', filename => {
    const isLink = links.has(filename);
    assert.ok(isLink || directories.has(filename), `unexpected lstat: ${filename}`);
    return { dev: 1, ino: 1, size: 0, mtimeMs: 0, ctimeMs: 0,
      isSymbolicLink: () => isLink, isDirectory: () => !isLink, isFile: () => false };
  });
  const entered = [];
  t.mock.method(fs, 'readdirSync', filename => {
    entered.push(filename);
    assert.ok(directories.has(filename), `unexpected traversal: ${filename}`);
    return [...directories.get(filename)];
  });
  t.mock.method(fs.realpathSync, 'native', filename => {
    assert.equal(links.has(filename), false, 'links must be rejected, not resolved');
    return filename;
  });
  t.mock.method(fs, 'openSync', () => { assert.fail('no files should be opened in this metadata-only test'); });
  const target = { path: cache, kind: 'builder-cache', excludedPlatformTrees: scanner.WINDOWS_CACHE_EXCLUDED_TREES };
  const scoped = scanner.scanTargets([target]);
  assert.equal(scoped.ok, false); // Consumed/unknown-path links still block.
  assert.deepEqual(scoped.errors.map(error => error.path).sort(), [...consumedLinks].sort());
  assert.ok(scoped.errors.every(error => /Symlink\/junction\/reparse/.test(error.message)));
  const excludedRoots = scanner.WINDOWS_CACHE_EXCLUDED_TREES.map(tree => path.join(cache, tree.relativePath));
  assert.deepEqual(scoped.excluded.sort(), [...excludedRoots].sort());
  assert.equal(scoped.exclusionDetails.length, 2);
  assert.ok(excludedRoots.every(dir => !entered.includes(dir)));
  assert.match(scoped.limitation, /excluded trees are NOT inspected or cleared/);
  assert.match(scanner.formatReport(scoped), /EXCLUDED \(not inspected\)/);

  const explicit = scanner.scanPaths([cache]); // Same scope used by --scan.
  assert.equal(explicit.ok, false);
  assert.deepEqual(explicit.errors.map(error => error.path).sort(), [...links].sort());
  assert.deepEqual(explicit.excluded, []);
  assert.deepEqual(explicit.exclusionDetails, []);
  assert.equal(explicit.limitation, scanner.LIMITATION);
  // Strict overlap in one invocation must not be suppressed by `seen` either.
  const overlap = scanner.scanTargets([target, cache]);
  for (const filename of links) assert.ok(overlap.errors.some(error => error.path === filename), filename);

  // Once only the upstream, unconsumed platform links remain, the Windows
  // cache scope is IOC-negative; explicit evidence scanning still rejects them.
  for (const filename of consumedLinks) directories.get(path.dirname(filename)).delete(path.basename(filename));
  const upstreamOnly = scanner.scanTargets([target]);
  assert.equal(upstreamOnly.ok, true);
  assert.equal(upstreamOnly.status, 'known-ioc-not-detected');
  assert.equal(upstreamOnly.exclusionDetails.length, 2);
  const upstreamExplicit = scanner.scanPaths([cache]);
  assert.equal(upstreamExplicit.ok, false);
  assert.deepEqual(upstreamExplicit.errors.map(error => error.path).sort(), [...excludedLinks].sort());
});
