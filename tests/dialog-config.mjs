/**
 * 对话框配置验证：确认 chooseImportPath('file') 真的按"选文件"模式打开。
 * 无法在无头环境真点系统对话框，改为拦截 dialog.showOpenDialog 断言参数。
 * 用法：env -u ELECTRON_RUN_AS_NODE DANGO_NO_SANDBOX=1 node tests/dialog-config.mjs
 */
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');

const fails = [];
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
    fails.push(name);
  }
};

const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dango-home-'));
const fakeAppData = path.join(fakeHome, 'AppData', 'Roaming');
const fakeLocalAppData = path.join(fakeHome, 'AppData', 'Local');
fs.mkdirSync(fakeAppData, { recursive: true });
fs.mkdirSync(fakeLocalAppData, { recursive: true });

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

const app = await electron.launch({ args: [appDir, '--clean'], env });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');

// 在主进程里替换 dialog.showOpenDialog，记录真实收到的参数
await app.evaluate(({ dialog }) => {
  globalThis.__dialogCalls = [];
  dialog.showOpenDialog = async (_winOrOpts, maybeOpts) => {
    const opts = maybeOpts || _winOrOpts;
    globalThis.__dialogCalls.push(opts);
    return { canceled: true, filePaths: [] };
  };
});

console.log('=== chooseImportPath("file") 的对话框参数 ===');
await win.evaluate(() => window.dango.chooseImportPath('file'));
const calls = await app.evaluate(() => globalThis.__dialogCalls);
const fileCall = calls[calls.length - 1];
console.log('  properties:', JSON.stringify(fileCall?.properties));
console.log('  filters:', JSON.stringify(fileCall?.filters?.map((f) => f.name)));
check('选文件模式 properties 只有 openFile', JSON.stringify(fileCall?.properties) === '["openFile"]', JSON.stringify(fileCall?.properties));
check('选文件模式不包含 openDirectory', !fileCall?.properties?.includes('openDirectory'));
check('选文件模式带扩展名过滤器', Array.isArray(fileCall?.filters) && fileCall.filters.length > 0);
const exts = fileCall?.filters?.[0]?.extensions || [];
check('过滤器含 md/mdc/txt', ['md', 'mdc', 'txt'].every((e) => exts.includes(e)), exts.join(','));

console.log('\n=== chooseImportPath("dir") 的对话框参数 ===');
await win.evaluate(() => window.dango.chooseImportPath('dir'));
const calls2 = await app.evaluate(() => globalThis.__dialogCalls);
const dirCall = calls2[calls2.length - 1];
console.log('  properties:', JSON.stringify(dirCall?.properties));
check('选目录模式 properties 只有 openDirectory', JSON.stringify(dirCall?.properties) === '["openDirectory"]', JSON.stringify(dirCall?.properties));

console.log('\n=== UI 层两个按钮都存在 ===');
await win.locator('[data-testid="open-import"]').click();
await win.locator('[data-testid="import-modal"]').waitFor({ timeout: 5000 });
check('有「选择单个规则文件」按钮', (await win.locator('[data-testid="import-choose-file"]').count()) > 0);
check('有「选择包目录」按钮', (await win.locator('[data-testid="import-choose-dir"]').count()) > 0);
check('旧的单一选择按钮已移除', (await win.locator('[data-testid="import-choose"]').count()) === 0);
const shot = path.join(appDir, 'release', 'shot-import-choose.png');
await win.screenshot({ path: shot });
console.log('  截图:', shot);

await app.close();
if (fails.length) {
  console.error(`\n失败 ${fails.length} 项`);
  process.exit(1);
}
console.log('\n对话框配置验证全部通过！');
