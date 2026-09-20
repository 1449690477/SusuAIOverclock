'use strict';

// Focused, builtin-only tests. Never require core/main/preload, dependencies or
// payloads, start processes, or write user/project files. Opt-in real-tree tests
// below only enumerate filesystem metadata; they never load payload contents.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const policy = require('../electron/security-policy.cjs');
const { missingExpectedEntries } = require('../electron/pack-source-policy.cjs');

test('expected entries resolve nested paths without false missing warnings', () => {
  const root = path.join(__dirname, '..');
  assert.deepEqual(missingExpectedEntries(root, ['electron/core.cjs', 'electron/security-*.cjs', 'src/components/PackCard.tsx']), []);
  assert.deepEqual(missingExpectedEntries(root, ['../package.json', 'electron/not-a-real-entry']), ['../package.json', 'electron/not-a-real-entry']);
});
const { assertPackSourceAllowed } = require('../electron/pack-source-policy.cjs');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8').replace(/\r\n/g, '\n');
const main = read('electron/main.cjs');
const core = read('electron/core.cjs');
const sourcePolicy = read('electron/pack-source-policy.cjs');

function ipcBody(name) {
  const start = main.indexOf(`ipcMain.handle('dango:${name}'`);
  assert.notEqual(start, -1, `IPC ${name} must exist`);
  const end = main.indexOf('ipcMain.handle(', start + 1);
  return main.slice(start, end < 0 ? main.length : end);
}

function between(text, startText, endText) {
  const start = text.indexOf(startText);
  const end = text.indexOf(endText, start + startText.length);
  assert.ok(start >= 0 && end > start, `source section ${startText}`);
  return text.slice(start, end);
}

function before(text, first, second) {
  assert.ok(text.indexOf(first) >= 0, `missing ${first}`);
  assert.ok(text.indexOf(second) > text.indexOf(first), `${first} must precede ${second}`);
}

test('release allowlist and quarantine exports are immutable and disjoint', () => {
  assert.deepEqual(policy.RELEASE_PACK_IDS, ['cursor', 'dsh', 'opencode', 'workbuddy', 'workbuddy-ai']);
  assert.deepEqual(Object.keys(policy.QUARANTINED_PACKS), ['codex', 'codex-panghu', 'anti-gravity']);
  for (const value of [policy, policy.RELEASE_PACK_IDS, policy.QUARANTINED_PACKS]) assert.ok(Object.isFrozen(value));
  assert.throws(() => policy.RELEASE_PACK_IDS.push('codex'), TypeError);
  assert.throws(() => { policy.QUARANTINED_PACKS.codex = ''; }, TypeError);
  assert.throws(() => { policy.assertPackAllowed = () => {}; }, TypeError);
  for (const id of policy.RELEASE_PACK_IDS) {
    assert.equal(policy.getPackBlockReason(id), null);
    assert.doesNotThrow(() => policy.assertPackAllowed(id));
  }
});

test('quarantines explain concrete affected files and untrusted restore sources', () => {
  const indicators = { codex: 'slo-runtime-hook.exe', 'codex-panghu': 'python.exe', 'anti-gravity': 'antigravity-oauth-proxy.exe' };
  for (const [id, indicator] of Object.entries(indicators)) {
    const reason = policy.getPackBlockReason(id);
    assert.ok(reason.includes(indicator));
    assert.ok(reason.includes('restore-source-not-trusted'));
    assert.ok(reason.includes('隔离不代表用户目录已清理'));
    assert.throws(() => policy.assertPackAllowed(id), { code: 'ERR_PACK_QUARANTINED', message: reason });
  }
  for (const id of [undefined, null, {}, '', 'Codex', 'codex ', '../cursor', 'constructor', '__proto__', 'future-pack']) {
    assert.ok(policy.getPackBlockReason(id));
    assert.throws(() => policy.assertPackAllowed(id));
  }
});

test('old plans cannot re-enable quarantined or unknown IDs', () => {
  const oldPlan = { install: { file: 'install.ps1' }, uninstall: { file: 'Uninstall.ps1' } };
  for (const id of [...Object.keys(policy.QUARANTINED_PACKS), 'unknown']) {
    const plan = policy.getDeployPlanInfo(id, oldPlan);
    assert.deepEqual(plan, {
      blockedReason: policy.getPackBlockReason(id), hasInstall: false, hasUninstall: false, installFile: null, uninstallFile: null
    });
    assert.ok(Object.isFrozen(plan));
  }
  for (const id of policy.RELEASE_PACK_IDS) {
    assert.deepEqual(policy.getDeployPlanInfo(id, oldPlan), {
      blockedReason: null, hasInstall: true, hasUninstall: true, installFile: 'install.ps1', uninstallFile: 'Uninstall.ps1'
    });
  }
  assert.equal(policy.getDeployPlanInfo('opencode', { install: oldPlan.install, uninstall: null }).hasUninstall, false);
  const unreadable = new Proxy({}, { get() { throw new Error('must not inspect a quarantined plan'); } });
  assert.equal(policy.getDeployPlanInfo('codex', unreadable).hasInstall, false);
});

test('restore binds a backup to its allowed pack, not just its timestamp shape', () => {
  for (const id of policy.RELEASE_PACK_IDS) assert.doesNotThrow(() => policy.assertBackupAllowed(id, `${id}-20260920-123456`));
  for (const id of Object.keys(policy.QUARANTINED_PACKS)) {
    assert.throws(() => policy.assertBackupAllowed(id, `${id}-20260920-123456`));
    assert.throws(() => policy.assertBackupAllowed('cursor', `${id}-20260920-123456`));
  }
  for (const name of ['dsh-20260920-123456', '../cursor-20260920-123456', 'cursor-20260920-123456/extra', '', undefined]) {
    assert.throws(() => policy.assertBackupAllowed('cursor', name));
  }
});

test('known source names are blocked even if registered under an allowed ID', () => {
  for (const name of [
    'C:\\old\\CODEX\\install.ps1', 'C:\\old\\codex-panghu\\python.exe',
    '/old/anti-gravity/Uninstall.ps1', '/renamed/materials/slo-runtime-hook.exe',
    '/renamed/keysmith/runtime/python.exe', '/renamed/codex-instruct-v0.5.0.py',
    '/renamed/keysmith_windows_compat.py', '/renamed/keysmith/prompts/gpt-unrestricted.md',
    '/renamed/materials/proxy/bin/antigravity-oauth-proxy.exe',
    '/renamed/install-replica.ps1', '/renamed/Install-AntiGravity.ps1',
    'C:\\old\\Codex. \\install.ps1'
  ]) assert.ok(policy.getSourceNameBlockReason(name), name);
  for (const id of policy.RELEASE_PACK_IDS) assert.equal(policy.getSourceNameBlockReason(`/release/${id}/install.ps1`), null);
});

test('generic text/script names alone do not identify the quarantined panghu pack', () => {
  for (const name of [
    '/unrelated/gpt-unrestricted.md', '/unrelated/GPT-UNRESTRICTED.MD',
    '/unrelated/codex-instruct.py', '/unrelated/codex-instruct-notes.py',
    '/release/workbuddy/materials/skills/zzy-codex5.6/zzy-Codex-5.6/codex-instruct.py'
  ]) assert.equal(policy.getSourceNameBlockReason(name), null, name);
});

test('ambiguous parent traversal is rejected before normalization or filesystem access', () => {
  assert.throws(() => assertPackSourceAllowed('cursor', 'nonexistent/link/../cursor'), { code: 'ERR_PACK_SOURCE_PARENT' });
  assert.throws(() => assertPackSourceAllowed('cursor', 'nonexistent\\link\\..\\cursor'), { code: 'ERR_PACK_SOURCE_PARENT' });
});

test('IPC mutation/execution routes guard IDs before reading state or doing work', () => {
  for (const name of ['deploy', 'backup', 'restore', 'verifyDeep', 'importPackDir', 'importSingleFile', 'openPack', 'captureBaseline', 'verify']) {
    const body = ipcBody(name);
    const id = name.startsWith('import') ? 'platformId' : 'id';
    assert.match(body, new RegExp(`guard\\(${id}\\);\\s*(?://[^\\n]*\\n\\s*)?assertPackAllowed\\(${id}\\);`));
  }
  before(ipcBody('deploy'), 'assertPackAllowed(id)', "action !== 'install'");
  before(ipcBody('deploy'), 'core.buildSpawn(script, packPath, id)', 'child = spawn(');
  before(ipcBody('restore'), 'assertBackupAllowed(id, name)', 'path.join(BACKUP_DIR');
  before(ipcBody('restore'), 'assertPackSourceAllowed(id, src)', 'fsp.cp(');
  before(ipcBody('backup'), 'assertPackSourceAllowed(id, d)', 'fsp.cp(');
  before(ipcBody('importPackDir'), 'assertPackSourceAllowed(platformId, dir)', 'state.imported[platformId] =');
  before(ipcBody('importSingleFile'), 'assertPackSourceAllowed(platformId, file)', 'fs.readFileSync(');
  assert.match(ipcBody('detect'), /plans\[id\] = getDeployPlanInfo\(id, plan\)/);
  before(ipcBody('openRoot'), 'fs.statSync(state.root).isDirectory()', 'shell.openPath(state.root)');
});

test('historical imported/external/embedded sources pass through quarantine resolution', () => {
  const resolver = between(main, 'function resolvePackDir(', 'async function readBaseline(');
  before(resolver, 'getPackBlockReason(def.id)', 'state.imported');
  assert.match(resolver, /if \(blockedReason\) return \{ dir: null, source: 'quarantined', blockedReason \}/);
  assert.match(resolver, /assertPackSourceAllowed\(def.id, dir\)/);
  for (const source of ['imported', 'external', 'embedded']) assert.match(resolver, new RegExp(`return checked\\([^\\n]+, '${source}'\\)`));
  before(sourcePolicy, 'assertPackAllowed(id)', 'fs.realpathSync(absolute)');
  before(sourcePolicy, 'assertNoLinkAncestors(absolute);', 'fs.realpathSync(absolute)');
  assert.match(sourcePolicy, /for \(const name of ancestors.reverse\(\)\)/);
  assert.match(sourcePolicy, /fs\.lstatSync\(name\)\.isSymbolicLink\(\)/);
  assert.match(sourcePolicy, /fs\.lstatSync\(name\)/);
  assert.match(sourcePolicy, /stat\.isSymbolicLink\(\).*throw sourceError\('ERR_PACK_SOURCE_LINK'/);
  assert.match(sourcePolicy, /getSourceNameBlockReason\(path\.basename\(name\)\)/);
  assert.doesNotMatch(sourcePolicy, /child_process|execFile|spawn\(/);
});

test('plans, source analysis and all deep-execution helpers fail closed', () => {
  const plans = between(core, 'const DEPLOY_PLANS =', 'function detectPlatform(');
  for (const id of Object.keys(policy.QUARANTINED_PACKS)) {
    const key = id === 'codex' ? 'codex' : `'${id}'`;
    assert.match(plans, new RegExp(`${key}: \\{\\s*install: null,\\s*uninstall: null,\\s*backupDirs: \\[\\]`));
  }
  assert.match(core, /function buildSpawn\(script, packPath, id\) \{\s*assertPackAllowed\(id\)/);
  assert.match(core, /function probeRuntime\(id\) \{\s*assertPackAllowed\(id\)/);
  const analysis = between(core, 'function analyzeImportedDir(', 'const RULE_FILE_TARGETS =');
  before(analysis, 'assertPackSourceAllowed(platformId, dir)', 'findScript(dir');
  assert.match(analysis, /blockedReason: e.message/);
  for (const signature of ['function spawnOnce(id, cmd, args, opts = {})', 'async function guiSessionProbe(id)', 'async function runDeepVerify(id)']) {
    assert.ok(main.includes(`${signature} {\n  assertPackAllowed(id);`));
  }
  const cliLookup = between(core, 'function findCodexCliInfo()', 'function findCodexCli()');
  assert.doesNotMatch(cliLookup, /execFileSync\(|spawn\(/);
  assert.match(core, /return RELEASE_PACK_IDS\.every\(/);
});

test('platform viewing and independent Codex text library are not pack deployment', () => {
  for (const name of ['detect', 'getIcon', 'verifyBreak', 'listBackups', 'clearImport', 'libraryImport', 'libraryImportBatch', 'libraryRemove']) {
    assert.doesNotMatch(ipcBody(name), /assertPackAllowed\(/, `${name} remains a separate management route`);
  }
  const targets = between(core, 'const RULE_FILE_TARGETS =', 'function buildImportBlock(');
  assert.match(targets, /codex: \{\s*mode: 'append',\s*file: \(\) => path\.join\(codexHome\(\), 'AGENTS.md'\)/);
});

test('UI displays quarantine reasons and excludes blocked packs from batch actions', () => {
  const app = read('src/App.tsx');
  assert.match(app, /const targets = packs\.filter\(\(p\) => !p\.blockedReason && !plans\[p\.id\]\?\.blockedReason/);
  for (const file of ['PackCard.tsx', 'PackDetailModal.tsx']) {
    const text = read(`src/components/${file}`);
    assert.match(text, /const blockedReason = pack\.blockedReason \|\| plan\?\.blockedReason/);
    assert.match(text, /disabled=\{busy \|\| Boolean\(blockedReason\)/);
    assert.match(text, /已隔离/);
  }
  const imports = read('src/components/ImportModal.tsx');
  assert.match(imports, /const canConfirm = Boolean\(picked\) && !selectedBlock/);
  assert.match(imports, /disabled=\{busy \|\| Boolean\(p\.blockedReason \|\| p\.analysis\?\.blockedReason \|\| blockOf\(p\.platform\)\)\}/);
});

// Explicit opt-in: checks the actual packed trees, not installed user profiles.
// No fixtures are created, no payload imports/eval/spawn, no dependencies.
const realTreeOptions = { skip: process.env.DANGO_TEST_REAL_PACKS !== '1' && 'set DANGO_TEST_REAL_PACKS=1 for read-only real-tree checks' };
test('real filesystem: all five release trees pass the source guard', realTreeOptions, async (t) => {
  for (const id of policy.RELEASE_PACK_IDS) {
    await t.test(id, (sub) => {
      const root = path.join(__dirname, '..', 'packed-packs', id);
      const pending = [root];
      const matches = [];
      const executableNames = [];
      let entries = 0;
      while (pending.length) {
        const full = pending.pop();
        assert.ok(++entries <= 100000, 'bounded metadata-only walk');
        const reason = policy.getSourceNameBlockReason(path.basename(full));
        if (reason) matches.push({ path: path.relative(root, full), reason });
        const stat = fs.lstatSync(full);
        assert.equal(stat.isSymbolicLink(), false, `link: ${full}`);
        if (stat.isFile() && /\.(exe|dll|pyd)$/i.test(full)) executableNames.push(path.relative(root, full));
        if (stat.isDirectory()) {
          for (const name of fs.readdirSync(full)) pending.push(path.join(full, name));
        }
      }
      sub.diagnostic(`${id}: inspected ${entries} filesystem entries (names/metadata only)`);
      if (id === 'workbuddy') sub.diagnostic(`workbuddy .exe/.dll/.pyd filenames (not a content scan): ${JSON.stringify(executableNames)}`);
      assert.deepEqual(matches, [], `exact named-source matches in ${root}`);
      assert.doesNotThrow(() => assertPackSourceAllowed(id, root));
    });
  }
});

test('real filesystem: legacy panghu source remains blocked under an allowed ID', realTreeOptions, (t) => {
  const source = path.join(__dirname, '..', 'packed-packs', 'codex-panghu', 'keysmith', 'release', 'codex-instruct-v0.5.0.py');
  // An agent may have removed legacy resources from the release staging tree.
  if (!fs.existsSync(source)) { t.skip('legacy release file absent from this staging tree'); return; }
  assert.throws(() => assertPackSourceAllowed('workbuddy', source), (error) => {
    assert.equal(error.code, 'ERR_PACK_SOURCE_QUARANTINED');
    assert.equal(error.path, path.resolve(source));
    assert.ok(error.message.includes('Codex 胖虎'));
    return true;
  });
});

test('real filesystem: an existing ancestor junction is rejected before following it', realTreeOptions, (t) => {
  if (process.platform !== 'win32') { t.skip('Windows legacy profile junction check'); return; }
  const junction = path.join(path.parse(path.resolve(__dirname)).root, 'Documents and Settings');
  let stat;
  try { stat = fs.lstatSync(junction); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    t.skip('legacy profile junction is absent');
    return;
  }
  if (!stat.isSymbolicLink()) { t.skip('legacy path is not a Node-reported junction'); return; }
  // This child is never read: rejection must occur at the existing ancestor.
  const source = path.join(junction, '__dango_guard_must_not_traverse__');
  assert.throws(() => assertPackSourceAllowed('cursor', source), (error) => {
    assert.equal(error.code, 'ERR_PACK_SOURCE_LINK');
    assert.equal(error.path, junction);
    return true;
  });
  t.diagnostic(`rejected ancestor without following it: ${junction}`);
});
