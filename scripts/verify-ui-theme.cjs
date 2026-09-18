'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const electronPath = require('electron');
const outDir = path.join(root, 'release');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const { _electron } = require('playwright-core');
  const env = { ...process.env, DANGO_NO_SANDBOX: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [root],
    cwd: root,
    env,
    timeout: 45000,
  });
  const win = await app.firstWindow({ timeout: 45000 });
  await win.waitForLoadState('domcontentloaded');
  await win.locator('[data-testid="pack-grid"]').waitFor({ timeout: 35000 });
  await win.waitForTimeout(400);

  const shots = [];
  const shot = async (name) => {
    const file = path.join(outDir, name);
    await win.screenshot({ path: file });
    shots.push(file);
  };

  await shot('verify-ui-toolbox.png');
  await win.waitForTimeout(1600);
  await shot('verify-ui-toolbox-t1.png');
  await win.waitForTimeout(1600);
  await shot('verify-ui-toolbox-t2.png');

  const card = win.locator('[data-testid="pack-card-anti-gravity"]');
  if (await card.count()) {
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: path.join(outDir, 'verify-ui-ag-card.png') });
    shots.push(path.join(outDir, 'verify-ui-ag-card.png'));
    await card.hover();
    await win.waitForTimeout(350);
    await card.screenshot({ path: path.join(outDir, 'verify-ui-ag-card-hover.png') });
    shots.push(path.join(outDir, 'verify-ui-ag-card-hover.png'));
  }

  await win.locator('[data-testid="nav-library"]').click();
  await win.waitForTimeout(500);
  await shot('verify-ui-library.png');

  await win.locator('[data-testid="nav-settings"]').click();
  await win.waitForTimeout(400);
  await shot('verify-ui-settings.png');

  await win.locator('[data-testid="nav-toolbox"]').click();
  await win.waitForTimeout(400);
  if (await card.count()) {
    await card.click();
    await win.waitForTimeout(400);
    await shot('verify-ui-modal.png');
  }

  const body = await win.locator('body').innerText();
  await app.close();

  const cssDir = path.join(root, 'dist-electron', 'assets');
  const cssFile = fs.readdirSync(cssDir).find((n) => n.endsWith('.css'));
  const css = fs.readFileSync(path.join(cssDir, cssFile), 'utf8');
  const checks = [
    ['ice token', /--sakura:\s*#6eb4ee/.test(css)],
    ['no cream yellow', !/#fffdf7/.test(css)],
    ['no sakura pink token', !/#ff9fb6/.test(css)],
    ['fx orbs', /\.fx-orb/.test(css)],
    ['sheen keyframes', /@keyframes sheen-slide/.test(css)],
    ['line flow', /@keyframes line-flow/.test(css)],
    ['toolbox shot', fs.existsSync(path.join(outDir, 'verify-ui-toolbox.png'))],
    ['motion t1', fs.existsSync(path.join(outDir, 'verify-ui-toolbox-t1.png'))],
    ['motion t2', fs.existsSync(path.join(outDir, 'verify-ui-toolbox-t2.png'))],
    ['app title', /苏苏 AI超频/.test(body)],
  ];
  let fail = 0;
  for (const [name, ok] of checks) {
    console.log((ok ? 'ok   ' : 'FAIL ') + name);
    if (!ok) fail++;
  }
  for (const s of shots) console.log('shot ' + s);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
