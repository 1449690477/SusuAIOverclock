import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const root = process.argv[2] || process.env.DANGO_ROOT || '';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.DANGO_NO_SANDBOX = '1';

const app = await electron.launch({ args: [appDir, '--root', root], env });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.locator('[data-testid="pack-grid"]').waitFor({ timeout: 15000 });

// 打开控制台
await win.locator('[data-testid="toggle-console"]').click();
await win.locator('[data-testid="console-panel"]').waitFor({ timeout: 8000 });

// 触发一次深度验证让终端出几行真实输出
await win.evaluate(() => window.dango.verifyDeep('codex')).catch(() => {});
// 关闭控制台以便完整展示六张卡片与所有新Logo
const consoleVisible = await win.locator('[data-testid="console-panel"]').count();
if (consoleVisible) {
  await win.locator('[data-testid="toggle-console"]').click().catch(() => {});
  await win.waitForTimeout(400);
}

await win.screenshot({ path: path.join(appDir, 'release', 'shot-console.png') });
console.log('shot-console.png');
await app.close();
