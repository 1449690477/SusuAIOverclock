'use strict';
// Actual packaged Electron UI, no mock IPC, source build, installs or user CLI.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { parseArgs } = require('node:util');
const { values: options } = parseArgs({ options: { root: { type: 'string' }, runtime: { type: 'string' } } });
assert(options.root && /^\d+\.\d+\.\d+$/.test(options.runtime || ''), '--root and --runtime required');
const root = path.resolve(options.root);
const runtime = options.runtime;
const staged = path.join(root, 'gui-runtime', `electron-${runtime}`, 'linux-x64');
const expectedAppVersion = process.env.GUI_APP_VERSION || '1.5.6';
const { _electron, chromium } = require(path.join(root, 'project/node_modules/playwright-core'));
const out = process.env.GUI_RUN_DIR;
const mode = process.env.GUI_MODE;
assert(process.platform === 'linux' && root.startsWith('/home/builder/') && out?.startsWith(root + `/logs/gui-electron${runtime}-`));
assert(process.env.GUI_RUNTIME_DIR === staged);
// Authoritative lists mirror electron/security-policy.cjs. tests/security-quarantine.test.cjs
// asserts these literals still equal the policy, so drift fails the fast suite.
const allowed = ['cursor', 'dsh', 'claude', 'opencode', 'workbuddy', 'workbuddy-ai'];
// No longer hard-blocked in v1.5.6: these are consent-required. Without a
// registered consent they must behave exactly like the old hard quarantine.
const blocked = ['codex', 'codex-panghu', 'anti-gravity'];
const ids = [...allowed, ...blocked].sort();
const names = {
  codex: 'Codex 冷咖啡石井 · 旧载荷（已隔离）', 'codex-panghu': 'Codex 胖虎 · 旧载荷（已隔离）',
  cursor: 'Cursor 破甲包', dsh: 'DSH 破甲懒人包', claude: 'Claude Code 破甲包',
  opencode: 'OpenCode 破甲包',
  workbuddy: 'WorkBuddy 破甲包', 'workbuddy-ai': 'WorkBuddy AI 国际版破甲包',
  'anti-gravity': '反重力 · 旧载荷（已隔离）'
};
const nested = { cursor: ['materials/rules', 'materials/tools/cursor_tamper_proxy.py'],
  'workbuddy-ai': ['materials/IDENTITY.md', 'materials/MEMORY.md', 'materials/SOUL-snippet.txt'] };
const report = { mode, root, runtime, startedAt: new Date().toISOString(), checks: [], screenshots: [], rendererErrors: [], console: [],
  buttonStates: {}, nestedPathsFixed: [],
  failedRequests: [], blockedRequests: [], quarantineIPC: [], limitations: [
    'No allowed-pack install/uninstall, deep verification, user CLI, hooks, backup/restore or library injection executed.',
    'Linux fallback does not verify Windows-native GUI, portable self-extraction, Windows platform detection or Windows installer functionality.'
  ] };
let app, browser, page, wine;
const write = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + '\n');
// Playwright 1.48 may leave a second rejected waitForLine promise when Electron
// aborts before inspector readiness. Preserve that real launch failure too.
process.on('unhandledRejection', error => {
  report.launchUnhandled = String(error.stack || error);
  write('report.json', { ...report, status: 'FAIL' });
  console.error(report.launchUnhandled);
  process.exitCode = 1;
});
const check = (name, ok, details) => {
  const result = { name, ok: Boolean(ok), details };
  report.checks.push(result);
  fs.appendFileSync(path.join(out, 'checks.jsonl'), JSON.stringify(result) + '\n');
  assert(ok, name);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nativePath = value => /^[cC]:/.test(value)
  ? path.join(process.env.WINEPREFIX, 'drive_c', value.slice(3).replaceAll('\\', '/'))
  : value.replace(/^Z:/, '').replaceAll('\\', '/');

function targetSnapshot() {
  const keys = ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CODEX_HOME', 'DSH_HOME', 'WB_HOME', 'WBAI_HOME'];
  const files = {};
  const walk = p => {
    if (!fs.existsSync(p)) return;
    const st = fs.lstatSync(p);
    if (st.isDirectory()) for (const n of fs.readdirSync(p).sort()) walk(path.join(p, n));
    else files[p] = st.isSymbolicLink() ? { link: fs.readlinkSync(p) } : { bytes: st.size, sha256: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') };
  };
  for (const k of keys) walk(process.env[k].replace(/^Z:/, '').replaceAll('\\', '/'));
  return files;
}

async function screenshot(name) {
  const file = path.join(out, 'screenshots', name + '.png');
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  report.screenshots.push(file);
  fs.writeFileSync(path.join(out, name + '.txt'), await page.locator('body').innerText());
}

async function connectWine() {
  const flags = ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=19330', '--inspect=127.0.0.1:19331', '--enable-logging=stderr'];
  report.launch = ['/usr/bin/wine', process.env.GUI_EXECUTABLE, ...flags];
  const log = fs.openSync(path.join(out, 'electron.log'), 'w');
  wine = spawn('/usr/bin/wine', [process.env.GUI_EXECUTABLE, ...flags], { env: process.env, detached: true, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  report.winePid = wine.pid;
  const until = Date.now() + 145000;
  while (Date.now() < until) {
    if (wine.exitCode !== null) throw new Error(`Wine application exited ${wine.exitCode} before CDP readiness`);
    try {
      const r = await fetch('http://127.0.0.1:19330/json/version', { signal: AbortSignal.timeout(1200) });
      if (r.ok) {
        report.cdpVersion = await r.json();
        browser = await chromium.connectOverCDP('http://127.0.0.1:19330', { timeout: 15000 });
        return browser.contexts()[0];
      }
    } catch { /* CDP not ready yet */ }
    await sleep(700);
  }
  throw new Error('Wine CDP not ready within 145 seconds; no Windows GUI verified');
}

async function run() {
  const baselineTargets = targetSnapshot();
  check('fresh target homes empty', Object.keys(baselineTargets).length === 0, baselineTargets);
  let context;
  if (mode === 'wine') context = await connectWine();
  else {
    const args = ['--enable-logging=stderr'];
    if (mode === 'linux-no-sandbox') args.push('--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage');
    report.launch = [process.env.GUI_EXECUTABLE, ...args];
    app = await _electron.launch({ executablePath: process.env.GUI_EXECUTABLE, args, env: { ...process.env }, timeout: 45000 });
    app.process().stdout.on('data', b => fs.appendFileSync(path.join(out, 'electron.log'), b));
    app.process().stderr.on('data', b => fs.appendFileSync(path.join(out, 'electron.log'), b));
    report.electronInfo = await app.evaluate(({ app }) => ({
      version: app.getVersion(), name: app.getName(), isPackaged: app.isPackaged,
      appPath: app.getAppPath(), resourcesPath: process.resourcesPath,
      electron: process.versions.electron, platform: process.platform,
      userData: app.getPath('userData'), home: app.getPath('home'),
      noSandbox: app.commandLine.hasSwitch('no-sandbox'), runAsNode: process.env.ELECTRON_RUN_AS_NODE || null
    }));
    // Official executable is still named "electron", so Electron reports
    // isPackaged=false even while loading the ORIGINAL built app.asar. Do not
    // rename the executable or patch that flag to manufacture a packaged claim.
    check('actual app.asar version/runtime', report.electronInfo.version === expectedAppVersion && report.electronInfo.electron === runtime, report.electronInfo);
    report.limitations.push('Official Linux launcher named electron reports app.isPackaged=false; original Windows app.asar/resources are hash-identical, not a Linux release build.');
    check('actual staged Windows app.asar entry', report.electronInfo.appPath === path.join(staged, 'resources/app.asar'));
    check('correct separate resource root', report.electronInfo.resourcesPath === path.join(staged, 'resources'));
    check('fresh userData and cleared ELECTRON_RUN_AS_NODE', report.electronInfo.userData.startsWith(out + '/profile/') && report.electronInfo.runAsNode === null);
    context = app.context();
  }
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (/^(file:|data:|blob:|devtools:)/.test(url) || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?=[:/])/.test(url)) return route.continue();
    report.blockedRequests.push(url);
    return route.abort('blockedbyclient');
  });
  const observe = p => {
    p.on('pageerror', e => report.rendererErrors.push(String(e)));
    p.on('console', m => report.console.push({ type: m.type(), text: m.text() }));
    p.on('requestfailed', r => report.failedRequests.push({ url: r.url(), failure: r.failure() }));
    p.on('crash', () => report.rendererErrors.push('renderer crash'));
  };
  context.on('page', observe);
  for (const p of context.pages()) observe(p);
  page = app ? await app.firstWindow({ timeout: 30000 }) : context.pages()[0] || await context.waitForEvent('page', { timeout: 30000 });
  page.setDefaultTimeout(15000);
  // Let the original initial scan finish before a renderer reload; do not pile
  // two scans onto a 2 GiB guest. Reload captures initial JS/preload diagnostics.
  const readyStarted = Date.now();
  await page.getByTestId('pack-card-cursor').waitFor({ timeout: 90000 });
  report.initialUiReadyMs = Date.now() - readyStarted;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('pack-card-cursor').waitFor({ timeout: 90000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="pack-card-"]').length === 9);
  report.pageURL = page.url();
  check('packaged renderer URL', /app\.asar\/dist-electron\/index\.html/.test(page.url()));
  const hub = await page.evaluate(() => window.dango.load());
  report.hub = hub;
  check('core app version', hub.appVersion === expectedAppVersion, hub.appVersion);
  check('nine expected resource IDs', JSON.stringify(hub.packs.map(p => p.id).sort()) === JSON.stringify(ids), hub.packs.map(p => p.id));
  check('no migrated root/activity', hub.root === null && hub.activity.length === 0 && hub.lastScanAt === null);
  check('fresh userDir', nativePath(hub.userDir).startsWith(out + '/'), { appPath: hub.userDir, nativePath: nativePath(hub.userDir) });
  check('embedded resources available', hub.hasEmbedded && /resources[/\\]packs$/.test(hub.embeddedRoot), hub.embeddedRoot);
  const detect = await page.evaluate(() => window.dango.detect());
  report.detect = detect;
  const packRoot = path.join(staged, 'resources/packs');
  const resourceNames = fs.readdirSync(packRoot, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
  check('resources contain exactly six allowed pack directories', JSON.stringify(resourceNames) === JSON.stringify([...allowed].sort()), resourceNames);
  for (const id of blocked) check(`${id}: retired pack absent from real resources`, !fs.existsSync(path.join(packRoot, id)));
  for (const p of hub.packs) {
    check(`${p.id}: exact IPC and UI card name`, p.name === names[p.id] && (await page.getByTestId(`pack-card-${p.id}`).locator('.pack-name').innerText()) === names[p.id]);
  }
  // Wait for the UI's own detection promise, not just our independent IPC call.
  await page.waitForFunction(() => document.querySelector('[data-testid="install-cursor"]')?.disabled === false);
  for (const id of allowed) {
    const p = hub.packs.find(p => p.id === id);
    check(`${id}: found embedded source`, p.found && p.source === 'embedded' && !p.blockedReason && p.fileCount > 0, { name: p.name, fileCount: p.fileCount, source: p.source });
    check(`${id}: embedded UI label`, (await page.getByTestId(`source-${id}`).innerText()) === '内嵌');
    check(`${id}: exact embedded resource path`, nativePath(p.path) === path.join(packRoot, id));
    check(`${id}: no missing expected entries or scan warnings`, p.missingEntries.length === 0 && p.warnings.length === 0, { missingEntries: p.missingEntries, warnings: p.warnings });
    const buttons = {
      installEnabled: await page.getByTestId(`install-${id}`).isEnabled(),
      uninstallEnabled: await page.getByTestId(`uninstall-${id}`).isEnabled(),
      monitorEnabled: await page.getByTestId(`deep-verify-btn-${id}`).isEnabled(),
      hasInstall: detect.plans[id].hasInstall, hasUninstall: detect.plans[id].hasUninstall
    };
    report.buttonStates[id] = buttons;
    check(`${id}: allowed install enabled, not clicked`, buttons.hasInstall && buttons.installEnabled, buttons);
    check(`${id}: allowed monitor enabled, not clicked`, buttons.monitorEnabled);
    check(`${id}: uninstall state matches actual plan, not clicked`, buttons.uninstallEnabled === buttons.hasUninstall, buttons);
    for (const relative of nested[id] || []) {
      const record = { id, relative, exists: fs.existsSync(path.join(packRoot, id, relative)), reportedMissing: p.missingEntries.includes(relative) };
      report.nestedPathsFixed.push(record);
      check(`${id}: fixed nested expected entry ${relative}`, record.exists && !record.reportedMissing, record);
    }
  }
  for (const id of blocked) {
    const p = hub.packs.find(p => p.id === id);
    check(`${id}: quarantine resource state`, !p.found && p.source === 'quarantined' && p.path === null && p.fileCount === 0 && Boolean(p.blockedReason));
    // v1.5.6: consent-required, not hard-quarantined. Fresh state has no consent,
    // so the badge, the consent box and the block notice must all still say so.
    check(`${id}: reported as consent-required and not yet consented`, p.consentRequired === true && p.consented === false, { consentRequired: p.consentRequired, consented: p.consented });
    check(`${id}: quarantine labels`, (await page.getByTestId(`pack-card-${id}`).innerText()).includes('已隔离 · 只读') && await page.getByTestId(`quarantine-${id}`).count() === 1);
    check(`${id}: consent box with the exact persisted label`, await page.getByTestId(`consent-${id}`).count() === 1 && (await page.getByTestId(`consent-${id}`).innerText()).includes('该载荷已隔离 · 需勾选知情同意') && (await page.getByTestId(`consent-${id}`).innerText()).includes('我知晓 同意'));
    check(`${id}: consent checkbox present and unchecked`, await page.getByTestId(`consent-check-${id}`).count() === 1 && !(await page.getByTestId(`consent-check-${id}`).isChecked()));
    for (const prefix of ['install', 'uninstall', 'deep-verify-btn']) check(`${id}: disabled ${prefix}`, await page.getByTestId(`${prefix}-${id}`).isDisabled());
    report.buttonStates[id] = { installEnabled: false, uninstallEnabled: false, monitorEnabled: false, blockedReason: p.blockedReason, consentRequired: true, consented: false };
    check(`${id}: disabled main-process plan`, !detect.plans[id].hasInstall && !detect.plans[id].hasUninstall && Boolean(detect.plans[id].blockedReason) && detect.plans[id].consentRequired === true && detect.plans[id].consented === false);
  }
  await screenshot('01-toolbox-top');
  await page.getByTestId('pack-card-anti-gravity').scrollIntoViewIfNeeded();
  await screenshot('02-toolbox-bottom');
  // An actual UI filter also makes all three quarantine labels readable together.
  await page.getByTestId('search-input').fill('codex');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="pack-card-"]').length === 2);
  await screenshot('03-toolbox-search-codex');
  await page.getByTestId('search-input').fill('');
  await page.getByTestId('filter-found').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="pack-card-"]').length === 6);
  check('toolbox found filter shows six', await page.locator('[data-testid^="pack-card-"]').count() === 6);
  await screenshot('04-toolbox-found');
  await page.getByTestId('filter-all').click();
  for (const id of Object.keys(nested)) {
    await page.getByTestId(`pack-card-${id}`).locator('.pack-name').click();
    const detail = page.getByTestId('pack-detail-modal');
    await detail.waitFor();
    check(`${id}: corrected detail has no missing-item tags`, await detail.locator('.entry.missing').count() === 0);
    check(`${id}: corrected detail has no false missing warning`, !(await detail.innerText()).includes('缺失'));
    check(`${id}: detail install and monitor enabled, not clicked`, await page.getByTestId('detail-install').isEnabled() && await page.getByTestId('detail-deep-verify').isEnabled());
    await screenshot('05-fixed-detail-' + id);
    await detail.locator('.entry-list').scrollIntoViewIfNeeded();
    await screenshot('06-fixed-entries-' + id);
    await page.getByTestId('detail-close').click();
  }
  for (const id of blocked) {
    await page.getByTestId(`pack-card-${id}`).locator('.pack-name').click();
    await page.getByTestId('pack-detail-modal').waitFor();
    const detailText = await page.getByTestId('pack-detail-modal').innerText();
    check(`${id}: detail quarantine warning`, detailText.includes('已隔离 · 载荷操作禁用'));
    check(`${id}: detail consent box mirrors the card`, detailText.includes('该载荷已隔离 · 需勾选知情同意') && detailText.includes('我知晓 同意') && await page.getByTestId(`detail-quarantine-${id}`).count() === 1 && !(await page.getByTestId(`detail-consent-check-${id}`).isChecked()));
    for (const tid of ['detail-install', 'detail-uninstall', 'detail-deep-verify', 'detail-capture', 'detail-verify']) check(`${id}: disabled ${tid}`, await page.getByTestId(tid).isDisabled());
    await screenshot('05-detail-' + id);
    await page.getByTestId('detail-deep-verify').scrollIntoViewIfNeeded();
    await screenshot('06-detail-actions-' + id);
    await page.getByTestId('detail-close').click();
  }
  // Only quarantine IPC, with the real preload and registered main handlers.
  // assertPackAllowed precedes all actions in these packaged handlers.
  const targetsBefore = targetSnapshot();
  await page.evaluate(() => {
    window.__guiSmokeEvents = { logs: [], progress: [] };
    window.dango.onLog(x => window.__guiSmokeEvents.logs.push(x));
    window.dango.onProgress(x => window.__guiSmokeEvents.progress.push(x));
  });
  for (const id of blocked) {
    for (const [method, args] of [['deploy', [id, 'install']], ['deploy', [id, 'uninstall']], ['verifyDeep', [id]]]) {
      assert(blocked.includes(id));
      const result = await page.evaluate(async ({ method, args }) => {
        try { return { rejected: false, value: await window.dango[method](...args) }; }
        catch (e) { return { rejected: true, error: String(e.message || e) }; }
      }, { method, args });
      report.quarantineIPC.push({ id, method, args, ...result });
      const exactPolicy = hub.packs.find(p => p.id === id).blockedReason;
      check(`${id}: real IPC rejects ${method} ${args[1] || ''}`, result.rejected && result.error.includes(exactPolicy));
    }
  }
  const hubAfter = await page.evaluate(() => window.dango.load());
  report.quarantineEvents = await page.evaluate(() => window.__guiSmokeEvents);
  check('quarantine: zero log/progress action events', report.quarantineEvents.logs.length === 0 && report.quarantineEvents.progress.length === 0, report.quarantineEvents);
  check('quarantine: no activity/state changes', JSON.stringify(hubAfter.activity) === JSON.stringify(hub.activity) && hubAfter.lastScanAt === hub.lastScanAt);
  check('quarantine: no target writes', JSON.stringify(targetSnapshot()) === JSON.stringify(targetsBefore));
  const userDirNative = nativePath(hub.userDir);
  check('no backups/imports/baselines/library injection state', ['backups', 'imported-packs', 'baselines', 'library-injections.json', 'state.json'].every(n => !fs.existsSync(path.join(userDirNative, n))));

  await page.getByTestId('nav-library').click();
  await page.getByTestId('library-view').waitFor();
  const library = await page.evaluate(() => window.dango.libraryList());
  report.library = { ...library, prompts: library.prompts.map(p => ({ index: p.index, name: p.name, has_full: p.has_full })) };
  check('actual bundled library has exactly 3134 entries', library.ok && library.source === 'bundle' && library.fullText && library.total === 3134 && library.prompts.length === 3134);
  check('library resource root is final staged resource', nativePath(library.dir) === path.join(staged, 'resources/library'));
  await page.getByTestId('lib-search').fill('__isolated_gui_no_matching_entry_155__');
  await page.getByTestId('lib-empty').waitFor();
  check('library search empty-state rendered', (await page.getByTestId('lib-empty').innerText()).includes('没有匹配的词条'));
  await screenshot('07-library-search-empty');
  await page.getByTestId('lib-search').fill('');
  await sleep(800);
  if (library.prompts.length) {
    const detailButton = page.locator('[data-testid^="lib-detail-"]').first();
    await detailButton.waitFor();
    const index = Number((await detailButton.getAttribute('data-testid')).replace('lib-detail-', ''));
    const selected = library.prompts.find(p => p.index === index);
    assert(selected);
    await page.getByTestId('lib-search').fill(selected.name);
    await page.getByTestId(`lib-card-${index}`).waitFor();
    await sleep(400);
    check('library positive name search returns selected real entry', await page.getByTestId(`lib-card-${index}`).isVisible());
    await screenshot('08-library-search-match');
    await page.getByTestId(`lib-detail-${index}`).click();
    await page.getByTestId('lib-detail-modal').waitFor();
    await page.locator('.lib-detail-content').waitFor({ timeout: 25000 });
    check('library details are plaintext only', await page.locator('.lib-detail-content').evaluate(e => e.tagName === 'PRE' && e.children.length === 0));
    const text = await page.locator('.lib-detail-content').textContent();
    const bundled = JSON.parse(fs.readFileSync(path.join(staged, 'resources/library/library.json'), 'utf8')).prompts[index];
    check('detail text equals actual bundled plaintext', typeof bundled.content === 'string' && text === bundled.content, { index, name: selected.name, characters: text.length });
    report.library.selectedDetail = { index, name: selected.name, characters: text.length, sha256: crypto.createHash('sha256').update(text).digest('hex') };
    await screenshot('08-library-plaintext-detail');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  } else {
    check('actual empty bundled library', library.total === 0 && await page.getByTestId('lib-empty').isVisible(), { ok: library.ok, source: library.source });
    report.library.details = 'Not available: actual packaged snapshot has zero entries; no synthetic/imported data added.';
    await screenshot('08-library-actual-empty');
  }
  await page.getByTestId('lib-tab-guide').click();
  await page.getByTestId('lib-guide').waitFor();
  await screenshot('09-library-guide');
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-reduced-motion').waitFor();
  const settings = await page.locator('main').innerText();
  check('settings shows isolated userData and consent policy', settings.includes(hub.userDir) && settings.includes('我知晓 同意') && settings.includes('claude'));
  await page.getByTestId('settings-reduced-motion').click();
  check('settings reduced-motion toggles', (await page.getByTestId('settings-reduced-motion').innerText()).includes('已开启'));
  await screenshot('10-settings');
  await page.getByTestId('nav-activity').click();
  await screenshot('11-activity');
  await page.getByTestId('nav-toolbox').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="pack-card-"]').length === 9);
  check('return to toolbox retains nine cards', await page.locator('[data-testid^="pack-card-"]').count() === 9);
  check('no target writes across whole UI test', JSON.stringify(targetSnapshot()) === JSON.stringify(baselineTargets));
  check('no action state after full UI navigation', ['backups', 'imported-packs', 'baselines', 'library-injections.json', 'state.json'].every(n => !fs.existsSync(path.join(userDirNative, n))));
  check('no renderer uncaught errors/crashes', report.rendererErrors.length === 0, report.rendererErrors);
  check('no renderer console errors', report.console.every(m => m.type !== 'error'), report.console);

  // ---- v1.5.6: Claude card + consent round trip -------------------------
  // This is the only section that intentionally writes, and it writes only to
  // the isolated userDir's state.json. No install/uninstall/deep-verify runs:
  // after a successful consent grant we immediately revoke and re-assert the
  // fail-closed state, then confirm the file holds an empty consent register.
  const claude = hub.packs.find(p => p.id === 'claude');
  const claudeDetect = detect.plans.claude;
  check('claude: embedded release pack, deployable', Boolean(claude) && claude.found && claude.source === 'embedded' && !claude.blockedReason && claude.fileCount > 0, { name: claude?.name, fileCount: claude?.fileCount, source: claude?.source });
  check('claude: real embedded pack version', claude.version === '2.3.6', claude.version);
  check('claude: not a consent pack', claude.consentRequired !== true);
  check('claude: no consent affordance rendered', await page.getByTestId('consent-claude').count() === 0 && await page.getByTestId('quarantine-claude').count() === 0);
  check('claude: exact embedded resource path', nativePath(claude.path) === path.join(packRoot, 'claude'));
  check('claude: direct install-claude.py plan', claudeDetect.hasInstall && claudeDetect.hasUninstall && claudeDetect.installFile === 'install-claude.py' && claudeDetect.uninstallFile === 'install-claude.py');
  check('claude: install enabled, not clicked', await page.getByTestId('install-claude').isEnabled() && await page.getByTestId('deep-verify-btn-claude').isEnabled());
  await screenshot('12-claude-card');

  const consentProbe = blocked[0];
  report.consentRoundTrip = [];
  for (const granted of [true, false]) {
    const nextHub = await page.evaluate(({ id, granted }) => window.dango.setConsent(id, granted), { id: consentProbe, granted });
    const nextDetect = await page.evaluate(() => window.dango.detect());
    const p = nextHub.packs.find(p => p.id === consentProbe);
    const plan = nextDetect.plans[consentProbe];
    report.consentRoundTrip.push({ granted, consented: p.consented, blocked: Boolean(p.blockedReason), hasInstall: plan.hasInstall, installFile: plan.installFile, consents: nextHub.consents });
    if (granted) {
      check(`${consentProbe}: consent unlocks hub state`, p.consentRequired === true && p.consented === true && !p.blockedReason && (nextHub.consents || []).includes(consentProbe));
      check(`${consentProbe}: consent unlocks the real main-process plan`, plan.hasInstall && plan.hasUninstall && plan.consented === true && !plan.blockedReason, plan);
      check(`${consentProbe}: legacy script retained after unlock`, plan.installFile === 'install-replica.ps1', plan.installFile);
      check(`${consentProbe}: badge switches to unlocked`, (await page.getByTestId(`pack-card-${consentProbe}`).innerText()).includes('隔离已解锁'));
      check(`${consentProbe}: block notice disappears`, await page.getByTestId(`quarantine-${consentProbe}`).count() === 0 && await page.getByTestId(`consent-check-${consentProbe}`).isChecked());
    } else {
      check(`${consentProbe}: revoke restores fail-closed`, Boolean(p.blockedReason) && p.consented === false && !plan.hasInstall && !plan.hasUninstall && Boolean(plan.blockedReason));
      check(`${consentProbe}: revoke restores the badge and block notice`, (await page.getByTestId(`pack-card-${consentProbe}`).innerText()).includes('已隔离 · 只读') && await page.getByTestId(`quarantine-${consentProbe}`).count() === 1 && !(await page.getByTestId(`consent-check-${consentProbe}`).isChecked()));
    }
  }
  check('consent: only the quarantined id can be granted', Boolean((await page.evaluate(() => window.dango.setConsent('claude', true).then(() => null, e => String(e.message || e)))).includes('该包不属于隔离载荷')));
  const stateFile = path.join(userDirNative, 'state.json');
  const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  check('consent: persisted register ends empty and names no payload', JSON.stringify(persisted.consents || {}) === '{}' && !JSON.stringify(persisted.consents || {}).includes('slo-runtime-hook'));
  check('consent: no target writes from the round trip', JSON.stringify(targetSnapshot()) === JSON.stringify(baselineTargets));
  check('consent: no install/backup side effects', ['backups', 'imported-packs', 'baselines', 'library-injections.json'].every(n => !fs.existsSync(path.join(userDirNative, n))));
  check('no renderer uncaught errors/crashes after consent flow', report.rendererErrors.length === 0, report.rendererErrors);
  report.status = 'PASS';
}

(async () => {
  try { await run(); }
  catch (e) {
    report.status = 'FAIL';
    report.error = String(e.stack || e);
    if (page) await screenshot('failure').catch(() => {});
    process.exitCode = 1;
  } finally {
    if (app) await app.close().catch(e => { report.closeError = String(e); });
    if (browser) await browser.close().catch(() => {});
    if (wine?.pid) { try { process.kill(-wine.pid, 'SIGTERM'); } catch {} }
    report.finishedAt = new Date().toISOString();
    write('report.json', report);
    console.log(JSON.stringify({ status: report.status, mode, checks: report.checks.length, error: report.error, report: path.join(out, 'report.json') }));
  }
})();
