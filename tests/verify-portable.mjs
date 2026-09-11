/**
 * portable exe 内嵌开箱即用验证（自解压壳，与 win-unpacked 路径不同，必须单独验证）。
 * 用法：env -u ELECTRON_RUN_AS_NODE DANGO_NO_SANDBOX=1 node tests/verify-portable.mjs [exe路径]
 */
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const releaseDir = path.resolve(appDir, process.env.DANGO_RELEASE_DIR || 'release');

let exePath = process.argv[2];
if (!exePath) {
  const found = fs
    .readdirSync(releaseDir)
    .filter((f) => f.endsWith('.exe') && /portable/i.test(f))
    .sort()
    .pop();
  if (!found) {
    console.error('release 下没有 portable exe，请先打包或传路径参数');
    process.exit(1);
  }
  exePath = path.join(releaseDir, found);
}
console.log('拉起 portable exe（自解压需数秒）:', path.basename(exePath));

const tempLocalAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'dango-portable-appdata-'));
const env = { ...process.env, LOCALAPPDATA: tempLocalAppData };
delete env.ELECTRON_RUN_AS_NODE;
env.DANGO_NO_SANDBOX = '1';

const version = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
const cacheDir = path.join(tempLocalAppData, 'SusuAIOverclock-cache', version);
const cachedExe = path.join(cacheDir, '苏苏 AI超频.exe');
const cacheMarker = path.join(cacheDir, '.cache-complete');
const portable = spawn(exePath, ['--clean'], { env, windowsHide: true });

const deadline = Date.now() + 180000;
while (Date.now() < deadline && !fs.existsSync(cacheMarker)) {
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!fs.existsSync(cacheMarker) || !fs.existsSync(cachedExe)) {
  try { execFileSync('taskkill', ['/PID', String(portable.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  fs.rmSync(tempLocalAppData, { recursive: true, force: true });
  console.error('portable 自解压未在 180 秒内完成');
  process.exit(1);
}

// The portable wrapper waits for the child Electron process. Kill that process
// tree after extraction, then attach Playwright to the extracted real binary.
try { execFileSync('taskkill', ['/PID', String(portable.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}

const app = await electron.launch({ executablePath: cachedExe, args: ['--clean'], env });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.locator('[data-testid="pack-grid"]').waitFor({ timeout: 60000 });

const n = await win.locator('[data-testid^="pack-card-"]').count();
console.log('卡片数:', n);

const ids = ['codex', 'codex-panghu', 'cursor', 'dsh', 'opencode', 'workbuddy', 'anti-gravity'];
let emb = 0;
for (const id of ids) {
  const b = win.locator(`[data-testid="source-${id}"]`);
  const t = (await b.count()) ? (await b.innerText()).trim() : '(无)';
  if (t.includes('内嵌')) emb++;
  console.log(`  ${id}: source="${t}"`);
}
console.log('内嵌命中:', emb, '/7');

const shot = path.join(releaseDir, 'verify-portable.png');
await win.screenshot({ path: shot });
console.log('截图:', shot);

await app.close();
fs.rmSync(tempLocalAppData, { recursive: true, force: true });
const ok = n === 7 && emb === 7;
console.log(ok ? 'PASS portable exe 内嵌开箱即用验证通过' : 'FAIL 验证失败');
process.exit(ok ? 0 : 1);
