/**
 * 实机截图：深度验证弹窗 + 控制台可爱化
 */
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
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

// 打开 codex 详情，触发深度验证
await win.locator('[data-testid="pack-card-codex"]').click();
await win.locator('[data-testid="pack-detail-modal"]').waitFor({ timeout: 8000 });
await win.locator('[data-testid="detail-deep-verify"]').click();

// 深度验证弹窗，等 L1 层渲染出来
await win.locator('[data-testid="deep-verify-modal"]').waitFor({ timeout: 10000 });
await win.locator('[data-testid="v2-layer-L1"]').waitFor({ timeout: 60000 });
await win.waitForTimeout(1200);

fs.mkdirSync(path.join(appDir, 'release'), { recursive: true });
await win.screenshot({ path: path.join(appDir, 'release', 'shot-deep.png') });
console.log('已截图 shot-deep.png（深度验证弹窗）');

// 关掉弹窗，打开控制台看可爱化终端
await win.locator('[data-testid="deep-verify-modal"] .modal-close').click().catch(() => {});
await win.locator('[data-testid="detail-close"]').click().catch(() => {});
await win.locator('[data-testid="toggle-console"]').click();
await win.waitForTimeout(600);
await win.screenshot({ path: path.join(appDir, 'release', 'shot-console.png') });
console.log('已截图 shot-console.png（控制台可爱化）');

await app.close();
console.log('done');
