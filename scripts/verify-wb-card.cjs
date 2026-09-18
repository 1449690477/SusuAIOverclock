'use strict';
const path = require('node:path');
const root = path.join(__dirname, '..');
const exe = path.join(root, 'release', 'win-unpacked', '苏苏 AI超频.exe');
const shot = path.join(root, 'release', 'verify-1.5.1-workbuddy-card.png');

(async () => {
  const { _electron } = require('playwright-core');
  const env = { ...process.env, DANGO_NO_SANDBOX: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: exe, env, timeout: 45000 });
  const win = await app.firstWindow({ timeout: 45000 });
  await win.waitForLoadState('domcontentloaded');
  const card = win.locator('[data-testid="pack-card-workbuddy"]');
  await card.waitFor({ timeout: 25000 });
  await card.scrollIntoViewIfNeeded();
  const text = await card.innerText();
  await card.screenshot({ path: shot });
  await app.close();
  console.log(text);
  console.log('screenshot ' + shot);
  if (!/4\.4/.test(text)) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
