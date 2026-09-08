/**
 * 打包产物内嵌开箱即用验证。
 * 与 dev 态冒烟不同：这里走 process.resourcesPath/packs 解析路径，
 * 直接拉起 release/win-unpacked 里的真实 exe，确认无 root 时内嵌六卡可用。
 * 用法：env -u ELECTRON_RUN_AS_NODE DANGO_NO_SANDBOX=1 node tests/verify-unpacked.mjs
 */
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const unpacked = path.join(appDir, 'release', 'win-unpacked');

if (!fs.existsSync(unpacked)) {
  console.error('找不到 release/win-unpacked，请先打包');
  process.exit(1);
}
const exe = fs.readdirSync(unpacked).find((f) => f.endsWith('.exe') && !/uninstall/i.test(f));
if (!exe) {
  console.error('win-unpacked 里没有可执行 exe');
  process.exit(1);
}
const exePath = path.join(unpacked, exe);
console.log('验证打包产物:', exe);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.DANGO_NO_SANDBOX = '1';

const app = await electron.launch({ executablePath: exePath, args: ['--clean'], env });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.locator('[data-testid="pack-grid"]').waitFor({ timeout: 30000 });

const cards = win.locator('[data-testid^="pack-card-"]');
const n = await cards.count();
console.log('卡片数:', n);

const ids = ['codex', 'cursor', 'dsh', 'opencode', 'workbuddy', 'anti-gravity'];
let emb = 0;
for (const id of ids) {
  const b = win.locator(`[data-testid="source-${id}"]`);
  const t = (await b.count()) ? (await b.innerText()).trim() : '(无徽章)';
  console.log(`  ${id}: source="${t}"`);
  if (t.includes('内嵌')) emb++;
}
console.log('内嵌命中:', emb, '/6');

const shot = path.join(appDir, 'release', 'verify-unpacked.png');
await win.screenshot({ path: shot });
console.log('截图:', shot);

await app.close();
const ok = n === 6 && emb === 6;
console.log(ok ? 'PASS 打包产物内嵌开箱即用验证通过' : 'FAIL 验证失败');
process.exit(ok ? 0 : 1);
