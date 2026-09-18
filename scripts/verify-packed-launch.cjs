'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const unpacked = path.join(root, 'release', 'win-unpacked');
const exes = fs.readdirSync(unpacked).filter((n) => n.toLowerCase().endsWith('.exe') && !n.toLowerCase().includes('elevate'));
if (exes.length !== 1) {
  console.error('expected 1 app exe, got', exes);
  process.exit(1);
}
const exe = path.join(unpacked, exes[0]);
const shot = path.join(root, 'release', 'verify-1.5.4-launch.png');

(async () => {
  const { _electron } = require('playwright-core');
  const env = { ...process.env, DANGO_NO_SANDBOX: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: exe,
    env,
    timeout: 45000,
  });
  const win = await app.firstWindow({ timeout: 45000 });
  await win.waitForLoadState('domcontentloaded');
  await win.locator('[data-testid="pack-grid"]').waitFor({ timeout: 25000 });
  const title = await win.title();
  const n = await win.locator('[data-testid^="pack-card-"]').count();
  const body = await win.locator('body').innerText();
  await win.screenshot({ path: shot });
  const agCard = win.locator('[data-testid="pack-card-anti-gravity"]');
  const agShot = path.join(root, 'release', 'verify-1.5.4-antigravity-card.png');
  if (await agCard.count()) {
    await agCard.scrollIntoViewIfNeeded();
    await agCard.screenshot({ path: agShot });
  }
  const cursorCard = win.locator('[data-testid="pack-card-cursor"]');
  const cursorShot = path.join(root, 'release', 'verify-1.5.4-cursor-card.png');
  if (await cursorCard.count()) {
    await cursorCard.scrollIntoViewIfNeeded();
    await cursorCard.screenshot({ path: cursorShot });
  }
  const wbaiCard = win.locator('[data-testid="pack-card-workbuddy-ai"]');
  const wbaiShot = path.join(root, 'release', 'verify-1.5.4-workbuddy-ai-card.png');
  if (await wbaiCard.count()) {
    await wbaiCard.scrollIntoViewIfNeeded();
    await wbaiCard.screenshot({ path: wbaiShot });
  }
  await app.close();

  const checks = [
    ['title', title.includes('苏苏 AI超频') || title.includes('Dango Desk'), title],
    ['eight cards', n === 8, String(n)],
    ['codex card', body.includes('Codex') || body.includes('codex'), ''],
    ['v10.4', /10\.4/.test(body), body.slice(0, 400)],
    ['workbuddy v4.4', /4\.4/.test(body) && /WorkBuddy|workbuddy/i.test(body), body.slice(0, 400)],
    ['anti-gravity v3.2', /3\.2/.test(body) && /反重力|Antigravity|anti-gravity/i.test(body), body.slice(0, 400)],
    ['cursor v1.2', /1\.2/.test(body) && /Cursor|cursor/i.test(body), body.slice(0, 400)],
    ['workbuddy-ai v1.3', /1\.3/.test(body) && /WorkBuddy AI|国际版|workbuddy-ai/i.test(body), body.slice(0, 400)],
    ['app 1.5.4', /1\.5\.4/.test(title) || /1\.5\.4/.test(body), title],
  ];
  let fail = 0;
  for (const [name, ok, extra] of checks) {
    console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? ' — ' + String(extra).replace(/\s+/g, ' ').slice(0, 180) : ''));
    if (!ok) fail++;
  }
  console.log('screenshot ' + shot);
  console.log('ag-card ' + agShot);
  console.log('cursor-card ' + cursorShot);
  console.log('wbai-card ' + wbaiShot);
  console.log('exe ' + exe);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
