/**
 * 词库端到端实战演练：真注入 → 复核 → 替换 → 卸载 → 还原。
 * 目标平台用 DANGO_E2E_PLATFORM 指定（默认 opencode，真实规则文件会先备份、演练后逐字节还原）。
 *
 * 用法：node tests/library-e2e.mjs
 * 前置：npm run build 不需要（直接走 core.cjs），词库快照需在 build/library/。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const PLATFORM = process.env.DANGO_E2E_PLATFORM || 'opencode';
const fails = [];
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); fails.push(name); }
};

/* ---- 沙盒重定向：绝不打真实用户配置 ----
 * core 的平台 home 支持 env 覆盖（CODEX_HOME / DSH_HOME / WB_HOME / XDG_CONFIG_HOME），
 * cursor 与 anti-gravity 走 HOME —— 直接改 USERPROFILE/HOME 即可整体搬进沙盒。
 * 必须在 require(core.cjs) 之前设置，因为 HOME 是模块加载时取的常量。 */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'dango-e2e-'));
const fakeHome = path.join(SANDBOX, 'home');
fs.mkdirSync(fakeHome, { recursive: true });
// opencode 的 XDG 覆盖要求目录已存在
fs.mkdirSync(path.join(SANDBOX, 'xdg', 'opencode'), { recursive: true });
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;
process.env.CODEX_HOME = path.join(fakeHome, '.codex');
process.env.DSH_HOME = path.join(fakeHome, '.dsh');
process.env.WB_HOME = path.join(fakeHome, '.workbuddy');
process.env.XDG_CONFIG_HOME = path.join(SANDBOX, 'xdg');

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const core = require(path.join(appDir, 'electron', 'core.cjs'));

console.log(`=== 词库 E2E 演练：平台 ${PLATFORM}（沙盒 ${SANDBOX}）===`);

// 确认重定向生效：目标路径必须落在沙盒里
const target = core.RULE_FILE_TARGETS[PLATFORM];
if (!target) { console.error(`未知平台 ${PLATFORM}`); process.exit(1); }
const targetFile = target.mode === 'copy' ? target.dir() : target.file();
if (!targetFile.startsWith(SANDBOX)) {
  console.error(`重定向失败：目标 ${targetFile} 不在沙盒内，拒绝继续`);
  process.exit(1);
}

const backup = null; // 沙盒里没有原文件可备份
const cursorFilesBefore = [];

try {
  // ---------- 1. 词库读取 ----------
  console.log('\n[1] 词库快照读取');
  const meta = core.libraryMeta();
  check('快照可读且 >1000 条', meta.ok && meta.prompts.length > 1000, `${meta.prompts.length} 条`);
  const stats = core.libraryStats();
  check('统计自洽', stats.fullCount + stats.previewOnly === stats.total);

  // ---------- 2. 选词（真实走全文解析链路） ----------
  console.log('\n[2] 选词与全文解析');
  const pick1 = meta.prompts.find((p) => (p.success_rate || 0) >= 80 && (p.content_length || 0) < 30000) || meta.prompts[0];
  const r1 = await core.resolveLibraryContent(pick1.index);
  check(`解析词条#${pick1.index}「${pick1.name}」全文`, r1.ok && r1.detail.content.length > 0, r1.error || '');
  check('解析来源为本地（离线可用）', r1.source === 'local' || r1.source === 'bundled', r1.source);

  // ---------- 3. 注入 ----------
  console.log('\n[3] 注入（replace 模式）');
  const inj1 = await core.importLibraryContent(PLATFORM, pick1.name, r1.detail.content, {
    index: pick1.index,
    mode: 'replace',
    backupDir: path.join(os.tmpdir(), 'dango-e2e-bak')
  });
  check('注入返回 ok + key + 哈希', inj1.ok && Boolean(inj1.key) && Boolean(inj1.contentHash));
  check('落盘文件存在', fs.existsSync(inj1.dest), inj1.dest);

  // ---------- 4. 写后复核 ----------
  console.log('\n[4] 写后复核');
  const v1 = core.verifyLibraryInjection(PLATFORM, inj1.key, inj1.contentHash);
  check('复核：标记块在位', v1.exists === true);
  check('复核：内容哈希一致', v1.hashMatch === true, `actual=${v1.actualHash}`);
  check('复核：verdict=active', v1.verdict === 'active', v1.verdict);

  const scan1 = core.verifyLibraryPlatform(PLATFORM, [{ platformId: PLATFORM, key: inj1.key, contentHash: inj1.contentHash }]);
  check('平台扫描能看到该注入块', scan1.ok && scan1.items.some((x) => x.key === inj1.key && x.verify.verdict === 'active'));

  // 篡改模拟：客户端重写文件 → drifted
  if (target.mode === 'append') {
    const file = target.file();
    const orig = fs.readFileSync(file, 'utf8');
    const probe = r1.detail.content.slice(0, 50);
    fs.writeFileSync(file, orig.includes(probe) ? orig.replace(probe, 'X'.repeat(50)) : orig + '\nTAMPER', 'utf8');
    const vTamper = core.verifyLibraryInjection(PLATFORM, inj1.key, inj1.contentHash);
    check('内容被改后复核报 drifted', vTamper.verdict === 'drifted', vTamper.verdict);
    // 重新注入恢复
    const re = await core.importLibraryContent(PLATFORM, pick1.name, r1.detail.content, { index: pick1.index, mode: 'replace', backupDir: path.join(SANDBOX, 'bak') });
    const vRe = core.verifyLibraryInjection(PLATFORM, re.key, re.contentHash);
    check('重新注入后恢复 active', vRe.verdict === 'active', vRe.verdict);
  }

  // ---------- 5. 替换：注入第二条，第一条被顶掉 ----------
  console.log('\n[5] 替换语义（换一条现役规则）');
  const pick2 = meta.prompts.find((p) => p.index !== pick1.index && (p.content_length || 0) < 30000) || meta.prompts[1];
  const r2 = await core.resolveLibraryContent(pick2.index);
  check(`解析词条#${pick2.index}「${pick2.name}」`, r2.ok && r2.detail.content.length > 0, r2.error || '');
  const inj2 = await core.importLibraryContent(PLATFORM, pick2.name, r2.detail.content, {
    index: pick2.index,
    mode: 'replace',
    backupDir: path.join(os.tmpdir(), 'dango-e2e-bak')
  });
  check('第二条注入成功', inj2.ok);
  check('第一条被顶掉（displaced 含旧 key）', (inj2.displaced || []).includes(inj1.key), JSON.stringify(inj2.displaced));

  const scan2 = core.listLibraryInjections(PLATFORM);
  const libKeys = scan2.items.filter((x) => x.fromLibrary).map((x) => x.key);
  check('平台上只剩第二条现役', libKeys.length === 1 && libKeys[0] === inj2.key, JSON.stringify(libKeys));

  // ---------- 6. 卸载 ----------
  console.log('\n[6] 卸载');
  const rm = await core.removeLibraryInjection(PLATFORM, inj2.key, { backupDir: path.join(os.tmpdir(), 'dango-e2e-bak') });
  check('卸载返回 ok', rm.ok === true, rm.error || '');
  const scan3 = core.listLibraryInjections(PLATFORM);
  check('卸载后平台无词库注入块', scan3.items.filter((x) => x.fromLibrary).length === 0);
  if (target.mode === 'append' && backup) {
    const after = fs.readFileSync(targetFile, 'utf8');
    check('卸载后用户原内容完整保留', after.includes(backup.trim().slice(0, Math.min(80, backup.trim().length))));
  }
} finally {
  // ---------- 还原 ----------
  console.log('\n[还原]');
  if (target.mode === 'append') {
    if (backup !== null) {
      fs.writeFileSync(targetFile, backup, 'utf8');
      const same = fs.readFileSync(targetFile, 'utf8') === backup;
      check('目标文件已逐字节还原', same);
    } else if (fs.existsSync(targetFile)) {
      fs.rmSync(targetFile, { force: true });
      check('演练创建的文件已删除', !fs.existsSync(targetFile));
    }
  } else {
    // copy 平台：删掉演练产生的 .mdc
    const now = fs.existsSync(target.dir()) ? fs.readdirSync(target.dir()) : [];
    for (const f of now) if (!cursorFilesBefore.includes(f)) fs.rmSync(path.join(target.dir(), f), { force: true });
    check('演练产生的 .mdc 已清理', fs.readdirSync(target.dir()).length === cursorFilesBefore.length);
  }
}

console.log('\n========================================');
if (fails.length) {
  console.error(`E2E 失败 ${fails.length} 项：${fails.join('；')}`);
  process.exit(1);
}
console.log(`🎉 词库 E2E 全链路通过（${PLATFORM}）：选词 → 注入 → 复核 → 篡改检测 → 替换 → 卸载 → 还原`);
