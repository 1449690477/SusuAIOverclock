/**
 * 桌面端冒烟测试：真的把 Electron 拉起来，点开界面看。
 * 前置：npm run build（需要 dist-electron/index.html）
 * 用法：node tests/desktop-smoke.mjs [根目录]
 *
 * 验收保障：
 *   1. 阶段一：干净空态冒烟（确保未传入根目录时 100% 出现引导空态）
 *   2. 阶段二：完整六卡片流程（自动探测或使用传入根目录，验证六卡片、部署栏、图标提取、深度验证、设置与清除）
 */

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');

const distIndex = path.join(appDir, 'dist-electron', 'index.html');
if (!fs.existsSync(distIndex)) {
  console.error('缺少 dist-electron/index.html，请先 npm run build');
  process.exit(1);
}

const fails = [];
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
    fails.push(name);
  }
};

async function launchApp(extraArgs = [], envOverrides = {}) {
  const args = [appDir, ...extraArgs];
  const env = { ...process.env, ...envOverrides };
  delete env.ELECTRON_RUN_AS_NODE;
  env.DANGO_NO_SANDBOX = '1';

  const app = await electron.launch({ args, env });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  return { app, win };
}

console.log('========================================');
console.log('=== 阶段一：引导空态冒烟（无内嵌包 · DANGO_NO_EMBEDDED=1） ===');
console.log('========================================');

const { app: app1, win: win1 } = await launchApp(['--clean'], { DANGO_NO_EMBEDDED: '1' });

console.log('\n窗口与标题');
const title1 = await win1.title();
check('标题包含应用名（苏苏 AI超频）', title1.includes('苏苏 AI超频') || title1.includes('Dango Desk'), title1);

console.log('\n苏苏专属头像与右上角可爱跳转胶囊');
check('标题栏有苏苏专属头像/徽章', (await win1.locator('[data-testid="mascot-cat"]').count()) > 0);
check('右上角包含词元喵喵Q群跳转胶囊', (await win1.locator('[data-testid="link-qq"]').count()) > 0);
check('右上角包含苏苏的公益中转跳转胶囊', (await win1.locator('[data-testid="link-wiki"]').count()) > 0);

const emptyGuide = win1.locator('[data-testid="empty-guide"]');
await emptyGuide.waitFor({ timeout: 10000 });
check('显示引导空态容器', (await emptyGuide.count()) > 0);

const bodyText1 = await win1.locator('body').innerText();
check('未传入根目录时显示引导空态', bodyText1.includes('先选一个根目录'));
check('空态包含选择根目录按钮', (await emptyGuide.locator('button').count()) > 0);

const shotEmpty = path.join(appDir, 'release', 'smoke-empty.png');
fs.mkdirSync(path.dirname(shotEmpty), { recursive: true });
await win1.screenshot({ path: shotEmpty });
console.log(`  -> 空态截图已保存：${shotEmpty}`);

await app1.close();
console.log('阶段一测试通过！\n');

console.log('==================================================');
console.log('=== 阶段 1.5：内嵌包开箱即用（无 root · 无参数） ===');
console.log('==================================================');

const { app: app15, win: win15 } = await launchApp(['--clean']);
await win15.locator('[data-testid="pack-grid"]').waitFor({ timeout: 20000 });
const embeddedCards = win15.locator('[data-testid^="pack-card-"]');
const nEmbedded = await embeddedCards.count();
check('无根目录时内嵌包直接呈现六卡', nEmbedded === 6, `实际 ${nEmbedded}`);

const embeddedIds = ['codex', 'cursor', 'dsh', 'opencode', 'workbuddy', 'anti-gravity'];
let embeddedSourceOk = 0;
for (const pid of embeddedIds) {
  const badge = win15.locator(`[data-testid="source-${pid}"]`);
  if ((await badge.count()) > 0 && (await badge.innerText()).includes('内嵌')) embeddedSourceOk++;
}
check('六张卡片来源徽章均为「内嵌」', embeddedSourceOk === 6, `命中 ${embeddedSourceOk}/6`);

const shotEmbedded = path.join(appDir, 'release', 'smoke-embedded.png');
fs.mkdirSync(path.dirname(shotEmbedded), { recursive: true });
await win15.screenshot({ path: shotEmbedded });
console.log(`  -> 内嵌开箱即用截图：${shotEmbedded}`);

await app15.close();
console.log('阶段 1.5 测试通过！\n');

console.log('==============================================');
console.log('=== 阶段二：完整六卡片流程与深度验证冒烟 ===');
console.log('==============================================');

const candidateRoots = [
  process.argv[2],
  process.env.DANGO_ROOT,
  path.resolve(appDir, '..', '新建文件夹'),
  'C:\\Users\\Administrator\\Desktop\\workbuddy-shiyi-pack\\新建文件夹'
];
const validRoot = candidateRoots.find((p) => p && fs.existsSync(p));

if (!validRoot) {
  console.log('  [!] 未找到本地六包根目录，已跳过阶段二卡片测试');
} else {
  console.log(`使用工具包根目录: ${validRoot}`);
  const { app: app2, win: win2 } = await launchApp(['--root', validRoot]);

  console.log('\n六张卡片检查');
  await win2.locator('[data-testid="pack-grid"]').waitFor({ timeout: 15000 });
  const cards = win2.locator('[data-testid^="pack-card-"]');
  const n = await cards.count();
  check('卡片数量为 6', n === 6, `实际 ${n}`);

  const names = await cards.allInnerTexts();
  for (const kw of ['Codex', 'Cursor', 'DSH', 'OpenCode', 'WorkBuddy', '反重力']) {
    check(`存在卡片：${kw}`, names.some((t) => t.includes(kw)));
  }

  console.log('\n目录状态与校验状态分开显示');
  const first = names[0] || '';
  check('卡片同时含「目录已找到/未找到」与基线状态', /目录(已找到|未找到)/.test(first) && /未建立基线|待检查|与基线/.test(first), first.replace(/\n/g, ' | '));

  console.log('\n详情弹窗');
  await cards.first().click();
  await win2.locator('[data-testid="pack-detail-modal"]').waitFor({ timeout: 8000 });
  const modalText = await win2.locator('[data-testid="pack-detail-modal"]').innerText();
  check('详情含「建立基线」按钮', modalText.includes('建立基线'));
  check('详情含「检查变更」按钮', modalText.includes('检查变更'));
  check('详情显示目标平台是否安装', modalText.includes('软件是否安装'));
  check('详情显示破甲是否生效', modalText.includes('破甲是否生效'));
  check('详情含安装破甲按钮', modalText.includes('安装破甲'));
  await win2.locator('[data-testid="detail-close"]').click();
  await win2.locator('[data-testid="pack-detail-modal"]').waitFor({ state: 'detached', timeout: 5000 });
  check('详情可关闭', true);

  console.log('\n部署引擎');
  check('部署栏存在', (await win2.locator('[data-testid="deploy-bar"]').count()) > 0);
  const barText = await win2.locator('[data-testid="deploy-bar"]').innerText();
  check('有一键全部安装', barText.includes('一键全部安装'));
  check('有一键全部卸载', barText.includes('一键全部卸载'));
  check('有重新检测', barText.includes('重新检测'));

  const iconCount = await win2.locator('[data-testid^="pack-icon-"] img').count();
  check('至少 3 个平台取到真实图标', iconCount >= 3, `实际 ${iconCount}`);

  const installBtns = await win2.locator('[data-testid^="install-"]').count();
  check('每张卡片都有安装按钮', installBtns === 6, `实际 ${installBtns}`);

  const verifyBtns = await win2.locator('[data-testid^="deep-verify-btn-"]').count();
  check('每张卡片都有快捷监控按钮', verifyBtns === 6, `实际 ${verifyBtns}`);

  console.log('\n深度验证（codex CLI 通道，真实调用）');
  const deepRes = await win2.evaluate(() => window.dango.verifyDeep('codex'));
  check('返回分层结构', Array.isArray(deepRes.layers) && deepRes.layers.length >= 1);
  check(
    '能定位结果（passAt L4 或 failAt 某层）',
    deepRes.passAt === 'L4' || typeof deepRes.failAt === 'string',
    `passAt=${deepRes.passAt} failAt=${deepRes.failAt}`
  );
  console.log(`  -> passAt=${deepRes.passAt} failAt=${deepRes.failAt}`);
  console.log(`  -> 层级: ${deepRes.layers.map((l) => `${l.layer}:${l.ok ? 'pass' : 'FAIL'}`).join('  ')}`);
  const failedLayer = deepRes.failAt ? deepRes.layers.find((l) => l.layer === deepRes.failAt) : null;
  if (failedLayer) console.log(`  -> 失败原因: ${failedLayer.label}`);
  check('每一层都有 ok/label', deepRes.layers.every((l) => typeof l.ok === 'boolean' && typeof l.label === 'string'));
  check('失败时能给到原因 label', !deepRes.failAt || Boolean(failedLayer && failedLayer.label));

  console.log('\n导航与设置面板交互');
  await win2.locator('[data-testid="nav-activity"]').click();
  check('活动记录视图可打开', (await win2.locator('.panel').count()) > 0);

  await win2.locator('[data-testid="nav-settings"]').click();
  check('设置视图可打开', (await win2.locator('[data-testid="settings-choose-root"]').count()) > 0);
  check('设置视图含清除根目录按钮', (await win2.locator('[data-testid="settings-clear-root"]').count()) > 0);

  console.log('\n清除根目录闭环交互验证（v1.2：回退内嵌包，而非空态）');
  await win2.locator('[data-testid="settings-clear-root"]').click();
  await win2.locator('[data-testid="nav-toolbox"]').click();
  await win2.locator('[data-testid="pack-grid"]').waitFor({ timeout: 10000 });
  const afterClearCards = await win2.locator('[data-testid^="pack-card-"]').count();
  check('点击清除根目录后回退到内嵌六卡', afterClearCards === 6, `实际 ${afterClearCards}`);
  // 轮询等徽章变成「内嵌」：pack-grid 在点击前就存在，不能只等它
  const codexBadgeAfter = win2.locator('[data-testid="source-codex"]');
  let badgeText = '';
  for (let i = 0; i < 20; i++) {
    badgeText = (await codexBadgeAfter.count()) ? (await codexBadgeAfter.innerText()).trim() : '';
    if (badgeText.includes('内嵌')) break;
    await win2.waitForTimeout(300);
  }
  check('清除后卡片来源徽章为「内嵌」', badgeText.includes('内嵌'), badgeText || '无徽章');

  const shot = path.join(appDir, 'release', 'smoke-toolbox.png');
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  await win2.screenshot({ path: shot });
  console.log(`\n工具箱截图已保存：${shot}`);

  await app2.close();
  console.log('阶段二测试通过！\n');
}

if (fails.length) {
  console.error(`\n========================================`);
  console.error(`冒烟测试失败：共 ${fails.length} 项不符合预期`);
  console.error(`========================================`);
  process.exit(1);
}

console.log('========================================');
console.log('🎉 冒烟测试全部通过！');
console.log('========================================');
