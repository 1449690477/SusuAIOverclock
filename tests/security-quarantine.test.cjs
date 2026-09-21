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
  assert.deepEqual(policy.RELEASE_PACK_IDS, ['cursor', 'dsh', 'claude', 'opencode', 'workbuddy', 'workbuddy-ai']);
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

test('quarantine consent is opt-in, reversible and rejects non-quarantined ids', () => {
  // Empty register reproduces the v1.5.5 hard-quarantine behaviour exactly.
  assert.deepEqual(policy.grantedQuarantineIds(), []);
  assert.ok(Object.isFrozen(policy.grantedQuarantineIds()));
  for (const id of Object.keys(policy.QUARANTINED_PACKS)) {
    assert.equal(policy.hasQuarantineConsent(id), false);
    assert.ok(policy.getPackBlockReason(id));
  }
  // Only known quarantined ids may be registered; everything else is rejected.
  for (const id of ['cursor', 'claude', 'unknown', '', null, undefined, 'constructor', '__proto__', {}]) {
    assert.throws(() => policy.grantQuarantineConsent(id), undefined, `grant(${String(id)})`);
  }
  assert.throws(() => policy.setQuarantineConsent('codex'), TypeError);
  assert.throws(() => policy.setQuarantineConsent(['cursor']));
  try {
    assert.deepEqual(policy.grantQuarantineConsent('codex'), ['codex']);
    assert.equal(policy.hasQuarantineConsent('codex'), true);
    assert.equal(policy.getPackBlockReason('codex'), null);
    assert.doesNotThrow(() => policy.assertPackAllowed('codex'));
    // Consent is per-id: the other quarantined payloads stay blocked.
    assert.equal(policy.hasQuarantineConsent('anti-gravity'), false);
    assert.ok(policy.getPackBlockReason('anti-gravity'));
    assert.deepEqual(policy.setQuarantineConsent([]), []);
    assert.ok(policy.getPackBlockReason('codex'));
    assert.throws(() => policy.assertPackAllowed('codex'), { code: 'ERR_PACK_QUARANTINED' });
  } finally {
    policy.setQuarantineConsent([]);
  }
  assert.deepEqual(policy.grantedQuarantineIds(), []);
});

test('consented quarantined ids resolve to a plan; the others stay fail-closed', () => {
  const legacy = { install: { file: 'install-replica.ps1' }, uninstall: { file: 'Uninstall.ps1' } };
  try {
    policy.grantQuarantineConsent('codex');
    assert.deepEqual(policy.getDeployPlanInfo('codex', legacy), {
      blockedReason: null, hasInstall: true, hasUninstall: true,
      installFile: 'install-replica.ps1', uninstallFile: 'Uninstall.ps1'
    });
    assert.equal(policy.getDeployPlanInfo('anti-gravity', legacy).hasInstall, false);
    assert.equal(policy.getDeployPlanInfo('cursor', { install: null }).hasInstall, false);
    assert.doesNotThrow(() => policy.assertBackupAllowed('codex', 'codex-20260920-123456'));
    assert.throws(() => policy.assertBackupAllowed('cursor', 'codex-20260920-123456'));
  } finally {
    policy.setQuarantineConsent([]);
  }
  assert.equal(policy.getDeployPlanInfo('codex', legacy).hasInstall, false);
});

test('consent-only helpers and labels are exported, and no payload is named in the label', () => {
  assert.equal(policy.QUARANTINE_CONSENT_LABEL, '我知晓 同意');
  assert.match(policy.QUARANTINE_CONSENT_NOTICE, /consent-required/);
  assert.match(policy.QUARANTINE_CONSENT_NOTICE, /不再强制隔离/);
  assert.match(policy.QUARANTINE_CONSENT_NOTICE, /不是安全认证|解锁同样不是/);
  for (const fn of ['isQuarantinedId', 'setQuarantineConsent', 'grantQuarantineConsent', 'revokeQuarantineConsent', 'grantedQuarantineIds', 'hasQuarantineConsent', 'getSourceNameMatchId']) {
    assert.equal(typeof policy[fn], 'function', fn);
  }
  assert.equal(policy.isQuarantinedId('claude'), false);
  assert.equal(policy.isQuarantinedId('codex'), true);
  assert.equal(policy.getSourceNameMatchId('/x/slo-runtime-hook.exe'), 'codex');
  assert.equal(policy.getSourceNameMatchId('/x/keysmith/'), 'codex-panghu');
  assert.equal(policy.getSourceNameMatchId('/x/install-antigravity.ps1'), 'anti-gravity');
  assert.equal(policy.getSourceNameMatchId('/release/claude/install-claude.py'), null);
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
  assert.match(ipcBody('detect'), /const plan = core\.deployPlanFor\(id\);/);
  assert.match(ipcBody('detect'), /getDeployPlanInfo\(id, plan\)/);
  before(ipcBody('openRoot'), 'fs.statSync(state.root).isDirectory()', 'shell.openPath(state.root)');
});

test('consent IPC accepts only quarantined ids, persists, then re-resolves plans', () => {
  const body = ipcBody('setConsent');
  assert.match(body, /guard\(id\);/);
  assert.match(body, /if \(!isQuarantinedId\(id\)\) throw new Error/);
  before(body, 'isQuarantinedId(id)', 'state.consents[id] =');
  before(body, 'state.consents[id] =', 'await saveState(state)');
  assert.match(body, /delete state\.consents\[id\]/);
  assert.match(body, /label: QUARANTINE_CONSENT_LABEL/);
  // The register is derived from persisted state on every state load: the
  // renderer's checkbox alone can never unlock a payload.
  assert.match(main, /function syncConsentRegister\(state\)/);
  const sync = between(main, 'function syncConsentRegister(', 'async function loadState(');
  before(sync, 'Object.keys(state.consents || {})', 'setQuarantineConsent(ids)');
  assert.match(sync, /return state;/);
  assert.match(between(main, 'async function loadState()', 'async function saveState('), /syncConsentRegister\(/);
  assert.match(main, /consents: Object\.keys\(state\.consents \|\| \{\}\)/);
  assert.match(read('electron/preload.cjs'), /setConsent: \(id, granted\) => ipcRenderer\.invoke\('dango:setConsent', id, Boolean\(granted\)\)/);
  assert.match(read('src/App.tsx'), /await api\.setConsent\(id, granted\)/);
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
  assert.match(sourcePolicy, /sourceNameReason\(id, path\.basename\(name\)\)/);
  // Only the matching, consented id may use its own legacy source tree.
  assert.match(sourcePolicy, /function sourceNameReason\(id, name\)/);
  assert.match(sourcePolicy, /if \(matched === id && hasQuarantineConsent\(id\)\) return null;/);
  assert.match(sourcePolicy, /return QUARANTINED_PACKS\[matched\];/);
  assert.doesNotMatch(sourcePolicy, /child_process|execFile|spawn\(/);
});

test('consent unlocks a pack’s own tree and never another pack’s tree', () => {
  // v1.5.7 regression (second blocker): the recursive source-name scan matched
  // every descendant against every quarantined id, and
  // packed-packs/codex/breaker-tx/skills/packs/anti-gravity/ is a legitimate
  // skill-catalogue directory of the codex toolkit. Consent therefore unlocked
  // the policy gate and then resolvePackDir() threw in assertPackSourceAllowed,
  // so codex install stayed dead even after a consented payload shipped.
  const packsRoot = path.join(__dirname, '..', 'packed-packs');
  try {
    for (const id of Object.keys(policy.QUARANTINED_PACKS)) {
      const tree = path.join(packsRoot, id);
      assert.throws(() => assertPackSourceAllowed(id, tree), { code: 'ERR_PACK_QUARANTINED' }, `${id} 未同意时必须阻断`);
      policy.grantQuarantineConsent(id);
      assert.doesNotThrow(() => assertPackSourceAllowed(id, tree), `${id} 同意后必须能解析自己的内嵌目录`);
    }
    // Consent is per pack: it is never a licence to deploy another pack's tree.
    assert.throws(() => assertPackSourceAllowed('codex', path.join(packsRoot, 'anti-gravity')), { code: 'ERR_PACK_SOURCE_QUARANTINED' });
    assert.throws(() => assertPackSourceAllowed('anti-gravity', path.join(packsRoot, 'codex')), { code: 'ERR_PACK_SOURCE_QUARANTINED' });
  } finally {
    policy.setQuarantineConsent([]);
  }
  // Release packs keep the full descendant scan, so the exemption stays scoped.
  assert.throws(() => assertPackSourceAllowed('workbuddy', path.join(packsRoot, 'codex')), { code: 'ERR_PACK_SOURCE_QUARANTINED' });
  assert.throws(() => assertPackSourceAllowed('cursor', path.join(packsRoot, 'codex-panghu')), { code: 'ERR_PACK_SOURCE_QUARANTINED' });
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

test('legacy quarantined plans and L4 channels stay dormant until consent', () => {
  const legacy = between(core, 'const LEGACY_QUARANTINE_PLANS =', 'function detectPlatform(');
  for (const id of Object.keys(policy.QUARANTINED_PACKS)) {
    const key = id === 'codex' ? 'codex' : `'${id}'`;
    assert.match(legacy, new RegExp(`${key}: \\{`), key);
  }
  // v1.5.4 legacy scripts, not new ones: the substituted bytes must be visible.
  assert.match(legacy, /install-replica\.ps1/);
  assert.match(legacy, /Install-AntiGravity\.ps1/);
  assert.match(
    core,
    /function deployPlanFor\(id\) \{\s*const legacy = LEGACY_QUARANTINE_PLANS\[id\];\s*if \(legacy && hasQuarantineConsent\(id\)\) return legacy;\s*return DEPLOY_PLANS\[id\] \|\| \{\};/
  );
  assert.match(core, /function isConsentPack\(id\) \{/);
  assert.match(core, /const plan = deployPlanFor\(id\);/);
  assert.match(core, /function l4ChannelFor\(id\) \{/);
  assert.match(core, /const chan = l4ChannelFor\(id\);/);
  assert.match(core, /function cliChannelFor\(id\) \{/);
  // mode:'none' payloads are hard-skipped unless consent promotes them.
  const channels = between(core, 'const L4_CHANNELS = {', 'function l4ChannelFor(id)');
  for (const id of Object.keys(policy.QUARANTINED_PACKS)) {
    const key = id === 'codex' ? 'codex' : `'${id}'`;
    assert.match(channels, new RegExp(`${key}: \\{ mode: 'none', consentMode: '(cli|gui)'`), key);
  }
  // The main process must not read the raw plan/channel tables anymore.
  assert.doesNotMatch(main, /core\.DEPLOY_PLANS/);
  assert.doesNotMatch(main, /core\.L4_CHANNELS/);
  assert.match(main, /core\.deployPlanFor\(id\)/);
  assert.match(main, /core\.l4ChannelFor\(id\)/);
  // No remaining codex-only assumptions in the CLI verification path.
  assert.doesNotMatch(main, /core\.buildCliVerifyArgs\(/);
  assert.match(main, /cliChan\.buildVerifyArgs\(verifyCwd, core\.VERIFY_PROMPT\)/);
  assert.match(main, /cliChan && cliChan\.versionArgs\) \|\| \['--version'\]/);
});

test('platform viewing and independent Codex text library are not pack deployment', () => {
  for (const name of ['detect', 'getIcon', 'verifyBreak', 'listBackups', 'clearImport', 'libraryImport', 'libraryImportBatch', 'libraryRemove']) {
    assert.doesNotMatch(ipcBody(name), /assertPackAllowed\(/, `${name} remains a separate management route`);
  }
  const targets = between(core, 'const RULE_FILE_TARGETS =', 'function buildImportBlock(');
  assert.match(targets, /codex: \{\s*mode: 'append',\s*file: \(\) => path\.join\(codexHome\(\), 'AGENTS.md'\)/);
});

test('UI displays quarantine reasons and excludes payloads from batch actions', () => {
  const app = read('src/App.tsx');
  assert.match(app, /const targets = packs\.filter\(/);
  assert.match(app, /!p\.consentRequired/);
  assert.match(app, /!plans\[p\.id\]\?\.blockedReason/);
  for (const file of ['PackCard.tsx', 'PackDetailModal.tsx']) {
    const text = read(`src/components/${file}`);
    assert.match(text, /const blockedReason = pack\.blockedReason \|\| plan\?\.blockedReason/);
    assert.match(text, /disabled=\{busy \|\| Boolean\(blockedReason\)/);
    assert.match(text, /已隔离/);
    // Unticked => still read-only; ticking is the only path to unlock.
    assert.match(text, /const consented = Boolean\(pack\.consented\)/);
    assert.match(text, /onChange=\{\(e\) => onConsent\?\.\(pack\.id, e\.target\.checked\)\}/);
    assert.match(text, /checked=\{consented\}/);
    assert.match(text, /pack\.consentLabel \|\| '我知晓 同意'/);
  }
  assert.match(read('src/components/PackCard.tsx'), /data-testid=\{`consent-check-\$\{pack\.id\}`\}/);
  assert.match(read('src/components/PackDetailModal.tsx'), /data-testid=\{`detail-consent-check-\$\{pack\.id\}`\}/);
  const imports = read('src/components/ImportModal.tsx');
  assert.match(imports, /const canConfirm = Boolean\(picked\) && !selectedBlock/);
  assert.match(imports, /disabled=\{busy \|\| Boolean\(p\.blockedReason \|\| p\.analysis\?\.blockedReason \|\| blockOf\(p\.platform\)\)\}/);
});

test('the Claude card is a first-class release pack with a matching style token', () => {
  assert.match(core, /id: 'claude',\s*\n\s*name: 'Claude Code 破甲包'/);
  assert.match(core, /folder: 'claude',\s*\n\s*target: 'Claude Code',\s*\n\s*accent: 'clay'/);
  assert.match(core, /claude: \{\s*\n\s*mode: 'cli',\s*\n\s*cliName: 'claude CLI'/);
  assert.match(core, /function buildClaudeVerifyArgs\(cwd, prompt = VERIFY_PROMPT\) \{\s*\n\s*return \['-p', String\(prompt\)\];/);
  assert.match(core, /claude: \{\s*\n\s*findExe: \(\) => findClaudeCliInfo\(\),\s*\n\s*versionArgs: \['--version'\],\s*\n\s*buildVerifyArgs: \(cwd, prompt\) => buildClaudeVerifyArgs\(cwd, prompt\)/);
  assert.match(core, /function findClaudeCliInfo\(\)/);
  assert.doesNotMatch(between(core, 'function findClaudeCliInfo()', 'const CLI_CHANNELS ='), /execFileSync\(|spawn\(/);
  assert.match(core, /CHA-CLAUDE-POJIA:BEGIN/);
  assert.match(read('src/styles/app.css'), /\.accent-clay \{/);
  assert.match(read('src/styles/app.css'), /--clay: #d97757;/);
  assert.match(read('src/types.ts'), /'indigo' \| 'clay'/);
  assert.match(read('src/App.tsx'), /'dsh', 'claude', 'opencode'/);
  // The card must show the real embedded pack version, not a hard-coded one.
  const pkg = JSON.parse(read('package.json'));
  // v1.5.7: the artifact ships all nine trees (see DISTRIBUTED_PACK_IDS), so the
  // consent checkbox has a real payload to unlock.
  assert.deepEqual(pkg.build.extraResources.find(r => r.from === 'packed-packs').filter.filter(f => f.endsWith('/**') && !f.startsWith('!')), ['cursor/**', 'dsh/**', 'claude/**', 'opencode/**', 'workbuddy/**', 'workbuddy-ai/**', 'codex/**', 'codex-panghu/**', 'anti-gravity/**']);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'packed-packs', 'claude', 'install-claude.py')));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'packed-packs', 'claude', 'README-CN.txt')));
});

test('real filesystem: embedded Claude pack satisfies expected entries and source guard', () => {
  const root = path.join(__dirname, '..', 'packed-packs', 'claude');
  const expected = ['install-claude.py', 'CLAUDE.md.cha-block.md', 'routes', 'routes/leaves', 'workflows', 'README-CN.txt'];
  assert.deepEqual(missingExpectedEntries(root, expected), []);
  assert.doesNotThrow(() => assertPackSourceAllowed('claude', root));
  // 88 write targets: 1 CLAUDE.md + 1 rule file + 86 skills.
  const routeIds = fs.readdirSync(path.join(root, 'routes')).filter(n => /^cha-.*\.md$/.test(n));
  const leaves = fs.readdirSync(path.join(root, 'routes', 'leaves')).filter(n => n.endsWith('.md') && n !== 'INDEX.md');
  assert.equal(routeIds.length, 6);
  assert.equal(leaves.length, 80);
  assert.equal(fs.readdirSync(path.join(root, 'skills-rendered')).length, 86);
  const packText = fs.readFileSync(path.join(root, 'CLAUDE.md.cha-block.md'), 'utf8');
  assert.ok(packText.includes('<!-- CHA-CLAUDE-POJIA:BEGIN -->'));
  assert.ok(packText.includes('<!-- CHA-CLAUDE-POJIA:END -->'));
});

test('the isolated-build source export carries all nine packs plus the quarantined payload', () => {
  // v1.5.7 regression, the mirror image of v1.5.6's bug. v1.5.6 exported only the
  // six release trees and dropped the three quarantined ones, so a registered
  // consent had no payload to install: resolvePackDir() fell through to
  // source:'none' and the install button stayed disabled for ever.
  const src = read('scripts/isolated-build-export.ps1');
  const listOf = (name) => {
    const m = new RegExp(`\\$${name} = @\\(([^)]*)\\)`).exec(src);
    assert.ok(m, `isolated-build-export.ps1 缺少 $${name}`);
    return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  };
  const packIds = listOf('packIds');
  assert.deepEqual(packIds.slice().sort(), [...policy.DISTRIBUTED_PACK_IDS].sort());
  assert.deepEqual(packIds.filter(id => policy.RELEASE_PACK_IDS.includes(id)).sort(), [...policy.RELEASE_PACK_IDS].sort());
  assert.deepEqual(listOf('quarantinedPacks').slice().sort(), Object.keys(policy.QUARANTINED_PACKS).sort());
  // The quarantined trees must no longer be stripped by the export omit list.
  const omitAtRoot = listOf('omitAtRoot');
  const omitAnywhere = listOf('omitAnywhere');
  for (const id of Object.keys(policy.QUARANTINED_PACKS)) assert.ok(!omitAtRoot.includes(id) && !omitAnywhere.includes(id), `${id} 不得再被导出排除`);
  // Build outputs must be scoped to the project root: a pack legitimately vendors
  // its own node_modules (opencode) and keeps its own release/ folder
  // (codex-panghu), and package.json's extraResources filter keeps both. Matching
  // them by basename alone broke host/guest parity in every prior release.
  for (const name of ['node_modules', 'release', 'dist-electron', 'release-next', 'release-final', '.git']) {
    assert.ok(omitAtRoot.includes(name), `${name} 必须只在项目根目录排除`);
    assert.ok(!omitAnywhere.includes(name), `${name} 不得按目录名全局排除`);
  }
  // Names that the extraResources filter also excludes stay basename-global.
  for (const name of ['backups', 'evidence', '__pycache__', '_quarantine', '_deprecated-omen-bridge']) {
    assert.ok(omitAnywhere.includes(name), `${name} 必须与 PACK_EXCLUSIONS 对齐`);
  }
  // `.gitkeep` is declared, not inferred. builder-util's copyDir (the Go
  // `app-builder copy-dir` primitive behind extraResources) skips `.gitkeep`
  // unconditionally: a guest fixture holding `.gitkeep`, `.gitignore`,
  // `.github/w.yml`, `.travis.yml`, `.keep` and a zero-byte file comes back with
  // everything except `.gitkeep`. It is not the `excludedNames` list in
  // fileMatcher.js (`.gitignore`/`.github`/`.travis.yml` are on it and survive)
  // and not an empty-file rule (zero-byte files survive). Left undeclared, the
  // filter and the artifact disagree on 139 placeholders -- which is exactly what
  // the guest parity assertion caught on the first 1.5.7 build.
  // security-preflight.test.cjs asserts this array equals RELEASE_RESOURCE_FILTER,
  // so pinning it here transitively pins PACK_EXCLUSIONS.
  const resourceFilter = JSON.parse(read('package.json')).build.extraResources
    .find(item => item.from === 'packed-packs').filter;
  assert.equal(resourceFilter.filter(f => f === '!**/.gitkeep').length, 1,
    'package.json 过滤规则必须显式声明引擎丢弃的 .gitkeep');
  assert.ok(omitAnywhere.includes('.gitkeep'), '.gitkeep 必须随 PACK_EXCLUSIONS 一起导出排除');
  assert.match(src, /-not \$relative\.Contains\('\\'\)/, '根目录判定必须看相对路径，而不是目录名');
  assert.doesNotMatch(src, /\$omit = @\(/, '旧的全局 omit 名单不得复活');
  // v1.5.7 taint discovery. The five binaries removed by the 1.5.5 hygiene sweep
  // can no longer be restored from .security-quarantine-1.5.5: those blobs are
  // *themselves* wrapped by the incident host's prepender -- stripping the loader
  // yields the pinned clean copy, but the blob as stored still carries it. The
  // earlier export restored them verbatim, so the archive shipped the loader and
  // the guest preflight correctly refused to package it (10 fixed-text-sha256
  // findings on exactly these five files). The payloads are now carried de-tainted
  // inside packed-packs/ and gated by a content baseline plus a live scan.
  const dedetaint = JSON.parse(read('scripts/payload-dedetaint.json'));
  assert.equal(dedetaint.allPass, true, '去污基线必须标 allPass');
  assert.equal(dedetaint.schemaVersion, 1);
  assert.equal(dedetaint.items.length, 5);
  assert.match(dedetaint.loader.textWindowSha256, /^[0-9a-f]{64}$/, '基线必须钉死预挂器文本段签名');
  assert.equal(dedetaint.loader.alignment, 4096);
  assert.equal(dedetaint.loader.tailRecordBytes, 30);
  const payloadSuffixes = [
    'anti-gravity/materials/proxy/bin/antigravity-oauth-proxy.exe',
    'codex/materials/slo-runtime/eni-solo/sha256-r2-mixed-pinned-2b50f93a8d7716b5/slo-runtime-hook.exe',
    'codex-panghu/keysmith/python/python.exe',
    'codex-panghu/keysmith/python/Lib/venv/scripts/nt/python.exe',
    'codex-panghu/keysmith/python/Lib/venv/scripts/nt/pythonw.exe',
  ];
  for (const suffix of payloadSuffixes) {
    const item = dedetaint.items.find(i => i.packRel === suffix);
    assert.ok(item, `去污基线缺少载荷 ${suffix}`);
    assert.equal(item.verdict, 'PASS', `${suffix} 必须判定 PASS`);
    assert.equal(item.entryPath, `packed-packs/${suffix}`, 'entryPath 必须与导出期间的归档条目名一致');
    assert.ok(item.cleanSize < item.taintedSize, `${suffix} 的干净副本必须小于被污染副本`);
    assert.equal(item.taintedSize - item.cleanSize, item.delta);
    assert.equal(item.delta % dedetaint.loader.alignment, dedetaint.loader.tailRecordBytes,
      `${suffix} 被剥离的前缀必须是整数个预挂器页加一条尾记录`);
    assert.ok(item.cleanSize > 2, `${suffix} 的干净副本必须长于一个 PE 头`);
  }
  // The export must be driven by that baseline, must self-heal (the incident host
  // re-wraps newly written *.exe every 60-120 s, so the tree cannot be trusted at
  // export time), and must fail closed on any residue.
  assert.match(src, /scripts','payload-dedetaint\.json'/, '导出必须读取去污基线');
  assert.match(src, /-not \$dedetaint\.allPass/, '基线未过审必须拒绝导出');
  assert.match(src, /@\(\$dedetaint\.items\)\.Count -ne 5/, '基线必须正好覆盖五个载荷');
  assert.match(src, /\$loaderSig -notmatch '\^\[0-9a-f\]\{64\}\$'/, '基线签名形状必须校验');
  assert.match(src, /\$baseline\.ContainsKey\(\$entryName\)/, '必须按归档条目名匹配基线');
  assert.match(src, /\$baseline\.Count -ne 5/, '五个载荷的归档条目名必须唯一');
  assert.match(src, /\(\$head % \$align\) -ne \$tailRecord/, '剥离前必须先匹配已知预挂器形状');
  assert.match(src, /\$body\[0\] -ne 77 -or \$body\[1\] -ne 90/, '恢复的载荷必须是真实 MZ 二进制');
  assert.match(src, /if \(\$taintedHits\.Count -gt 0\)/, '残留预挂器签名必须 fail closed');
  assert.match(src, /\$dedetainted\.Count -ne 5/, '归档里必须正好五个去污载荷，缺任一即 fail closed');
  assert.match(src, /restoredFromQuarantine=@\(\)/, '隔离区恢复路径必须彻底移除');
  assert.doesNotMatch(src, /quarantinePath/, '导出不得再读取隔离区 blob');
  assert.doesNotMatch(src, /\$requiredPayload/, '旧的隔离区恢复名单不得复活');
  assert.match(src, /packed-packs\\NOTICE\.txt/, 'NOTICE.txt 必须随包导出');
  // The extension guard stays: executables are legal only inside the reviewed
  // quarantined payload prefixes, never anywhere else in the tree.
  assert.match(src, /-and -not \$payload\) \{ throw "Executable extension in source/, '.exe/.dll/.pyd 只允许出现在隔离载荷前缀内');
  assert.match(src, /projectVersion='1\.5\.7'/);
  assert.match(src, /susu157-source\.zip/, '默认输出名必须跟随当前版本');
});

test('the isolated GUI smoke pack lists and names track the real pack table', () => {
  // Same drift class as the export list: a hard-coded mirror is fine only if
  // something fails the moment it diverges from the authoritative tables.
  const src = read('scripts/isolated-gui-smoke.cjs');
  const listOf = (name) => {
    const m = new RegExp(`const ${name} = (\\[[^\\]]*\\])`).exec(src);
    assert.ok(m, `isolated-gui-smoke.cjs 缺少 const ${name}`);
    return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  };
  const allowed = listOf('allowed');
  const blocked = listOf('blocked');
  assert.deepEqual(allowed.slice().sort(), [...policy.RELEASE_PACK_IDS].sort());
  assert.deepEqual(blocked.slice().sort(), Object.keys(policy.QUARANTINED_PACKS).sort());
  const namesBlock = between(src, 'const names = {', '\n};');
  const declared = new Map([...namesBlock.matchAll(/'?([A-Za-z0-9_-]+)'?:\s*'([^']*)'/g)].map(m => [m[1], m[2]]));
  const core = require('../electron/core.cjs');
  const expectedNames = new Map(core.PACKS.map(p => [p.id, p.name]));
  assert.deepEqual([...declared.keys()].sort(), core.PACK_IDS.slice().sort(), 'names 必须恰好覆盖全部受管包');
  for (const [id, name] of expectedNames) assert.equal(declared.get(id), name, `${id} 显示名与 core.PACKS 不一致`);
  // Card / resource counts are hard-coded; they must follow the two lists.
  const total = allowed.length + blocked.length;
  const words = { 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten' };
  assert.ok(words[total], `需要为总数 ${total} 补充英文数字`);
  assert.match(src, new RegExp(`pack-card-\\"\\]'\\)\\.length === ${total}`, 'g'), `卡片总数断言必须等于 ${total}`);
  assert.ok(src.includes(`retains ${words[total]} cards`), `返回工具箱卡片数断言必须等于 ${total}`);
  // v1.5.7: all nine trees ship, so the resource-directory assertion counts the
  // distributed total. The found-filter assertion still counts only the six
  // release packs, because an un-consented quarantined id resolves to
  // source:'quarantined' with found=false — identical to the old hard quarantine.
  assert.ok(src.includes(`exactly ${words[total]} distributed pack directories`), `资源目录数断言必须等于 ${total}`);
  assert.ok(src.includes(`filter shows ${words[allowed.length] || allowed.length}`), `found 过滤器数量断言必须等于 ${allowed.length}`);
  assert.ok(src.includes('shipped quarantined payload present and non-empty'), '必须断言隔离载荷真的随包发出');
  assert.ok(src.includes(`${words[total]} expected resource IDs`), `资源 ID 数量断言必须等于 ${total}`);
  // The Python driver mirrors the same three axes and is not covered by the
  // literals above, so pin it here rather than trusting the reader's eye.
  const driver = read('scripts/isolated-gui-smoke.py');
  const pyList = (name) => {
    const m = new RegExp(`^${name} = \\[([^\\]]*)\\]`, 'm').exec(driver);
    assert.ok(m, `isolated-gui-smoke.py 缺少 ${name}`);
    return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  };
  assert.deepEqual(pyList('ALLOWED').slice().sort(), [...policy.RELEASE_PACK_IDS].sort());
  assert.deepEqual(pyList('RETIRED').slice().sort(), Object.keys(policy.QUARANTINED_PACKS).sort());
  assert.match(driver, /DISTRIBUTED = sorted\(ALLOWED \+ RETIRED\)/, '派生列表必须由两条轴拼出');
  assert.match(driver, /packResourceDirectories'\] == DISTRIBUTED/,
    '解包目录断言必须等于九包，而不是仅六包发布白名单');
});

test('the source archive is extracted by a UTF-8 safe unpacker, not `unzip`', () => {
  // v1.5.7 defect: Ubuntu ships Info-ZIP UnZip 6.00, which rewrites bit-11 UTF-8
  // entry names into the OEM/CP437 glyph set under the guest's C.UTF-8 locale.
  // `unzip` therefore turned packed-packs/cursor/一键安装.bat into
  // packed-packs/cursor/ф╕АщФохоЙшгЕ.bat and produced 454 garbled paths in the
  // shipped portable exe. Ground truth from the guest: `unzip` wrote byte 0xD1
  // where `zipfile` wrote 0xE4 for the same entry. The archive is correct (all 566
  // non-ASCII names carry the UTF-8 flag); only the extractor was wrong.
  //
  // This is the same drift class as the pack lists: a harness that is not proven
  // against the host-written manifest cannot detect a mangled transfer, because
  // the guest tree would still agree with itself.
  const unpacker = read('scripts/isolated-build-unpack.py');
  const verifier = read('scripts/isolated-build-verify.cjs');
  assert.match(unpacker, /zipfile\.ZipFile\(archive\)/, '必须用 zipfile 解包');
  assert.match(unpacker, /MANIFEST_NAME = 'SOURCE-MANIFEST\.json'/);
  assert.match(unpacker, /manifest\['schemaVersion'\] == 2/);
  assert.match(unpacker, /sha256_file\(target\) != record\['sha256'\]/, '必须逐文件复核 sha256');
  assert.match(unpacker, /item\.external_attr >> 16\) & 0o170000\) != 0o120000|mode != 0o120000/, '必须拒绝归档符号链接');
  assert.match(unpacker, /'\.\.' not in relative\.parts/, '必须拒绝越界路径');
  assert.match(unpacker, /CURSOR_ENTRY_FILES/, '必须点名断言中文入口文件');
  assert.match(unpacker, /一键安装\.bat/);
  assert.match(unpacker, /report\['unpackerSha256'\] == sha256_file/, '归档内副本必须与运行的副本逐字节相同');
  assert.match(unpacker, /do not attest the host|不 attest|does not attest the host/);
  // The verifier is the gate that actually runs on every guest build; it must
  // compare the guest tree against the HOST manifest, not against itself.
  assert.match(verifier, /SOURCE-MANIFEST\.json 缺失/, '产物校验必须要求主机清单');
  assert.match(verifier, /传输把文件名改坏了/);
  assert.match(verifier, /packed-packs 的主机清单与客体解包树必须逐名一致/);
  assert.match(verifier, /source-transfer-integrity\.json/);
  // Export must carry the unpacker: it is matched by the isolated-build* glob.
  assert.match(read('scripts/isolated-build-export.ps1'), /'isolated-build\*'/);
});

// Explicit opt-in: checks the actual packed trees, not installed user profiles.
// No fixtures are created, no payload imports/eval/spawn, no dependencies.
const realTreeOptions = { skip: process.env.DANGO_TEST_REAL_PACKS !== '1' && 'set DANGO_TEST_REAL_PACKS=1 for read-only real-tree checks' };
test('real filesystem: all six release trees pass the source guard', realTreeOptions, async (t) => {
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
