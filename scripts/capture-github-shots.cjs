'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const distIndex = path.join(root, 'dist-electron', 'index.html');
const outDir = path.join(root, 'docs', 'screenshots');

if (!fs.existsSync(distIndex)) {
  console.error('missing dist-electron/index.html');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const shots = {
  toolbox: path.join(outDir, 'toolbox.png'),
  library: path.join(outDir, 'library.png'),
  settings: path.join(outDir, 'settings.png'),
  import: path.join(outDir, 'import.png'),
  detail: path.join(outDir, 'pack-detail.png'),
  verify: path.join(outDir, 'deep-verify.png'),
  embedded: path.join(outDir, 'embedded.png'),
  workbuddyAi: path.join(outDir, 'workbuddy-ai.png'),
};

(async () => {
  const { _electron } = require('playwright');
  const env = { ...process.env, DANGO_NO_SANDBOX: '1' };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await _electron.launch({
    args: [root, '--clean'],
    env,
    timeout: 45000,
  });
  const win = await app.firstWindow({ timeout: 45000 });
  await win.waitForLoadState('domcontentloaded');
  await win.locator('[data-testid="pack-grid"]').waitFor({ timeout: 25000 });
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return;
    w.setSize(1480, 1280);
    w.center();
  });
  await win.waitForTimeout(800);

  const n = await win.locator('[data-testid^="pack-card-"]').count();
  const body = await win.locator('body').innerText();
  console.log('cards', n);
  console.log('hero-stat', (body.match(/\d+\/\d+/) || ['?'])[0]);

  await win.screenshot({ path: shots.toolbox, animations: 'disabled' });
  fs.copyFileSync(shots.toolbox, shots.embedded);

  const wbai = win.locator('[data-testid="pack-card-workbuddy-ai"]');
  if (await wbai.count()) {
    await wbai.scrollIntoViewIfNeeded();
    await wbai.screenshot({ path: shots.workbuddyAi, animations: 'disabled' });
  }

  await win.locator('[data-testid="nav-library"]').click();
  await win.locator('[data-testid="library-view"]').waitFor({ timeout: 15000 });
  await win.waitForTimeout(500);
  await win.screenshot({ path: shots.library, animations: 'disabled' });

  await win.locator('[data-testid="nav-settings"]').click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: shots.settings, animations: 'disabled' });

  await win.locator('[data-testid="nav-toolbox"]').click();
  await win.locator('[data-testid="pack-grid"]').waitFor({ timeout: 10000 });
  await win.locator('[data-testid="open-import"]').click();
  await win.locator('[data-testid="import-modal"]').waitFor({ timeout: 8000 });
  await win.waitForTimeout(300);
  await win.screenshot({ path: shots.import, animations: 'disabled' });
  await win.locator('[data-testid="import-modal"] .modal-close').click();
  await win.locator('[data-testid="import-modal"]').waitFor({ state: 'detached', timeout: 8000 });

  await win.locator('[data-testid="pack-card-anti-gravity"] h3').click();
  await win.locator('[data-testid="pack-detail-modal"]').waitFor({ timeout: 8000 });
  await win.waitForTimeout(300);
  await win.screenshot({ path: shots.detail, animations: 'disabled' });
  await win.locator('[data-testid="detail-close"]').click();
  await win.locator('[data-testid="pack-detail-modal"]').waitFor({ state: 'detached', timeout: 8000 });

  await win.locator('[data-testid="deep-verify-btn-codex"]').click();
  await win.locator('[data-testid="deep-verify-modal"]').waitFor({ timeout: 20000 });
  await win.locator('[data-testid="v2-layer-L1"]').waitFor({ timeout: 45000 });
  await win.waitForTimeout(600);
  await win.screenshot({ path: shots.verify, animations: 'disabled' });

  await app.close();

  for (const [k, p] of Object.entries(shots)) {
    const ok = fs.existsSync(p) && fs.statSync(p).size > 8000;
    console.log((ok ? 'ok   ' : 'FAIL ') + k + ' ' + (ok ? fs.statSync(p).size : 0));
    if (!ok) process.exitCode = 1;
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
