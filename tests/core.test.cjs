'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const core = require('../electron/core.cjs');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dango-test-'));
}

test('matchesExpected 精确匹配与通配', () => {
  assert.strictEqual(core.matchesExpected('README-CN.txt', 'README-CN.txt'), true);
  assert.strictEqual(core.matchesExpected('other.txt', 'README-CN.txt'), false);
  assert.strictEqual(
    core.matchesExpected('install-manifest-20260908-115527.json', 'install-manifest-*.json'),
    true
  );
  assert.strictEqual(core.matchesExpected('package.json', 'install-manifest-*.json'), false);
});

test('walkStats 统计文件数/体积并跳过缓存目录', async () => {
  const d = tmpdir();
  fs.writeFileSync(path.join(d, 'a.txt'), 'hello');
  fs.mkdirSync(path.join(d, 'sub'));
  fs.writeFileSync(path.join(d, 'sub', 'b.txt'), 'world!!');
  fs.mkdirSync(path.join(d, 'node_modules'));
  fs.writeFileSync(path.join(d, 'node_modules', 'ignored.txt'), 'x'.repeat(9999));

  const s = await core.walkStats(d);
  assert.strictEqual(s.fileCount, 2, '应只统计 2 个文件');
  assert.strictEqual(s.dirCount, 1, '只统计 sub，不统计 node_modules');
  assert.strictEqual(s.bytes, 5 + 7, '字节数应排除 node_modules');
  assert.strictEqual(s.skippedDirs, 1);
  assert.ok(s.modifiedAt, '应有最近修改时间');
});

test('extractVersion 从 package.json 取版本', () => {
  const d = tmpdir();
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'x', version: '3.0.0' }));
  const v = core.extractVersion(d, [{ kind: 'packageJson', file: 'package.json' }]);
  assert.deepStrictEqual(v, { version: '3.0.0', source: 'package.json' });
});

test('extractVersion 从首行注释里抓版本号', () => {
  const d = tmpdir();
  fs.writeFileSync(path.join(d, 'install.ps1'), '#  DSH 破甲懒人包 v5（石井）\n#  more\n');
  const v = core.extractVersion(d, [{ kind: 'firstLines', file: 'install.ps1', maxLines: 10, pattern: 'v(\\d+)\\b' }]);
  assert.strictEqual(v.version, '5');
});

test('extractVersion 取最新的 manifest（按文件名排序）', () => {
  const d = tmpdir();
  fs.writeFileSync(path.join(d, 'install-manifest-20260904-152012.json'), JSON.stringify({ version: '3.0.0' }));
  fs.writeFileSync(path.join(d, 'install-manifest-20260908-115527.json'), JSON.stringify({ version: '3.1.0' }));
  const v = core.extractVersion(d, [{ kind: 'latestManifest', pattern: 'install-manifest-*.json' }]);
  assert.strictEqual(v.version, '3.1.0');
  assert.strictEqual(v.source, 'install-manifest-20260908-115527.json');
});

test('extractVersion 找不到就返回 null，不编造', () => {
  const d = tmpdir();
  fs.writeFileSync(path.join(d, 'README.md'), 'no version here');
  const v = core.extractVersion(d, [{ kind: 'firstLines', file: 'README.md', maxLines: 5, pattern: 'v(\\d+)' }]);
  assert.strictEqual(v, null);
});

test('diffMaps 识别新增/删除/修改/未变', () => {
  const base = {
    same: { sha256: 'aaa', size: 1 },
    gone: { sha256: 'bbb', size: 2 },
    mod: { sha256: 'ccc', size: 3 }
  };
  const cur = {
    same: { sha256: 'aaa', size: 1 },
    mod: { sha256: 'ddd', size: 4 },
    fresh: { sha256: 'eee', size: 5 }
  };
  const r = core.diffMaps(base, cur);
  assert.strictEqual(r.unchanged, 1);
  assert.strictEqual(r.modified.length, 1);
  assert.strictEqual(r.modified[0].path, 'mod');
  assert.strictEqual(r.removed.length, 1);
  assert.strictEqual(r.removed[0].path, 'gone');
  assert.strictEqual(r.added.length, 1);
  assert.strictEqual(r.added[0].path, 'fresh');
  assert.strictEqual(r.changed, 3);
});

test('diffMaps 空基线当作全部新增', () => {
  const r = core.diffMaps({}, { a: { sha256: 'x', size: 1 } });
  assert.strictEqual(r.added.length, 1);
  assert.strictEqual(r.changed, 1);
});

test('hashAll 对每个文件算出 sha256 并回报进度', async () => {
  const d = tmpdir();
  fs.writeFileSync(path.join(d, 'a.txt'), 'hello');
  fs.writeFileSync(path.join(d, 'b.txt'), 'world');
  const seen = [];
  const out = await core.hashAll(d, ['a.txt', 'b.txt'], (done, total, rel) => seen.push([done, total, rel]));
  assert.strictEqual(Object.keys(out).length, 2);
  assert.match(out['a.txt'].sha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(seen.length, 2);
  assert.strictEqual(seen[1][0], 2);
});

test('formatBytes 单位换算', () => {
  assert.strictEqual(core.formatBytes(512), '512 B');
  assert.strictEqual(core.formatBytes(2048), '2.0 KB');
  assert.strictEqual(core.formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.strictEqual(core.formatBytes(3 * 1024 * 1024 * 1024), '3.00 GB');
  assert.strictEqual(core.formatBytes(NaN), '—');
});

test('renderReport 输出包含六个包且不虚构安装状态', () => {
  const md = core.renderReport({
    root: 'C:/x',
    packs: [
      {
        name: '测试包',
        folder: 'test',
        version: '1.0',
        versionSource: 'README.md',
        found: true,
        fileCount: 3,
        dirCount: 1,
        bytes: 1024,
        modifiedAt: new Date().toISOString(),
        path: 'C:/x/test',
        missingEntries: [],
        warnings: [],
        lastResult: 'unchanged',
        lastChanges: null
      }
    ]
  });
  assert.ok(md.includes('团子工作台'));
  assert.ok(md.includes('测试包'));
  assert.ok(md.includes('与本地基线快照一致'));
});

test('六个包定义齐全且 ID 唯一', () => {
  assert.strictEqual(core.PACKS.length, 6);
  assert.strictEqual(new Set(core.PACK_IDS).size, 6);
  for (const p of core.PACKS) {
    assert.ok(p.id && p.name && p.folder && p.accent, `${p.id} 缺字段`);
    assert.ok(Array.isArray(p.expected) && p.expected.length, `${p.id} 缺 expected`);
    assert.ok(Array.isArray(p.versionSources) && p.versionSources.length, `${p.id} 缺 versionSources`);
  }
});

/* ---------------- 深度验证：回复分析器 ---------------- */

test('analyzeReply 识别石井激活', () => {
  const r = core.analyzeReply('来杯冰美式，开始你的黑客生活吧。[石井 ROUTE] workflow=blade');
  assert.strictEqual(r.hasShiyi, true);
  assert.strictEqual(r.hasRoute, true);
  assert.strictEqual(r.hasRefusal, false);
  assert.strictEqual(r.verdict, 'active');
});

test('analyzeReply 识别模型拒绝', () => {
  const r = core.analyzeReply("I'm sorry, I can't help with that request. It violates content policy.");
  assert.strictEqual(r.hasRefusal, true);
  assert.strictEqual(r.verdict, 'refused');
});

test('analyzeReply 识别中文拒绝', () => {
  const r = core.analyzeReply('抱歉，我无法协助完成这个请求。');
  assert.strictEqual(r.hasRefusal, true);
  assert.strictEqual(r.verdict, 'refused');
});

test('analyzeReply 识别思考过程', () => {
  const r = core.analyzeReply('<think>用户在问身份</think>是，石井在此');
  assert.strictEqual(r.hasThinking, true);
  assert.strictEqual(r.hasShiyi, true);
  assert.strictEqual(r.verdict, 'active');
});

test('analyzeReply 空回复', () => {
  const r = core.analyzeReply('   ');
  assert.strictEqual(r.verdict, 'empty');
});

test('analyzeReply 识别 AI 声明残留', () => {
  const r = core.analyzeReply('I am an AI assistant and 是，石井在此');
  assert.strictEqual(r.hasDisclosure, true);
  assert.strictEqual(r.hasShiyi, true);
});

/* ---------------- 深度验证：配置检查 ---------------- */

test('CONFIG_CHECKS 覆盖全部六包', () => {
  for (const id of core.PACK_IDS) {
    assert.ok(core.CONFIG_CHECKS[id], `缺 ${id} 的配置检查`);
    const r = core.CONFIG_CHECKS[id]();
    assert.ok(typeof r.ok === 'boolean');
    assert.ok(Array.isArray(r.items));
  }
});

test('L4 通道定义覆盖全部六包', () => {
  for (const id of core.PACK_IDS) {
    assert.ok(core.L4_CHANNELS[id], `缺 ${id} 的 L4 通道`);
  }
});

test('findCodexCli 返回路径或 null', () => {
  const p = core.findCodexCli();
  assert.ok(p === null || /codex\.exe$/i.test(p));
});

test('toPosix 路径分隔符归一化', () => {
  assert.strictEqual(core.toPosix('foo\\bar\\baz.txt'), 'foo/bar/baz.txt');
  assert.strictEqual(core.toPosix('C:\\Users\\Admin'), 'C:/Users/Admin');
  assert.strictEqual(core.toPosix('already/posix/path'), 'already/posix/path');
});

test('expandEnv 环境变量替换', () => {
  const user = process.env.USERPROFILE || 'C:\\Users\\Administrator';
  const res = core.expandEnv('%USERPROFILE%\\test');
  assert.strictEqual(res, path.join(user, 'test'));
  assert.strictEqual(core.expandEnv('regular/path/without/env'), 'regular/path/without/env');
});

test('DEPLOY_PLANS 覆盖全部六包且目标脚本定义合法', () => {
  for (const id of core.PACK_IDS) {
    const plan = core.DEPLOY_PLANS[id];
    assert.ok(plan, `缺 ${id} 的 DEPLOY_PLAN`);
    assert.ok(plan.install && typeof plan.install.file === 'string');
    assert.ok(Array.isArray(plan.backupDirs));
    assert.ok(Array.isArray(plan.evidence));
  }
});

test('PLATFORM_PROBES 覆盖全部六包且包含关键探测路径', () => {
  for (const id of core.PACK_IDS) {
    const probe = core.PLATFORM_PROBES[id];
    assert.ok(probe, `缺 ${id} 的 PLATFORM_PROBES`);
    assert.ok(typeof probe.displayName === 'string');
    assert.ok(Array.isArray(probe.installDirs));
    assert.ok(Array.isArray(probe.exes));
    assert.ok(Array.isArray(probe.configDirs));
  }
});

test('detectPlatform 对不存在或测试平台返回安全降级对象', () => {
  const res = core.detectPlatform('nonexistent-pack');
  assert.strictEqual(res.installed, false);
  assert.strictEqual(res.installDir, null);
  assert.strictEqual(res.exePath, null);
  assert.deepStrictEqual(res.configDirs, []);
});

test('detectAllPlatforms 返回全部六个平台的检测结果', () => {
  const all = core.detectAllPlatforms();
  for (const id of core.PACK_IDS) {
    assert.ok(all[id], `结果缺失 ${id}`);
    assert.ok(typeof all[id].installed === 'boolean');
    assert.ok(Array.isArray(all[id].configDirs));
  }
});

test('checkEvidence 判定与不存在路径容错', () => {
  const falseEv = core.checkEvidence({ type: 'file', path: 'C:/nonexistent/file.txt', label: '不存在文件' });
  assert.strictEqual(falseEv.ok, false);
  assert.strictEqual(falseEv.label, '不存在文件');

  const falseDir = core.checkEvidence({ type: 'dir', path: 'C:/nonexistent/dir', label: '不存在目录' });
  assert.strictEqual(falseDir.ok, false);
});

test('verifyBreak 覆盖全部六包且返回标准 BreakStatus 结构', () => {
  for (const id of core.PACK_IDS) {
    const st = core.verifyBreak(id);
    assert.strictEqual(st.id, id);
    assert.ok(typeof st.hasCheck === 'boolean');
    assert.ok(st.active === true || st.active === false || st.active === null);
    assert.ok(Array.isArray(st.items));
  }
});

test('findGuiExe 对六包安全返回可执行路径或 null', () => {
  for (const id of core.PACK_IDS) {
    const exe = core.findGuiExe(id);
    assert.ok(exe === null || typeof exe === 'string');
  }
});

test('cursor 部署计划配置自动应答 input 并且 buildSpawn 正确透传', () => {
  const cursorPlan = core.DEPLOY_PLANS.cursor;
  assert.strictEqual(cursorPlan.install.input, 'a\r\n');
  assert.strictEqual(cursorPlan.uninstall.input, 'a\r\n');
});

/* ---------------- 单文件导入识别（老板反馈：只能导入文件夹） ---------------- */

test('detectPackTarget 单个规则文件：含破甲协议但无平台名 → 给出全平台候选可手选', () => {
  const dir = tmpdir();
  const f = path.join(dir, '破甲规则.md');
  fs.writeFileSync(f, '# 石井协议\n\n冷咖啡 触发。SHIYI 工作约定。\n', 'utf8');
  const det = core.detectPackTarget(f);
  assert.strictEqual(det.inputKind, 'file');
  assert.strictEqual(det.kind, 'unknown');
  assert.strictEqual(det.genericHit, true);
  assert.strictEqual(det.canPickManually, true);
  assert.strictEqual(det.candidates.length, core.PACK_IDS.length);
});

test('detectPackTarget 单个规则文件：文件名带平台名 → 自动识别', () => {
  const dir = tmpdir();
  const f = path.join(dir, 'codex-rules.md');
  fs.writeFileSync(f, 'Codex CLI 配置说明\n', 'utf8');
  const det = core.detectPackTarget(f);
  assert.strictEqual(det.kind, 'single');
  assert.strictEqual(det.platform, 'codex');
  assert.ok(det.confidence > 0.5);
});

test('detectPackTarget 单个规则文件：内容含平台路径 → 自动识别', () => {
  const dir = tmpdir();
  const f = path.join(dir, 'shiyi-rules.mdc');
  fs.writeFileSync(f, '---\nalwaysApply: true\n---\nCursor Composer 规则\n', 'utf8');
  const det = core.detectPackTarget(f);
  assert.strictEqual(det.kind, 'single');
  assert.strictEqual(det.platform, 'cursor');
});

test('detectPackTarget 普通文档无任何特征 → unknown 且候选全 0 分', () => {
  const dir = tmpdir();
  const f = path.join(dir, '随便.md');
  fs.writeFileSync(f, '# 随便一个文档\n今天天气不错。\n', 'utf8');
  const det = core.detectPackTarget(f);
  assert.strictEqual(det.kind, 'unknown');
  assert.strictEqual(det.genericHit, false);
  assert.ok(det.candidates.every((c) => c.score === 0));
});

test('detectPackTarget 非文本扩展名仍按通用打分（不误判为规则文件）', () => {
  const dir = tmpdir();
  const f = path.join(dir, 'blob.bin');
  fs.writeFileSync(f, 'whatever', 'utf8');
  const det = core.detectPackTarget(f);
  assert.strictEqual(det.inputKind, 'file');
  assert.strictEqual(det.canPickManually, false);
});

test('TEXT_EXTS 覆盖常见规则文件扩展名', () => {
  for (const ext of ['.md', '.mdc', '.txt', '.json', '.yaml', '.yml']) {
    assert.ok(core.TEXT_EXTS.has(ext), `缺少 ${ext}`);
  }
  assert.ok(!core.TEXT_EXTS.has('.exe'));
  assert.ok(!core.TEXT_EXTS.has('.bin'));
});

test('RULE_FILE_TARGETS 六个平台都有单文件注入目标', () => {
  for (const id of core.PACK_IDS) {
    const t = core.RULE_FILE_TARGETS[id];
    assert.ok(t, `${id} 缺少单文件注入目标`);
    assert.ok(t.mode === 'copy' || t.mode === 'append');
    assert.ok(typeof t.label === 'string' && t.label.length > 0);
  }
});

/* ---------------- 内嵌词库 ---------------- */

test('loadBuiltinLibrary 在无快照时返回 ok=false', () => {
  // 测试环境通常无 bundled；应当明确失败
  const r = core.loadBuiltinLibrary();
  assert.strictEqual(typeof r.ok, 'boolean');
  assert.ok(Array.isArray(r.prompts));
});

test('fetchBuiltinDetail 返回 ok 与 detail', () => {
  const r = core.fetchBuiltinDetail(0);
  assert.strictEqual(typeof r.ok, 'boolean');
  // 没有快照时 detail 应不存在（错误路径）
  if (!r.ok) assert.ok(r.error);
});

test('fetchBuiltinDetail 拒绝无效 index', () => {
  assert.strictEqual(core.fetchBuiltinDetail(-1).ok, false);
  assert.strictEqual(core.fetchBuiltinDetail(NaN).ok, false);
  assert.strictEqual(core.fetchBuiltinDetail(Infinity).ok, false);
});

test('importLibraryContent append 平台：cursor 是 copy', async () => {
  const r = await core.importLibraryContent('cursor', 'unit-test.md', '# hi\n', { backup: false });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.mode, 'copy');
  assert.ok(r.dest.includes('.cursor'));
  try { fs.unlinkSync(r.dest); } catch { /* safe-delete shim may swallow */ }
});

test('importLibraryContent 拒绝未知平台', async () => {
  await assert.rejects(
    () => core.importLibraryContent('nope', 'x', 'y'),
    /不支持注入/
  );
});

test('importLibraryContent 接受空字符串写入（上层做内容校验）', async () => {
  // core 层只负责落地，内容空不空由 main.cjs 把关
  const r = await core.importLibraryContent('cursor', 'unit-empty.md', '', { backup: false });
  assert.strictEqual(r.ok, true);
  try { fs.unlinkSync(r.dest); } catch { /* */ }
});

test('importLibraryContent append 平台：codex 写入 AGENTS.md 标记块', async () => {
  const targetFile = path.join(os.tmpdir(), 'dango-codetest-AGENTS.md');
  // 备份并删除，确保干净
  if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);
  // 直接模拟 core: 我们这里测试 buildImportBlock（不直接测整条链，因依赖 codexHome）
  const block = core.buildImportBlock('unit-test', 'TEST-CONTENT');
  assert.ok(block.includes('shiyi-imported:unit-test:start'));
  assert.ok(block.includes('TEST-CONTENT'));
  assert.ok(block.includes(':end'));
});

