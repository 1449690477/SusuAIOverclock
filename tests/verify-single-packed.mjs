/**
 * 打包产物（win-unpacked 真 exe）单文件导入验证。
 * 走 process.resourcesPath/packs 路径，区别于 dev 态，确认打包后功能一致。
 * 用法：env -u ELECTRON_RUN_AS_NODE DANGO_NO_SANDBOX=1 node tests/verify-single-packed.mjs
 */
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const releaseDir = path.resolve(appDir, process.env.DANGO_RELEASE_DIR || 'release');
const unpacked = path.join(releaseDir, 'win-unpacked');

if (!fs.existsSync(unpacked)) {
  console.error('找不到 release/win-unpacked');
  process.exit(1);
}
const exe = fs.readdirSync(unpacked).find((f) => f.endsWith('.exe') && !/uninstall/i.test(f));
const exePath = path.join(unpacked, exe);
console.log('验证产物:', exe);

const fails = [];
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
    fails.push(name);
  }
};

const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dango-home-'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dango-packed-'));
const fakeAppData = path.join(fakeHome, 'AppData', 'Roaming');
const fakeLocalAppData = path.join(fakeHome, 'AppData', 'Local');
fs.mkdirSync(fakeAppData, { recursive: true });
fs.mkdirSync(fakeLocalAppData, { recursive: true });

const ruleFile = path.join(tmp, '破甲规则.md');
fs.writeFileSync(ruleFile, '# 石井协议\n\n冷咖啡 触发。SHIYI 工作约定 v2。\n', 'utf8');
const cursorRule = path.join(tmp, 'my-cursor.md');
fs.writeFileSync(cursorRule, '---\nalwaysApply: true\n---\nCursor Composer 规则\n', 'utf8');

const env = {
  ...process.env,
  HOME: fakeHome,
  USERPROFILE: fakeHome,
  APPDATA: fakeAppData,
  LOCALAPPDATA: fakeLocalAppData,
  CODEX_HOME: path.join(fakeHome, '.codex'),
  DSH_HOME: path.join(fakeHome, '.dsh'),
  WB_HOME: path.join(fakeHome, '.workbuddy')
};
delete env.ELECTRON_RUN_AS_NODE;
env.DANGO_NO_SANDBOX = '1';

const app = await electron.launch({ executablePath: exePath, args: ['--clean'], env });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.locator('[data-testid="pack-grid"]').waitFor({ timeout: 40000 });

console.log('\n=== 打包产物：内嵌七卡 ===');
const n = await win.locator('[data-testid^="pack-card-"]').count();
check('七卡呈现', n === 7, `实际 ${n}`);

console.log('\n=== 打包产物：导入弹窗两个按钮 ===');
await win.locator('[data-testid="open-import"]').click();
await win.locator('[data-testid="import-modal"]').waitFor({ timeout: 8000 });
check('「选择单个规则文件」按钮存在', (await win.locator('[data-testid="import-choose-file"]').count()) > 0);
check('「选择包目录」按钮存在', (await win.locator('[data-testid="import-choose-dir"]').count()) > 0);
await win.screenshot({ path: path.join(releaseDir, 'shot-packed-import.png') });

console.log('\n=== 打包产物：单文件识别 ===');
const det = await win.evaluate((p) => window.dango.analyzeImport(p), ruleFile);
console.log('  破甲规则.md →', JSON.stringify({ kind: det.kind, inputKind: det.inputKind, genericHit: det.genericHit, canPickManually: det.canPickManually }));
check('单文件被识别为 file', det.inputKind === 'file');
check('可手选平台', det.canPickManually === true);

const det2 = await win.evaluate((p) => window.dango.analyzeImport(p), cursorRule);
check('cursor 规则自动识别', det2.kind === 'single' && det2.platform === 'cursor', JSON.stringify(det2.platform));

console.log('\n=== 打包产物：单文件真注入 ===');
const r1 = await win.evaluate(([p, id]) => window.dango.importSingleFile(p, id), [ruleFile, 'codex']);
console.log('  注入 codex →', JSON.stringify(r1));
check('append 注入成功', r1.ok === true);
const agentsMd = path.join(fakeHome, '.codex', 'AGENTS.md');
check('文件落盘', fs.existsSync(agentsMd));
check('含石井协议', fs.existsSync(agentsMd) && fs.readFileSync(agentsMd, 'utf8').includes('石井协议'));

const r2 = await win.evaluate(([p, id]) => window.dango.importSingleFile(p, id), [cursorRule, 'cursor']);
console.log('  注入 cursor →', JSON.stringify(r2));
check('copy 注入成功', r2.ok === true && fs.existsSync(r2.dest));

await app.close();
console.log('\n隔离目录:', fakeHome);
if (fails.length) {
  console.error(`\n失败 ${fails.length} 项`);
  process.exit(1);
}
console.log('\n打包产物单文件导入验证全部通过！');
