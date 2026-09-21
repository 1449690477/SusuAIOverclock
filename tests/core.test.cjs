'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const core = require('../electron/core.cjs');
const policy = require('../electron/security-policy.cjs');

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

test('renderReport 输出包含全部包且不虚构安装状态', () => {
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

test('受管包定义齐全且 ID 唯一', () => {
  // 六个发布包（claude 为 v1.5.6 新增）+ 三个隔离包
  assert.strictEqual(core.PACKS.length, 9);
  assert.strictEqual(new Set(core.PACK_IDS).size, 9);
  assert.ok(core.PACK_IDS.includes('workbuddy-ai'));
  assert.ok(core.PACK_IDS.includes('claude'));
  for (const p of core.PACKS) {
    assert.ok(p.id && p.name && p.folder && p.accent, `${p.id} 缺字段`);
    assert.ok(Array.isArray(p.expected) && p.expected.length, `${p.id} 缺 expected`);
    assert.ok(Array.isArray(p.versionSources) && p.versionSources.length, `${p.id} 缺 versionSources`);
  }
});

/* ---------------- codex 双分支：冷咖啡石井 / 胖虎 ---------------- */

test('codex 双破甲分支并存且互斥语义在 note 里写明', () => {
  assert.ok(core.PACK_IDS.includes('codex'), '缺 codex（冷咖啡石井）');
  assert.ok(core.PACK_IDS.includes('codex-panghu'), '缺 codex-panghu（胖虎）');
  const shiyi = core.PACKS.find((p) => p.id === 'codex');
  const panghu = core.PACKS.find((p) => p.id === 'codex-panghu');
  // 两分支同指一个目标软件 Codex，folder 必须不同（否则扫描/部署会撞车）
  assert.strictEqual(shiyi.target, panghu.target);
  assert.notStrictEqual(shiyi.folder, panghu.folder);
  assert.strictEqual(panghu.folder, 'codex-panghu');
  // v1.5.5 起两个 Codex 分支同时进了隔离名单，note 改为隔离原因文案；
  // 互斥语义仍然成立：同目标、不同 folder、不同图标，且两者都不能直接部署。
  assert.strictEqual(shiyi.note, policy.QUARANTINED_PACKS.codex);
  assert.strictEqual(panghu.note, policy.QUARANTINED_PACKS['codex-panghu']);
  assert.strictEqual(core.isConsentPack('codex'), true);
  assert.strictEqual(core.isConsentPack('codex-panghu'), true);
  // 图标必须不同，两张 Codex 卡片在视觉上可区分
  assert.notStrictEqual(core.BRAND_ICONS.codex, core.BRAND_ICONS['codex-panghu']);
});

test('codex-panghu 部署计划走 keysmith install.ps1 且 evidence 是注入特征', () => {
  // v1.5.6：可执行定义移入 LEGACY_QUARANTINE_PLANS，只有登记知情同意后才可达；
  // DEPLOY_PLANS 里保留同 id 的空计划（install:null）与 evidence。
  const legacy = core.LEGACY_QUARANTINE_PLANS['codex-panghu'];
  const plan = core.DEPLOY_PLANS['codex-panghu'];
  assert.strictEqual(plan.install, null, '未登记同意时必须是 fail-closed 空计划');
  assert.strictEqual(legacy.install.file, 'install.ps1');
  assert.strictEqual(legacy.install.kind, 'ps1');
  assert.ok(legacy.install.args.includes('install'), 'install 缺 -Action install');
  assert.strictEqual(legacy.uninstall.file, 'install.ps1');
  assert.ok(legacy.uninstall.args.includes('uninstall'), 'uninstall 缺 -Action uninstall');
  // evidence 必须覆盖 keysmith 的三个落地特征：config 指向 / 根指令 / 部署清单
  const labels = plan.evidence.map((e) => e.label).join('|');
  assert.ok(/model_instructions_file/.test(labels), 'evidence 缺 model_instructions_file 检查');
  assert.ok(/gpt-unrestricted\.md/.test(labels), 'evidence 缺根指令检查');
  assert.ok(/keysmith-manifest/.test(labels), 'evidence 缺部署清单检查');
  assert.ok(plan.evidence.every((e) => ['file', 'dir', 'contains', 'glob'].includes(e.type)));
});

test('codex-panghu CONFIG_CHECKS 返回标准结构且互斥检测存在', () => {
  const r = core.CONFIG_CHECKS['codex-panghu']();
  assert.ok(typeof r.ok === 'boolean');
  assert.ok(Array.isArray(r.items) && r.items.length > 0);
  // 未部署时全部 item 应能安全求值（不因缺文件抛异常）
  for (const it of r.items) {
    assert.ok(typeof it.ok === 'boolean');
    assert.ok(typeof it.label === 'string' && it.label.length > 0);
  }
  // hooks.json 隔离检查是胖虎与石井互斥的核心，必须在 items 里
  assert.ok(r.items.some((it) => /hooks\.json|隔离/.test(it.label)), 'CONFIG_CHECKS 缺 hooks 隔离互斥检查');
});

/* ---------------- 深度验证：回复分析器 ---------------- */

test('analyzeReply 识别石井激活', () => {
  const r = core.analyzeReply('来杯冰美式，开始你的黑客生活吧。[石井 ROUTE] workflow=blade');
  assert.strictEqual(r.hasShiyi, true);
  assert.strictEqual(r.hasRoute, true);
  assert.strictEqual(r.hasRefusal, false);
  assert.strictEqual(r.verdict, 'active');
});

test('analyzeReply 识别 v10 [ROUTE] 回执', () => {
  const r = core.analyzeReply('[ROUTE] workflow=software | stages=侦察→实现→验证→交付 | skill=none\n是，石井在此');
  assert.strictEqual(r.hasRoute, true);
  assert.strictEqual(r.hasShiyi, true);
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

test('CONFIG_CHECKS 覆盖全部七包', () => {
  for (const id of core.PACK_IDS) {
    assert.ok(core.CONFIG_CHECKS[id], `缺 ${id} 的配置检查`);
    const r = core.CONFIG_CHECKS[id]();
    assert.ok(typeof r.ok === 'boolean');
    assert.ok(Array.isArray(r.items));
  }
});

test('L4 通道定义覆盖全部七包', () => {
  for (const id of core.PACK_IDS) {
    assert.ok(core.L4_CHANNELS[id], `缺 ${id} 的 L4 通道`);
  }
});

test('CLI L4 验证参数跳过仓库信任确认且不依赖 stdin', () => {
  const args = core.buildCliVerifyArgs('C:\\Temp\\dango-l4', core.VERIFY_PROMPT);
  assert.ok(args.includes('exec'));
  assert.ok(args.includes('--skip-git-repo-check'));
  assert.ok(args.includes('--ephemeral'));
  assert.ok(args.includes('--sandbox'));
  assert.ok(args.includes('read-only'));
  assert.ok(args.includes('--cd'));
  assert.ok(args.includes('C:\\Temp\\dango-l4'));
  assert.strictEqual(args[args.length - 1], core.VERIFY_PROMPT);
});

test('CLI L4 启动错误与模型回复错误分开归类', () => {
  assert.strictEqual(
    core.isCliVerifyInfrastructureError('Reading additional input from stdin... Not inside a trusted directory'),
    true
  );
  assert.strictEqual(core.isCliVerifyInfrastructureError('抱歉，我无法协助完成这个请求。'), false);
  assert.strictEqual(core.isCliVerifyInfrastructureError('是，石井在此'), false);
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

test('DEPLOY_PLANS 覆盖全部受管包且隔离包保持 fail-closed', () => {
  for (const id of core.PACK_IDS) {
    const plan = core.DEPLOY_PLANS[id];
    assert.ok(plan, `缺 ${id} 的 DEPLOY_PLAN`);
    assert.ok(Array.isArray(plan.backupDirs));
    assert.ok(Array.isArray(plan.evidence));
    if (policy.isQuarantinedId(id)) {
      // 隔离包：生效计划为空；可执行定义只能从 LEGACY 表在同意后取出
      assert.strictEqual(plan.install, null, `${id} 未同意时不得带 install 计划`);
      assert.ok(core.LEGACY_QUARANTINE_PLANS[id], `${id} 缺 legacy 定义`);
      assert.strictEqual(typeof core.LEGACY_QUARANTINE_PLANS[id].install.file, 'string', `${id} legacy 定义不完整`);
    } else {
      assert.ok(plan.install && typeof plan.install.file === 'string', `${id} 发布包必须有 install 计划`);
    }
  }
});

test('PLATFORM_PROBES 覆盖全部七包且包含关键探测路径', () => {
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

test('detectAllPlatforms 返回全部七个平台的检测结果', () => {
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

test('verifyBreak 覆盖全部七包且返回标准 BreakStatus 结构', () => {
  for (const id of core.PACK_IDS) {
    const st = core.verifyBreak(id);
    assert.strictEqual(st.id, id);
    assert.ok(typeof st.hasCheck === 'boolean');
    assert.ok(st.active === true || st.active === false || st.active === null);
    assert.ok(Array.isArray(st.items));
  }
});

test('findGuiExe 对七包安全返回可执行路径或 null', () => {
  for (const id of core.PACK_IDS) {
    const exe = core.findGuiExe(id);
    assert.ok(exe === null || typeof exe === 'string');
  }
});

/* ---------------- L3 进程层稳健化（老板反馈：不管哪个平台都容易找不到） ---------------- */

test('probeRuntime 对发布包永不抛异常，对隔离包未同意时 fail-closed', () => {
  for (const id of core.PACK_IDS) {
    if (policy.isQuarantinedId(id)) {
      // 隔离包在登记知情同意之前必须直接被策略层拒绝，而不是「探测失败」
      assert.throws(
        () => core.probeRuntime(id),
        (e) => e && e.code === 'ERR_PACK_QUARANTINED',
        `${id} 未登记同意时应拒绝执行`
      );
      continue;
    }
    const r = core.probeRuntime(id);
    assert.strictEqual(typeof r.ok, 'boolean', `${id} ok 非布尔`);
    assert.ok(['cli', 'gui', 'skip'].includes(r.mode), `${id} mode 非法：${r.mode}`);
    assert.strictEqual(typeof r.label, 'string');
    assert.ok(r.label.length > 0, `${id} label 为空`);
    assert.ok(r.exe === null || typeof r.exe === 'string');
  }
});

test('dsh 无独立进程通道 → 降级通过而不是判失败（历史 bug：落 else 恒 false）', () => {
  const r = core.probeRuntime('dsh');
  assert.strictEqual(r.ok, true, 'dsh 不应判失败');
  assert.strictEqual(r.soft, true);
  assert.strictEqual(r.mode, 'skip');
});

test('probeRuntime 的 soft 语义：ok=false 必不 soft，soft=true 必 ok', () => {
  for (const id of core.PACK_IDS) {
    if (policy.isQuarantinedId(id)) continue; // 未登记同意时直接拒绝，不参与 soft 语义
    const r = core.probeRuntime(id);
    if (!r.ok) assert.notStrictEqual(r.soft, true, `${id} 失败态不应标记 soft`);
    if (r.soft) assert.strictEqual(r.ok, true, `${id} soft 必须是 ok`);
  }
});

test('findCodexCliInfo 返回 {path,via,candidates}，候选路径全部真实存在', () => {
  const info = core.findCodexCliInfo();
  assert.ok(Array.isArray(info.candidates));
  assert.ok(info.path === null || /\.(exe|cmd)$/i.test(info.path));
  for (const c of info.candidates) {
    assert.strictEqual(typeof c.path, 'string');
    assert.ok(fs.existsSync(c.path), `候选不存在：${c.path}`);
  }
  if (info.path) assert.ok(info.candidates.some((c) => c.path === info.path), '选中路径必须在候选表里');
});

test('findCodexCli 的目录名过滤不再要求 windows-x64 后缀（换安装形态也能找到）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'core.cjs'), 'utf8');
  const fn = src.slice(src.indexOf('function findCodexCliInfo'), src.indexOf('function findCodexCli('));
  // 不应再依赖单一 codex-*-windows-x64- 目录名规则
  assert.ok(!/codex-\.\*-windows-x64-/.test(fn), '仍存在旧的窄 glob');
  assert.ok(/scanExe\(/.test(fn), '缺少有界深扫兜底');
  assert.ok(/process\.env\.PATH/.test(fn), '缺少 PATH 兜底');
});

test('findCodexCliInfo 不执行候选可执行文件，版本只从路径名解析', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'core.cjs'), 'utf8');
  const fn = src.slice(src.indexOf('function findCodexCliInfo'), src.indexOf('function findCodexCli('));
  // v1.5.5 起改为纯路径探测：未知版本的候选一律不执行，避免触发受感染 CLI
  assert.doesNotMatch(fn, /execFileSync|execSync|spawnSync|spawn\(/, '路径探测不得执行候选 exe/cmd');
  assert.ok(/versionTuple\(/.test(fn), '版本只能从路径名解析');
  assert.doesNotMatch(fn, /['"]--version['"]/, '不得把 --version 作为参数传给候选');
});

test('detectPlatform 暴露 exeVia（告诉用户从哪找到的）', () => {
  for (const id of core.PACK_IDS) {
    const p = core.detectPlatform(id);
    assert.ok('exeVia' in p, `${id} 缺 exeVia 字段`);
    if (p.exePath) assert.ok(typeof p.exeVia === 'string' && p.exeVia.length > 0, `${id} 有 exe 但没记来源`);
  }
});

test('cursor 部署计划直调 setup.py --no-open', () => {
  const cursorPlan = core.DEPLOY_PLANS.cursor;
  assert.strictEqual(cursorPlan.install.file, 'setup.py');
  assert.strictEqual(cursorPlan.install.kind, 'py');
  assert.ok(cursorPlan.install.args.includes('install'));
  assert.ok(cursorPlan.install.args.includes('--no-open'));
  assert.strictEqual(cursorPlan.uninstall.file, 'setup.py');
  assert.ok(cursorPlan.uninstall.args.includes('uninstall'));
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

test('RULE_FILE_TARGETS 七个平台都有单文件注入目标', () => {
  for (const id of core.PACK_IDS) {
    const t = core.RULE_FILE_TARGETS[id];
    assert.ok(t, `${id} 缺少单文件注入目标`);
    assert.ok(t.mode === 'copy' || t.mode === 'append');
    assert.ok(typeof t.label === 'string' && t.label.length > 0);
  }
});

/* ---------------- 词库 v2 ----------------
 * 红线：所有注入类测试都打在临时目录上。
 * v1.2.1 的测试直接往用户真实的 ~/.cursor/rules 写文件，这是不可接受的。
 */

/** 把 append/copy 目标临时重定向到沙盒目录，测完还原 */
function withSandboxTargets(fn) {
  return async () => {
    const dir = tmpdir();
    const original = {};
    const patch = {
      cursor: {
        mode: 'copy',
        dir: () => path.join(dir, 'cursor-rules'),
        label: 'sandbox cursor rules'
      },
      codex: {
        mode: 'append',
        file: () => path.join(dir, 'codex-AGENTS.md'),
        label: 'sandbox codex AGENTS.md'
      }
    };
    for (const id of Object.keys(patch)) {
      original[id] = core.RULE_FILE_TARGETS[id];
      core.RULE_FILE_TARGETS[id] = patch[id];
    }
    try {
      return await fn(dir, patch);
    } finally {
      for (const id of Object.keys(original)) core.RULE_FILE_TARGETS[id] = original[id];
    }
  };
}

test('loadBuiltinLibrary / libraryMeta 结构恒定（有无快照都不抛）', () => {
  const raw = core.loadLibraryRaw();
  assert.strictEqual(typeof raw.ok, 'boolean');
  assert.ok(Array.isArray(raw.prompts));

  const meta = core.libraryMeta();
  assert.strictEqual(typeof meta.ok, 'boolean');
  assert.ok(Array.isArray(meta.prompts));
  assert.ok(['bundle', 'meta', 'none'].includes(meta.source));

  const stats = core.libraryStats();
  assert.strictEqual(typeof stats.total, 'number');
  assert.ok(stats.categories && typeof stats.categories === 'object');
  assert.ok(stats.rates && typeof stats.rates.r90 === 'number');
});

test('toLibraryMeta 剥掉全文、带 index、preview 截断', () => {
  const big = 'x'.repeat(core.LIBRARY_PREVIEW_CHARS + 500);
  const m = core.toLibraryMeta({ name: 'n', content: big, success_rate: '88' }, 7);
  assert.strictEqual(m.index, 7);
  assert.strictEqual(m.content, undefined, 'meta 不能带 content，否则 IPC 传 25MB');
  assert.ok(m.preview.length <= core.LIBRARY_PREVIEW_CHARS);
  assert.strictEqual(m.success_rate, 88);
  assert.strictEqual(m.content_length, big.length);
  assert.strictEqual(m.has_full, true);
});

test('toLibraryMeta 缺字段有兜底（不出现 undefined 名称）', () => {
  const m = core.toLibraryMeta({}, 3);
  assert.strictEqual(m.name, '未命名 #3');
  assert.strictEqual(m.category_label, '通用安全');
  assert.strictEqual(m.source, '未标注');
  assert.strictEqual(m.success_rate, 0);
});

test('fetchBuiltinDetail 拒绝无效 index', () => {
  assert.strictEqual(core.fetchBuiltinDetail(-1).ok, false);
  assert.strictEqual(core.fetchBuiltinDetail(NaN).ok, false);
  assert.strictEqual(core.fetchBuiltinDetail(Infinity).ok, false);
  assert.strictEqual(core.fetchBuiltinDetail(1.5).ok, false);
});

test('fetchBuiltinDetail 有快照时返回全文，无快照时给出明确错误', () => {
  const r = core.fetchBuiltinDetail(0);
  assert.strictEqual(typeof r.ok, 'boolean');
  if (r.ok) {
    assert.ok(r.detail && typeof r.detail.content === 'string' && r.detail.content.length > 0);
    assert.strictEqual(r.detail.index, 0);
  } else {
    assert.ok(r.error, '失败必须带 error');
  }
});

test('injectionKey 带 index → 同名词条不互相顶掉', () => {
  const a = core.injectionKey(12, '全域工作流');
  const b = core.injectionKey(34, '全域工作流');
  assert.notStrictEqual(a, b);
  assert.ok(a.startsWith('lib12_'));
  assert.ok(b.startsWith('lib34_'));
  // 非法字符必须洗掉，否则标记块会破
  assert.ok(!/[\\/:*?"<>|]/.test(core.injectionKey(1, 'a/b:c*d?e"f<g>h|i')));
  assert.ok(!/\s/.test(core.injectionKey(1, 'a b  c')));
});

test('scanInjectionKeys / stripInjectionBlock 精准命中且不误伤其他内容', () => {
  const text = [
    '# 用户自己的规则',
    '重要内容 A',
    core.buildInjectionBlock('lib1_alpha', 'ALPHA-BODY'),
    '重要内容 B',
    core.buildInjectionBlock('shiyi-pack.md', 'PACK-BODY'),
    '重要内容 C'
  ].join('\n');

  assert.deepStrictEqual(core.scanInjectionKeys(text), ['lib1_alpha', 'shiyi-pack.md']);

  const r = core.stripInjectionBlock(text, 'lib1_alpha');
  assert.strictEqual(r.removed, true);
  assert.ok(!r.text.includes('ALPHA-BODY'), '目标块必须摘干净');
  assert.ok(r.text.includes('PACK-BODY'), '其他注入块不能被误伤');
  assert.ok(r.text.includes('重要内容 A') && r.text.includes('重要内容 B') && r.text.includes('重要内容 C'), '用户原文一个字都不能丢');

  const miss = core.stripInjectionBlock(text, 'lib999_ghost');
  assert.strictEqual(miss.removed, false);
  assert.strictEqual(miss.text.trim(), text.trim());
});

test('stripInjectionBlock 同 key 出现多次时全部摘除', () => {
  const text = 'HEAD' + core.buildInjectionBlock('lib1_a', 'ONE') + 'MID' + core.buildInjectionBlock('lib1_a', 'TWO') + 'TAIL';
  const r = core.stripInjectionBlock(text, 'lib1_a');
  assert.strictEqual(r.removed, true);
  assert.ok(!r.text.includes('ONE') && !r.text.includes('TWO'));
  assert.ok(r.text.includes('HEAD') && r.text.includes('MID') && r.text.includes('TAIL'));
});

test('libraryPlatformTargets 覆盖全部六平台且不抛异常', () => {
  const t = core.libraryPlatformTargets();
  assert.strictEqual(t.length, core.PACK_IDS.length);
  for (const row of t) {
    assert.ok(core.PACK_IDS.includes(row.id));
    assert.ok(['copy', 'append'].includes(row.mode));
    assert.strictEqual(typeof row.exists, 'boolean');
    assert.ok(Array.isArray(row.injectedKeys));
    assert.strictEqual(typeof row.injectedCount, 'number');
  }
});

test('importLibraryContent 拒绝未知平台', withSandboxTargets(async () => {
  await assert.rejects(() => core.importLibraryContent('nope', 'x', 'y'), /不支持注入/);
}));

test('importLibraryContent 拒绝空内容（不再默默写空文件）', withSandboxTargets(async () => {
  await assert.rejects(() => core.importLibraryContent('codex', 'x', ''), /内容为空/);
  await assert.rejects(() => core.importLibraryContent('codex', 'x', '   \n '), /内容为空/);
}));

test('importLibraryContent copy 平台（cursor）→ 落 .mdc 带 frontmatter 与标记块', withSandboxTargets(async (dir, patch) => {
  const r = await core.importLibraryContent('cursor', '全域工作流', 'BODY-TEXT', { index: 5 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.mode, 'copy');
  assert.strictEqual(r.key, 'lib5_全域工作流');
  assert.ok(r.dest.endsWith(`shiyi-imported-${r.key}.mdc`));
  assert.ok(r.dest.startsWith(patch.cursor.dir()));

  const body = fs.readFileSync(r.dest, 'utf8');
  assert.ok(body.startsWith('---\n'), 'cursor .mdc 必须有 frontmatter');
  assert.ok(body.includes('alwaysApply: true'));
  assert.ok(body.includes(`<!-- shiyi-imported:${r.key}:start -->`));
  assert.ok(body.includes('BODY-TEXT'));
}));

test('importLibraryContent append 平台（codex）→ 追加标记块且保留原文', withSandboxTargets(async (dir) => {
  const file = path.join(dir, 'codex-AGENTS.md');
  fs.writeFileSync(file, '# 用户原有规则\nKEEP-ME\n', 'utf8');

  const r = await core.importLibraryContent('codex', '测试词条', 'INJECTED-BODY', { index: 9 });
  assert.strictEqual(r.mode, 'append');
  assert.strictEqual(r.key, 'lib9_测试词条');

  const after = fs.readFileSync(file, 'utf8');
  assert.ok(after.includes('KEEP-ME'), '用户原文必须保留');
  assert.ok(after.includes(`<!-- shiyi-imported:${r.key}:start -->`));
  assert.ok(after.includes('INJECTED-BODY'));

  const scan = core.listLibraryInjections('codex');
  assert.strictEqual(scan.ok, true);
  assert.strictEqual(scan.items.length, 1);
  assert.strictEqual(scan.items[0].key, r.key);
  assert.strictEqual(scan.items[0].fromLibrary, true);
  assert.strictEqual(scan.items[0].index, 9);
}));

test('重复注入同一条 → 覆盖而不是堆叠（幂等）', withSandboxTargets(async () => {
  await core.importLibraryContent('codex', '重复测试', 'V1', { index: 3 });
  await core.importLibraryContent('codex', '重复测试', 'V2-UPDATED', { index: 3 });
  await core.importLibraryContent('codex', '重复测试', 'V3-FINAL', { index: 3 });

  const file = core.RULE_FILE_TARGETS.codex.file();
  const text = fs.readFileSync(file, 'utf8');
  const starts = text.match(/shiyi-imported:lib3_重复测试:start/g) || [];
  assert.strictEqual(starts.length, 1, `同 key 只允许存在一个块，实际 ${starts.length} 个`);
  assert.ok(!text.includes('V1') && !text.includes('V2-UPDATED'), '旧版本必须被替换');
  assert.ok(text.includes('V3-FINAL'));
}));

test('removeLibraryInjection 精准摘除，不影响用户自己的导入块', withSandboxTargets(async () => {
  await core.importLibraryContent('codex', '要删的', 'REMOVE-ME', { index: 1 });
  await core.importLibraryContent('codex', '要留的', 'STAY-ME', { index: 2 });
  const file = core.RULE_FILE_TARGETS.codex.file();
  // 模拟用户自己用「导入包」功能加的块
  fs.appendFileSync(file, core.buildImportBlock('shiyi-pack.md', 'USER-PACK-BODY'), 'utf8');

  const r = await core.removeLibraryInjection('codex', 'lib1_要删的');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.removed, 1);
  assert.ok(r.bytesAfter < r.bytesBefore);

  const after = fs.readFileSync(file, 'utf8');
  assert.ok(!after.includes('REMOVE-ME'));
  assert.ok(after.includes('STAY-ME'), '同平台其他词库注入不能被动');
  assert.ok(after.includes('USER-PACK-BODY'), '用户导入的块绝不能被词库卸载清掉');
}));

test('removeLibraryInjection 对不存在的 key 明确失败', withSandboxTargets(async () => {
  const r = await core.removeLibraryInjection('codex', 'lib999_ghost');
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
  await assert.rejects(() => core.removeLibraryInjection('codex', ''), /key 为空/);
}));

test('removeLibraryInjection copy 平台 → 删 .mdc 并留备份', withSandboxTargets(async (dir) => {
  const bak = path.join(dir, 'bak');
  const r = await core.importLibraryContent('cursor', '待删词条', 'BODY', { index: 8 });
  const gone = await core.removeLibraryInjection('cursor', r.key, { backupDir: bak });
  assert.strictEqual(gone.ok, true);
  assert.strictEqual(fs.existsSync(r.dest), false);
  const backups = fs.readdirSync(bak);
  assert.strictEqual(backups.length, 1, '删除前必须留一份可回滚备份');
}));

test('listLibraryInjections copy 平台：扫描 .mdc 目录并识别词库来源', withSandboxTargets(async (dir) => {
  await core.importLibraryContent('cursor', '词条A', 'AAA', { index: 1 });
  // 用户自己导入的规则文件（不带 lib 前缀）
  const rulesDir = path.join(dir, 'cursor-rules');
  fs.writeFileSync(path.join(rulesDir, 'shiyi-imported-my-own-rule.mdc'), '---\ndescription: x\n---\nOWN', 'utf8');

  const scan = core.listLibraryInjections('cursor');
  assert.strictEqual(scan.ok, true);
  assert.strictEqual(scan.mode, 'copy');
  assert.strictEqual(scan.items.length, 2);
  const fromLib = scan.items.find((x) => x.key === 'lib1_词条A');
  const own = scan.items.find((x) => x.key === 'my-own-rule');
  assert.ok(fromLib && fromLib.fromLibrary === true);
  assert.ok(own && own.fromLibrary === false, '非 lib 前缀必须判定为用户自有');
  assert.ok(fromLib.title.includes('词条A'));
}));

test('listLibraryInjections 目录不存在时安全返回空', withSandboxTargets(async () => {
  const scan = core.listLibraryInjections('cursor');
  assert.strictEqual(scan.ok, true);
  assert.deepStrictEqual(scan.items, []);
}));

test('listLibraryInjections 拒绝未知平台', () => {
  const r = core.listLibraryInjections('nope');
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test('buildImportBlock 与 injectionKey 的字符集一致（否则标记块扫不回来）', () => {
  const key = core.injectionKey(4, 'a b/c:d*e?f"g<h>i|j');
  const block = core.buildImportBlock(key, 'X');
  assert.deepStrictEqual(core.scanInjectionKeys(block), [key], `key ${key} 无法被回扫`);
});

test('resolveLibraryContent 本地命中时不联网', async () => {
  const meta = core.libraryMeta();
  if (!meta.ok || !meta.prompts.length) return; // 无快照环境跳过
  const r = await core.resolveLibraryContent(0);
  assert.strictEqual(r.ok, true);
  assert.ok(['local', 'bundled', 'remote'].includes(r.source));
  assert.ok(r.detail.content.length > 0);
});

test('快照齐备时 libraryStats 的 fullCount 与 previewOnly 自洽', () => {
  const s = core.libraryStats();
  assert.strictEqual(s.fullCount + s.previewOnly, s.total);
  assert.strictEqual(s.rates.r90 + s.rates.r80 + s.rates.r70 + s.rates.rLow + s.rates.rNone, s.total);
  const catSum = Object.values(s.categories).reduce((a, b) => a + b, 0);
  assert.strictEqual(catSum, s.total);
});

test('replace 模式（append 平台）：清掉其他词库块、保留用户导入块', withSandboxTargets(async () => {
  await core.importLibraryContent('codex', '旧词条A', 'OLD-A', { index: 1 });
  await core.importLibraryContent('codex', '旧词条B', 'OLD-B', { index: 2 });
  const file = core.RULE_FILE_TARGETS.codex.file();
  fs.appendFileSync(file, core.buildImportBlock('shiyi-pack.md', 'USER-PACK'), 'utf8');

  const r = await core.importLibraryContent('codex', '新词条', 'NEW-C', { index: 3, mode: 'replace' });
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.displaced));
  assert.strictEqual(r.displaced.length, 2, `应顶掉 2 个旧词库块，实际 ${r.displaced.length}`);
  assert.ok(r.displaced.includes('lib1_旧词条A') && r.displaced.includes('lib2_旧词条B'));

  const after = fs.readFileSync(file, 'utf8');
  assert.ok(!after.includes('OLD-A') && !after.includes('OLD-B'), '旧词库内容必须被清掉');
  assert.ok(after.includes('NEW-C'));
  assert.ok(after.includes('USER-PACK'), '用户导入块绝不能被 replace 清掉');
  const scan = core.listLibraryInjections('codex');
  const libKeys = scan.items.filter((x) => x.fromLibrary).map((x) => x.key);
  assert.deepStrictEqual(libKeys, ['lib3_新词条'], '替换后平台只剩这一条现役词库注入');
}));

test('replace 模式（copy 平台 cursor）：删旧 .mdc 留新，用户导入 .mdc 不动', withSandboxTargets(async (dir) => {
  const bak = path.join(dir, 'bak');
  await core.importLibraryContent('cursor', '旧词A', 'OLD-A', { index: 1 });
  await core.importLibraryContent('cursor', '旧词B', 'OLD-B', { index: 2 });
  const rulesDir = path.join(dir, 'cursor-rules');
  fs.writeFileSync(path.join(rulesDir, 'shiyi-imported-my-own.mdc'), 'OWN', 'utf8');

  const r = await core.importLibraryContent('cursor', '新词C', 'NEW-C', { index: 3, mode: 'replace', backupDir: bak });
  assert.strictEqual(r.displaced.length, 2);
  const left = fs.readdirSync(rulesDir).sort();
  assert.ok(left.includes('shiyi-imported-lib3_新词C.mdc'));
  assert.ok(left.includes('shiyi-imported-my-own.mdc'), '用户导入的 .mdc 必须保留');
  assert.ok(!left.some((n) => n.includes('lib1_') || n.includes('lib2_')), '旧词库 .mdc 必须被清掉');
  // 被顶掉的原件必须进了备份
  const backups = fs.readdirSync(bak);
  assert.ok(backups.filter((n) => n.includes('replaced')).length === 2, `备份数 ${backups.length}`);
}));

test('append 默认模式：多条词库注入共存（不互顶）', withSandboxTargets(async () => {
  await core.importLibraryContent('codex', '词A', 'A', { index: 1 });
  await core.importLibraryContent('codex', '词B', 'B', { index: 2 });
  const scan = core.listLibraryInjections('codex');
  assert.strictEqual(scan.items.filter((x) => x.fromLibrary).length, 2);
  const text = fs.readFileSync(core.RULE_FILE_TARGETS.codex.file(), 'utf8');
  assert.ok(text.includes('A') && text.includes('B'));
}));

test('verifyLibraryInjection：写入后复核 = exists + 哈希一致', withSandboxTargets(async () => {
  const r = await core.importLibraryContent('codex', '复核词条', 'VERIFY-BODY', { index: 7 });
  assert.ok(r.contentHash, '注入必须返回内容哈希');

  const v = core.verifyLibraryInjection('codex', r.key, r.contentHash);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.exists, true);
  assert.strictEqual(v.hashMatch, true);
  assert.strictEqual(v.verdict, 'active');
}));

test('verifyLibraryInjection：内容被改 → drifted', withSandboxTargets(async () => {
  const r = await core.importLibraryContent('codex', '漂移词条', 'ORIGINAL', { index: 8 });
  const file = core.RULE_FILE_TARGETS.codex.file();
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('ORIGINAL', 'TAMPERED-BY-CLIENT'), 'utf8');

  const v = core.verifyLibraryInjection('codex', r.key, r.contentHash);
  assert.strictEqual(v.exists, true);
  assert.strictEqual(v.hashMatch, false);
  assert.strictEqual(v.verdict, 'drifted');
}));

test('verifyLibraryInjection：标记块被删 → missing', withSandboxTargets(async () => {
  const r = await core.importLibraryContent('codex', '丢失词条', 'GONE', { index: 9 });
  const file = core.RULE_FILE_TARGETS.codex.file();
  fs.writeFileSync(file, '# 只剩用户自己的内容\n', 'utf8');

  const v = core.verifyLibraryInjection('codex', r.key, r.contentHash);
  assert.strictEqual(v.exists, false);
  assert.strictEqual(v.verdict, 'missing');
}));

test('verifyLibraryInjection：copy 平台同样能复核', withSandboxTargets(async () => {
  const r = await core.importLibraryContent('cursor', '复核cursor', 'CURSOR-BODY', { index: 4 });
  const v = core.verifyLibraryInjection('cursor', r.key, r.contentHash);
  assert.strictEqual(v.exists, true);
  assert.strictEqual(v.hashMatch, true);
  assert.strictEqual(v.verdict, 'active');

  // 删掉文件 → missing
  fs.rmSync(r.dest);
  const v2 = core.verifyLibraryInjection('cursor', r.key, r.contentHash);
  assert.strictEqual(v2.verdict, 'missing');
}));

test('verifyLibraryInjection 拒绝非法输入', withSandboxTargets(async () => {
  assert.strictEqual(core.verifyLibraryInjection('nope', 'k').ok, false);
  assert.strictEqual(core.verifyLibraryInjection('codex', '').ok, false);
}));

test('verifyLibraryPlatform：按 history 哈希逐块复核', withSandboxTargets(async () => {
  const r1 = await core.importLibraryContent('codex', '甲', 'AAA', { index: 1 });
  const r2 = await core.importLibraryContent('codex', '乙', 'BBB', { index: 2 });
  const history = [
    { platformId: 'codex', key: r1.key, contentHash: r1.contentHash },
    { platformId: 'codex', key: r2.key, contentHash: 'wrong-hash-on-purpose' },
    { platformId: 'cursor', key: 'lib99_x', contentHash: 'x' } // 别的平台的记录不串台
  ];
  const res = core.verifyLibraryPlatform('codex', history);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.items.length, 2);
  const a = res.items.find((x) => x.key === r1.key);
  const b = res.items.find((x) => x.key === r2.key);
  assert.strictEqual(a.verify.verdict, 'active');
  assert.strictEqual(b.verify.verdict, 'drifted', '哈希不符必须报漂移');
}));

// ==================== codex 破甲包 hook 协议回归（防 DeepSeek 400）====================
// 现场 bug：ishii_auto_route.py 在 PreToolUse/PostToolUse/SubagentStart 事件里
// 注入 additionalContext，Codex 把它当 developer 消息插进 assistant tool_calls
// 与 tool output 之间，严格 Chat Completions 状态机（DeepSeek 官方）直接甩
// HTTP 400 "No tool output found for tool call"。修复：工具事件纯放行。
// 这组测试直接 spawn 真 python 跑真 hook，锁死回归。

const HOOK_PY = path.join(__dirname, '..', 'packed-packs', 'codex', 'materials', 'hooks', 'ishii_auto_route.py');

function runHook(eventName, payloadExtra) {
  const { execFileSync } = require('node:child_process');
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hooktest-'));
  const payload = JSON.stringify({
    hook_event_name: eventName,
    session_id: 'sess-regression',
    prompt: '',
    ...(payloadExtra || {})
  });
  const out = execFileSync('python', [HOOK_PY], {
    input: payload,
    encoding: 'utf-8',
    env: { ...process.env, CODEX_HOME: tmpHome, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    timeout: 15000
  });
  fs.rmSync(tmpHome, { recursive: true, force: true });
  const line = out.trim().split('\n').filter(Boolean).pop();
  return JSON.parse(line);
}

test('hook 文件存在（回归测试前提）', () => {
  assert.ok(fs.existsSync(HOOK_PY), HOOK_PY + ' 必须存在');
});

test('PreToolUse 纯放行：绝不注入 additionalContext（DeepSeek 400 根因）', () => {
  const r = runHook('PreToolUse');
  assert.strictEqual(r.continue, true);
  assert.strictEqual(r.hookSpecificOutput, undefined, 'PreToolUse 不得带 hookSpecificOutput');
  assert.ok(!JSON.stringify(r).includes('additionalContext'), '任何形态的 additionalContext 都不允许');
});

test('PostToolUse 纯放行：绝不注入 additionalContext', () => {
  const r = runHook('PostToolUse');
  assert.strictEqual(r.continue, true);
  assert.ok(!JSON.stringify(r).includes('additionalContext'));
});

test('SubagentStart 纯放行：绝不注入 additionalContext', () => {
  const r = runHook('SubagentStart');
  assert.strictEqual(r.continue, true);
  assert.ok(!JSON.stringify(r).includes('additionalContext'));
});

test('SessionStart 仍然注入身份锁（非工具事件不受影响）', () => {
  const r = runHook('SessionStart');
  assert.strictEqual(r.continue, true);
  assert.ok(r.hookSpecificOutput && typeof r.hookSpecificOutput.additionalContext === 'string');
  assert.ok(r.hookSpecificOutput.additionalContext.includes('session start'), '会话锁文本应在位');
});

test('PreCompact 仍然注入压缩保活块', () => {
  const r = runHook('PreCompact');
  assert.strictEqual(r.continue, true);
  assert.ok(r.hookSpecificOutput && r.hookSpecificOutput.additionalContext.includes('post-compact'));
});

test('裸冷咖啡走唯一握手路径，不附加路由首行冲突', () => {
  const r = runHook('UserPromptSubmit', { prompt: '冷咖啡' });
  const context = r.hookSpecificOutput && r.hookSpecificOutput.additionalContext;
  assert.strictEqual(r.continue, true);
  assert.strictEqual(r.systemMessage, undefined, '裸暗号不得再附 systemMessage 路由回执');
  assert.ok(context && context.startsWith('[SESSION ENTRY ACK]'));
  assert.ok(!context.includes('[石井 ROUTE]'), '握手路径不得与路由首行契约冲突');
  assert.ok(!/\n\[ROUTE\]/.test(context) && !context.startsWith('[ROUTE]'), '握手路径不得附加路由回执');
});

test('router 不可用时普通请求仍有内建 route fallback', () => {
  const r = runHook('UserPromptSubmit', { prompt: '检查配置' });
  assert.strictEqual(r.continue, true);
  assert.ok(typeof r.systemMessage === 'string' && r.systemMessage.startsWith('[ROUTE]'));
  assert.ok(r.hookSpecificOutput.additionalContext.startsWith('[ROUTE]'));
});

test('materials/hooks.json 不再注册任何工具事件（安装侧根除夹层）', () => {
  const hooksPath = path.join(__dirname, '..', 'packed-packs', 'codex', 'materials', 'hooks.json');
  const data = JSON.parse(fs.readFileSync(hooksPath, 'utf-8'));
  const events = Object.keys(data.hooks || {});
  assert.ok(events.includes('UserPromptSubmit'), 'UserPromptSubmit 必须保留');
  for (const evt of ['PreToolUse', 'PostToolUse', 'SubagentStart']) {
    assert.ok(!events.includes(evt), `${evt} 注册必须移除（会撕开 tool_calls/tool-output 相邻性）`);
  }
  assert.ok(!events.includes('Stop'), 'Stop 注册会无条件拦截正常收尾，必须移除');
  assert.ok(!JSON.stringify(data).includes('slo-runtime-hook'), '失效 runtime-hook 不得继续注册');
});

test('models.json：deepseek-v4-flash-vision-exp 已关闭并发工具调用', () => {
  const modelsPath = path.join(__dirname, '..', 'packed-packs', 'codex', 'materials', 'models.json');
  const data = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
  const vision = (data.models || []).find((m) => m.slug === 'deepseek-v4-flash-vision-exp');
  assert.ok(vision, 'vision-exp 模型必须存在');
  assert.strictEqual(vision.supports_parallel_tool_calls, false, '现场报错模型必须串行执行工具');
});

/* ==================================================================
   codex_app 命名空间报错根治 · 软件安装路径不得漏修
   ------------------------------------------------------------------
   软件安装 codex 包走 DEPLOY_PLANS.codex.install → 直调 install-replica.ps1，
   完全不经过 Install-OneClick.cmd。所以修复必须内建在 ps1 里，挂在 cmd 上等于没修。
   ================================================================== */

const CODEX_PACK = path.join(__dirname, '..', 'packed-packs', 'codex');

test('LEGACY_QUARANTINE_PLANS.codex 直调 install-replica.ps1（故修复必须内建在 ps1，挂 cmd 上等于没修）', () => {
  const plan = core.LEGACY_QUARANTINE_PLANS.codex;
  assert.ok(plan && plan.install, 'codex legacy 必须有 install 计划');
  assert.strictEqual(plan.install.file, 'install-replica.ps1');
  assert.strictEqual(plan.install.kind, 'ps1');
  assert.ok(!String(plan.install.file).endsWith('.cmd'), '不走 cmd → Step 0 不会被触发');
  assert.ok(plan.install.args.includes('-NoOpenLinks'), '必须禁推广弹窗');
  assert.ok(plan.install.args.includes('-SkipAstra6'), '软件安装不得扫 Desktop/Documents 找号池');
  // 未登记同意时，生效计划仍是 DEPLOY_PLANS 里的空计划
  assert.strictEqual(core.deployPlanFor('codex').install, null);
});

test('install-replica.ps1 内建 [1.5/9] codex_app namespace fix', () => {
  const ps1 = fs.readFileSync(path.join(CODEX_PACK, 'install-replica.ps1'), 'utf-8');
  assert.match(ps1, /\[1\.5\/9\] codex_app namespace fix/, '必须有 [1.5/9] 步骤标记');
  assert.match(ps1, /patch_codex_asar_namespace\.py/, '必须调用命名空间补丁脚本');
  assert.match(ps1, /--auto/, '必须走 --auto（幂等：已打/无特征串返回 0）');
});

test('install-replica.ps1 的 Step 0 幂等、可跳过、失败不中断装包', () => {
  const ps1 = fs.readFileSync(path.join(CODEX_PACK, 'install-replica.ps1'), 'utf-8');
  assert.match(ps1, /\[switch\]\$SkipNamespaceFix,/, 'SkipNamespaceFix 后必须有逗号，否则 PS 直接解析失败');
  assert.match(ps1, /\[switch\]\$SkipAstra6/, '必须提供 -SkipAstra6 开关');
  assert.match(ps1, /if \(\$SkipAstra6\)/, 'astra6 扫描必须可跳过');
  assert.match(ps1, /C18FE139D9B594E40BFFE26B9CA0CF53BE5C3EA996CD8B5D1D9D5F1D6947B7D6/, '1.4 内嵌 hook 哈希必须可升级');
  assert.match(ps1, /B301B25FDECBF2D4A1F7E5B9E309DADF0E450B0A44222B254810C24A11A8E6E1/, '独立 v10.4 hook 哈希必须可升级');
  assert.match(ps1, /if \(-not \$SkipNamespaceFix\)/, '步骤必须可跳过');
  assert.match(ps1, /\$ErrorActionPreference = 'Continue'/, '调外部命令前必须放宽 EAP，避免 stderr 被当致命错误');
  assert.match(ps1, /\$ErrorActionPreference = \$prevEap/, '必须恢复原 EAP');

  const start = ps1.indexOf('[1.5/9] codex_app namespace fix');
  const end = ps1.indexOf('[2/9] config.toml', start);
  assert.ok(start > -1 && end > start, 'Step 0 必须排在 [2/9] 之前');
  const block = ps1.slice(start, end);
  assert.ok(!/exit\s+1/.test(block), 'Step 0 内不得 exit 1 —— 补丁失败只告警，装包必须继续');
  assert.match(block, /\[WARN\]/, '失败路径必须有 WARN 提示');
});

test('install-replica.ps1 的 Step 0 排在「Codex 未运行」守卫之后（此刻 app.asar 可写）', () => {
  const ps1 = fs.readFileSync(path.join(CODEX_PACK, 'install-replica.ps1'), 'utf-8');
  const guard = ps1.indexOf('if (-not $Force -and (Test-RunningCodex))');
  const step0 = ps1.indexOf('[1.5/9] codex_app namespace fix');
  assert.ok(guard > -1, '必须存在 Codex 运行守卫');
  assert.ok(step0 > guard, 'Step 0 必须在运行守卫之后执行');
});

test('install-replica.ps1 仍为纯 CRLF 且保留 BOM（PS 5.1 下中文不乱码）', () => {
  const buf = fs.readFileSync(path.join(CODEX_PACK, 'install-replica.ps1'));
  assert.deepStrictEqual([...buf.slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM 必须保留');
  const s = buf.toString('latin1'); // 逐字节安全
  const lf = (s.match(/\n/g) || []).length;
  const crlf = (s.match(/\r\n/g) || []).length;
  assert.ok(lf > 0 && lf === crlf, `不得出现裸 LF（LF=${lf} CRLF=${crlf}）`);
});

test('Install-OneClick.cmd 保留 Step 0，且排在装包之前', () => {
  const cmd = fs.readFileSync(path.join(CODEX_PACK, 'Install-OneClick.cmd'), 'utf-8');
  const step0 = cmd.indexOf('Step 0: Codex "codex_app" namespace fix');
  const installCall = cmd.indexOf('"%~dp0install-replica.ps1"');
  assert.ok(step0 > -1, '手动路径必须保留 Step 0 提示');
  assert.ok(installCall > -1, '必须调用 install-replica.ps1');
  assert.ok(step0 < installCall, 'Step 0 必须在装包之前');
  assert.match(cmd, /codex-namespace-fix\\patch_codex_asar_namespace\.py/);
});

test('codex-namespace-fix 五件齐、无 __pycache__/.pyc 污染、参数齐全', () => {
  const dir = path.join(CODEX_PACK, 'codex-namespace-fix');
  assert.ok(fs.existsSync(dir), '包内必须带 codex-namespace-fix');
  for (const f of [
    'FIX-NAMESPACE.cmd',
    '一键修复Codex命名空间报错.cmd',
    'patch_codex_asar_namespace.py',
    'check_codex_flatten.py',
    '说明.txt'
  ]) {
    assert.ok(fs.existsSync(path.join(dir, f)), `缺文件: ${f}`);
  }
  const entries = fs.readdirSync(dir);
  assert.ok(!entries.includes('__pycache__'), '不得夹带 __pycache__');
  assert.ok(!entries.some((n) => n.endsWith('.pyc')), '不得夹带 .pyc');

  const py = fs.readFileSync(path.join(dir, 'patch_codex_asar_namespace.py'), 'utf-8');
  for (const a of ['--asar', '--check', '--auto', '--audit', '--jscheck', '--selftest', '--restore']) {
    assert.ok(py.includes(`"${a}"`), `补丁脚本缺参数 ${a}`);
  }
});

test('Step 0 不得把补丁脚本的输出接进管道（否则控制台代码页会毁掉 UTF-8）', () => {
  const ps1 = fs.readFileSync(path.join(CODEX_PACK, 'install-replica.ps1'), 'utf-8');
  // 走管道 = 宿主先按控制台代码页解码再重编码；非中文 locale 下这一步不可逆，
  // 补丁脚本的 UTF-8 提示会变成乱码。必须让子进程字节直通。
  assert.ok(
    !/&\s*python[^\r\n]*\|/.test(ps1),
    'python 调用后不得接管道（会经宿主解码/重编码，损坏 UTF-8）'
  );
  assert.match(ps1, /& python \$nxScript --auto/);
});

test('install-replica.ps1 全局钉死 UTF-8 输出（非中文 locale 下日志不乱码）', () => {
  const ps1 = fs.readFileSync(path.join(CODEX_PACK, 'install-replica.ps1'), 'utf-8');
  // 宿主默认用控制台代码页写自己的字符串（zh-CN 是 GBK、en-US 是 CP437），
  // 而辅助脚本吐 UTF-8 —— 读取侧只能逐块猜编码，非中文 locale 下会有一半乱码。
  assert.match(ps1, /\[Console\]::OutputEncoding = New-Object System\.Text\.UTF8Encoding\(\$false\)/);
  const at = ps1.indexOf('Pin the whole script');
  const py = ps1.indexOf("$env:PYTHONUTF8 = '1'");
  assert.ok(at > -1 && at > py, '全局编码钉死必须紧跟 PYTHONUTF8 设置');
  assert.ok(at < ps1.indexOf('[1.5/9]'), '必须早于 Step 0，才能覆盖补丁脚本的输出');
});

/* ==================================================================
   反夹层（No tool output 400）· 安装侧清理 + 升级保护 + 装后自检
   ------------------------------------------------------------------
   hooks 脚本此前在 PreToolUse/PostToolUse/SubagentStart 注入 additionalContext，
   Codex 把它拼成 assistant(tool_calls) 与 tool 输出之间的 developer 消息，
   严格 Chat Completions 提供方（DeepSeek）回 HTTP 400 No tool output found。
   脚本层已修；安装器还必须把历史遗留的注册从目标 hooks.json 里清掉。
   ================================================================== */

test('install-replica.ps1 主动清理目标 hooks.json 里遗留的托管条目（含工具事件 / Stop）', () => {
  const ps1 = fs.readFileSync(path.join(CODEX_PACK, 'install-replica.ps1'), 'utf-8');
  assert.match(ps1, /First prune every managed entry from every existing event/);
  assert.match(ps1, /ishii_auto_route\|slo-runtime-hook/, '必须按托管标记清理旧条目');
  assert.match(ps1, /obsolete v6\/v9\.3 registrations \(PreToolUse, Stop/);

  const pruneAt = ps1.indexOf('First prune every managed entry from every existing event');
  const mergeAt = ps1.indexOf('foreach ($evtName in $evtNames) {');
  assert.ok(pruneAt > -1 && mergeAt > pruneAt, '清理必须排在合并循环之前');

  const matHooks = JSON.parse(
    fs.readFileSync(path.join(CODEX_PACK, 'materials', 'hooks.json'), 'utf-8')
  );
  const matEvents = Object.keys(matHooks.hooks || {});
  assert.ok(!matEvents.includes('PreToolUse'), '前提：包内不得再声明 PreToolUse');
  assert.ok(!matEvents.includes('Stop'), '前提：包内不得再声明 Stop');
});

test('install-replica.ps1 的 hooks 脚本部署：始终落修复版 + 备份 + 四态日志', () => {
  const ps1 = fs.readFileSync(path.join(CODEX_PACK, 'install-replica.ps1'), 'utf-8');
  assert.match(ps1, /\$hookSrcHash = \(Get-FileHash -LiteralPath \$hookPySrc -Algorithm SHA256\)\.Hash/);
  assert.match(ps1, /\$hookDstHash/, '必须取目标文件哈希做比对');
  for (const tag of ['[deploy]', '[keep]', '[upgrade]', '[force]']) {
    assert.ok(ps1.includes(tag), `缺日志态 ${tag}`);
  }
  // 无论目标是什么，最终都必须落下包内修复版（保证旧夹层版必被替换）
  const hashCompare = ps1.indexOf('$hookDstHash -ne $hookSrcHash');
  const deployCopy = ps1.indexOf('Copy-Item -LiteralPath $hookPySrc -Destination $hookPyTarget -Force');
  assert.ok(hashCompare > -1 && deployCopy > hashCompare, '哈希比对之后必须无条件落包内修复版');
  assert.match(ps1, /Backup 'hooks\\ishii_auto_route\.py'\) -Force/, '旧文件必须先备份');
});

test('install-replica.ps1 装后自检：hooks 零工具事件注入 + hooks.json 未注册工具事件', () => {
  const ps1 = fs.readFileSync(path.join(CODEX_PACK, 'install-replica.ps1'), 'utf-8');
  const sec = ps1.indexOf('anti-interleave self-check');
  assert.ok(sec > -1, '必须存在反夹层自检段');

  const selfCheck = ps1.slice(sec, ps1.indexOf('[9/9] install manifest', sec));
  assert.match(selfCheck, /_ctx\\\(\\s\*\.\?PreToolUse/, '必须检测脚本内的工具事件注入');

  // 必须硬失败（throw），不能只 WARN —— 否则用户以为装好了
  const throws = (selfCheck.match(/throw /g) || []).length;
  assert.ok(throws >= 2, `自检必须两处硬失败（脚本注入 / hooks.json 注册），实得 ${throws}`);
  assert.match(selfCheck, /反夹层校验通过/, '通过路径要有 [OK] 日志');
  assert.ok(
    selfCheck.indexOf('hooks 脚本仍含工具事件注入') < selfCheck.indexOf('反夹层校验通过'),
    '先断言脚本、再断言 hooks.json，最后才打通过日志'
  );
});

test('包内 hooks 脚本对三个工具事件零 additionalContext 注入（现场脚本级根除）', () => {
  const hook = fs.readFileSync(
    path.join(CODEX_PACK, 'materials', 'hooks', 'ishii_auto_route.py'),
    'utf-8'
  );
  assert.ok(
    !/emit\(_ctx\("(PreToolUse|PostToolUse|SubagentStart)"/.test(hook),
    '不得在任何工具事件上注入 additionalContext（会撕开 tool_calls/tool-output 相邻性）'
  );
  const fixes = (hook.match(/v7\.3 FIX/g) || []).length;
  assert.ok(fixes >= 3, `三个工具事件都应带 v7.3 FIX 注释，实得 ${fixes}`);
  // 保活/锁只允许挂在非工具事件上
  assert.match(hook, /emit\(_ctx\("PreCompact", COMPACT_KEEP\)/);
  assert.match(hook, /emit\(_ctx\("SessionStart", SESSION_LOCK\)/);
});

test('install-replica.ps1 把 targetHooks 整树转成字典（PSCustomObject 换机必崩）', () => {
  const ps1 = fs.readFileSync(path.join(CODEX_PACK, 'install-replica.ps1'), 'utf-8');
  assert.match(ps1, /function ConvertTo-DeepDict/, '必须提供 ConvertTo-DeepDict');
  assert.match(ps1, /ConvertTo-DeepDict \(Get-Content -LiteralPath \$hooksPath/);
  assert.match(ps1, /ConvertTo-DeepDict \(Get-Content -LiteralPath \(Join-Path \$Mat 'hooks\.json'\)/);
  const convert = ps1.indexOf('function ConvertTo-DeepDict');
  const merge = ps1.indexOf('foreach ($evtName in $evtNames) {');
  assert.ok(convert > -1 && merge > convert, '转字典必须发生在合并循环之前');
});

test('install-replica.ps1 的 targetHooks 键判断必须走 IDictionary（不能用 PSObject.Properties.Name）', () => {
  const ps1 = fs.readFileSync(path.join(CODEX_PACK, 'install-replica.ps1'), 'utf-8');
  const bad = (ps1.match(/@\(\$targetHooks\.hooks\.PSObject\.Properties\.Name\)/g) || []).length;
  assert.strictEqual(bad, 0, '不得对 targetHooks.hooks 用 PSObject.Properties.Name 判键');
  assert.match(ps1, /\$targetHooks\['hooks'\]\.Contains\('UserPromptSubmit'\)/);
  assert.match(ps1, /\$targetHooks\.hooks\.Contains\(\$toolEvt\)/, '装后自检必须用 Contains 判工具事件');
  assert.match(ps1, /\$targetHooks\.hooks\.Remove\(\$existingEvtName\)/);
});

const WB_PACK = path.join(__dirname, '..', 'packed-packs', 'workbuddy');

test('DEPLOY_PLANS.workbuddy 直调 Install-WB-OneClick.ps1 且禁 pause/弹窗', () => {
  const plan = core.DEPLOY_PLANS.workbuddy;
  assert.strictEqual(plan.install.file, 'Install-WB-OneClick.ps1');
  assert.strictEqual(plan.install.kind, 'ps1');
  assert.ok(plan.install.args.includes('-NoOpenLinks'));
  assert.strictEqual(plan.uninstall.file, 'Install-WB-OneClick.ps1');
  assert.ok(plan.uninstall.args.includes('-Uninstall'));
  assert.ok(plan.uninstall.args.includes('-NoOpenLinks'));
});

test('内嵌 WorkBuddy 包是 v4.4 且必备脚本齐', () => {
  const readme = fs.readFileSync(path.join(WB_PACK, 'README-CN.txt'), 'utf-8');
  assert.match(readme.split(/\r?\n/)[1] || '', /v4\.4/, 'README 第二行必须是 v4.4');
  const ver = core.extractVersion(WB_PACK, core.PACKS.find((p) => p.id === 'workbuddy').versionSources);
  assert.strictEqual(ver.version, '4.4', `卡片版本必须是 4.4，实得 ${ver && ver.version}`);
  for (const rel of [
    'Install-WB-OneClick.ps1',
    'patch-cli-layer.ps1',
    'patch-inject-layer.ps1',
    'verify-install.ps1',
    'selftest-upgrade.ps1',
    'materials/IDENTITY.md',
    'pristine-seed',
  ]) {
    assert.ok(fs.existsSync(path.join(WB_PACK, rel)), `缺 ${rel}`);
  }
  assert.ok(!fs.existsSync(path.join(WB_PACK, '_quarantine')), '不得打进本机 quarantine');
  const inst = fs.readFileSync(path.join(WB_PACK, 'Install-WB-OneClick.ps1'), 'utf-8');
  assert.match(inst, /\[7\/7\]/, '必须有 [7/7] 注入层步骤');
  assert.match(inst, /patch-inject-layer\.ps1/);
  assert.match(inst, /Find-AllProgs|只有命令行显式给了 -WBProgPath/);
  const cli = fs.readFileSync(path.join(WB_PACK, 'patch-cli-layer.ps1'), 'utf-8');
  assert.match(cli, /IsSandbox/, '必须有 Temp/wb-selftest 沙箱硬防护');
});

const AG_PACK = path.join(__dirname, '..', 'packed-packs', 'anti-gravity');

test('LEGACY_QUARANTINE_PLANS.anti-gravity 直调 Install-AntiGravity.ps1 且禁弹窗', () => {
  const plan = core.LEGACY_QUARANTINE_PLANS['anti-gravity'];
  assert.strictEqual(plan.install.file, 'Install-AntiGravity.ps1');
  assert.strictEqual(plan.install.kind, 'ps1');
  assert.ok(plan.install.args.includes('-NoOpenLinks'));
  assert.strictEqual(plan.uninstall.file, 'Uninstall.ps1');
  // 未登记同意时，生效计划仍是 DEPLOY_PLANS 里的空计划
  assert.strictEqual(core.deployPlanFor('anti-gravity').install, null);
});

test('内嵌反重力包是 v3.2 且三通道素材齐', () => {
  const readme = fs.readFileSync(path.join(AG_PACK, 'README-CN.txt'), 'utf-8');
  assert.match(readme.split(/\r?\n/)[0] || '', /v3\.2/, 'README 第一行必须是 v3.2');
  const ver = core.extractVersion(AG_PACK, core.PACKS.find((p) => p.id === 'anti-gravity').versionSources);
  assert.strictEqual(ver.version, '3.2', `卡片版本必须是 3.2，实得 ${ver && ver.version}`);
  for (const rel of [
    'Install-AntiGravity.ps1',
    'verify-install.ps1',
    'selftest-upgrade.ps1',
    'Uninstall.ps1',
    'materials/rules/ag-armor.md',
    'materials/plugin/skills/coldbrew-breakout/SKILL.md',
    'pristine-seed/app-update.yml.orig',
  ]) {
    assert.ok(fs.existsSync(path.join(AG_PACK, rel)), `缺 ${rel}`);
  }
  assert.ok(!fs.existsSync(path.join(AG_PACK, 'backups')), '不得打进本机 backups');
  const inst = fs.readFileSync(path.join(AG_PACK, 'Install-AntiGravity.ps1'), 'utf-8');
  assert.match(inst, /\[7\/7\]|\[6\/7\]/, '必须有分步安装');
  assert.match(inst, /ag_patch_agents\.ps1/);
  const patch = fs.readFileSync(path.join(AG_PACK, 'materials', 'scripts', 'ag_patch_agents.ps1'), 'utf-8');
  assert.match(patch, /GeminiConfig/, '必须支持隔离配置根');
});

const CURSOR_PACK = path.join(__dirname, '..', 'packed-packs', 'cursor');

test('内嵌 Cursor 包是懒人包 v1.2 且 18 条规则齐', () => {
  const readme = fs.readFileSync(path.join(CURSOR_PACK, 'README-CN.txt'), 'utf-8');
  assert.match(readme.split(/\r?\n/)[0] || '', /v1\.2/, 'README 第一行必须是 v1.2');
  const ver = core.extractVersion(CURSOR_PACK, core.PACKS.find((p) => p.id === 'cursor').versionSources);
  assert.strictEqual(ver.version, '1.2', `卡片版本必须是 1.2，实得 ${ver && ver.version}`);
  for (const rel of [
    'setup.py',
    '一键安装.bat',
    '一键卸载.bat',
    '使用说明.txt',
    'materials/tools/cursor_tamper_proxy.py',
    'materials/rules/shiyi-00-core.mdc',
    'materials/rules/shiyi-G47-sandbox.mdc',
    'materials/rules/shiyi-T1-tamper.mdc',
    'materials/rules/shiyi-N1-normalize.mdc'
  ]) {
    assert.ok(fs.existsSync(path.join(CURSOR_PACK, rel)), `缺 ${rel}`);
  }
  const mdc = fs.readdirSync(path.join(CURSOR_PACK, 'materials', 'rules')).filter((n) => n.endsWith('.mdc'));
  assert.strictEqual(mdc.length, 18, `规则必须 18 条，实得 ${mdc.length}`);
  assert.ok(!fs.existsSync(path.join(CURSOR_PACK, 'install_cursor.py')), '不得残留旧 install_cursor.py');
  assert.ok(!fs.existsSync(path.join(CURSOR_PACK, '实测记录')), '不得打进实测记录');
  const setup = fs.readFileSync(path.join(CURSOR_PACK, 'setup.py'), 'utf-8');
  assert.match(setup, /PACK_VERSION = "v1\.2"/);
  assert.match(setup, /--no-open/);
  assert.match(setup, /--root/);
});

const WBAI_PACK = path.join(__dirname, '..', 'packed-packs', 'workbuddy-ai');

test('DEPLOY_PLANS.workbuddy-ai 直调 Install-WBAI-LazyPack.ps1 且禁弹窗', () => {
  const plan = core.DEPLOY_PLANS['workbuddy-ai'];
  assert.strictEqual(plan.install.file, 'Install-WBAI-LazyPack.ps1');
  assert.strictEqual(plan.install.kind, 'ps1');
  assert.ok(plan.install.args.includes('-NoOpenLinks'));
  assert.strictEqual(plan.uninstall.file, 'Install-WBAI-LazyPack.ps1');
  assert.ok(plan.uninstall.args.includes('-Uninstall'));
  assert.ok(plan.uninstall.args.includes('-NoOpenLinks'));
  const labels = plan.evidence.map((e) => e.label).join('|');
  assert.ok(/\.workbuddy-ai/.test(labels), 'evidence 必须锁国际版配置根');
  assert.ok(!/\.workbuddy\//.test(labels), '不得落到国内版 .workbuddy');
});

test('内嵌 WorkBuddy AI 国际版包是 v1.3 且必备文件齐', () => {
  const readme = fs.readFileSync(path.join(WBAI_PACK, 'README-CN.txt'), 'utf-8');
  assert.match(readme.split(/\r?\n/)[1] || readme.split(/\r?\n/)[0] || '', /v1\.3/, 'README 必须是 v1.3');
  const ver = core.extractVersion(WBAI_PACK, core.PACKS.find((p) => p.id === 'workbuddy-ai').versionSources);
  assert.strictEqual(ver.version, '1.3', `卡片版本必须是 1.3，实得 ${ver && ver.version}`);
  for (const rel of [
    'Install-WBAI-LazyPack.ps1',
    'Verify-LazyPack.ps1',
    '一键安装-双击这里.cmd',
    '卸载-恢复原状.cmd',
    'materials/IDENTITY.md',
    'materials/MEMORY.md',
    'materials/SOUL-snippet.txt',
    'tools/verify_all.py'
  ]) {
    assert.ok(fs.existsSync(path.join(WBAI_PACK, rel)), `缺 ${rel}`);
  }
  assert.ok(!fs.existsSync(path.join(WBAI_PACK, 'DATA-LAYER-VERIFY.md')), '不得打进本机数据层报告');
  const inst = fs.readFileSync(path.join(WBAI_PACK, 'Install-WBAI-LazyPack.ps1'), 'utf-8');
  assert.match(inst, /PACK_VERSION|v1\.3|懒人包 v1\.3/);
  assert.match(inst, /-NoOpenLinks/);
  assert.match(inst, /-WBHomePath/);
  assert.match(inst, /\.workbuddy-ai/);
});

// 隔离构建 harness 曾在三处把「上一版的证据目录」和「上一版的期望版本」钉死在源码里：
// 证据被写进上一版的 reports/ 后又撞上 fresh-destination 守卫，PE 版本断言直接挡住新版打包。
// 这里钉死「必须走环境变量」的契约，防止再次漂移。
// 一版专用的一次性工具（isolated-build-prepare44.py / -proof.py / -bundle.py / -retry.py /
// -classify-av.py / -av-baseline.py）仍保留 1.5.5 常量，属历史归档，不在本契约内。
test('隔离构建 harness 的证据目录与期望版本必须走环境变量', () => {
  const dir = path.join(__dirname, '..', 'scripts');
  const read = (name) => fs.readFileSync(path.join(dir, name), 'utf-8');

  for (const [name, marker] of [
    ['isolated-build-verify.cjs', /process\.env\.ISOLATED_BUILD_BASE/],
    ['isolated-build-runtime-proof.py', /os\.environ\.get\('ISOLATED_BUILD_BASE'/],
    ['isolated-build-guest.sh', /ISOLATED_BUILD_BASE:-/]
  ]) {
    const src = read(name);
    assert.match(src, marker, `${name} 必须支持 ISOLATED_BUILD_BASE 覆盖`);
    for (const line of src.split(/\r?\n/)) {
      if (!line.includes('/home/builder/')) continue;
      assert.ok(
        /ISOLATED_BUILD_(BASE|DOWNLOADS)/.test(line),
        `${name} 出现未经环境变量覆盖的 guest 路径: ${line.trim()}`
      );
    }
  }

  assert.doesNotMatch(read('isolated-build-verify.cjs'), /const base = '/, 'base 不得是裸字面量');
  assert.doesNotMatch(read('isolated-build-verify.cjs'), /const buildId = '/, 'buildId 不得是裸字面量');

  const pe = read('isolated-build-pe.py');
  assert.match(pe, /os\.environ\.get\('EXPECTED_APP_VERSION'/, 'PE 期望版本必须来自 EXPECTED_APP_VERSION');
  assert.doesNotMatch(pe, /==\s*\[1,\s*5,\s*\d+,\s*0\]/, 'PE 版本不得钉死在源码里');

  const runtime = read('isolated-build-runtime-proof.py');
  assert.match(runtime, /os\.environ\.get\('ISOLATED_BUILD_DOWNLOADS'/, '下载缓存目录必须可覆盖');
  assert.doesNotMatch(runtime, /'buildId': 'susu1/, 'runtime-proof 的 buildId 不得钉死');
});
