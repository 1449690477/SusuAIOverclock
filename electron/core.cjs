'use strict';

/**
 * core.cjs — Dango Desk 的共享业务层（无 Electron 依赖，并非纯函数模块）
 *
 * 边界说明（重要）：
 *   扫描/哈希只读；平台检测可查询系统注册表和进程列表，不启动目标客户端。
 *   词库管理会写入用户规则文件。部署参数受发布隔离策略与来源检查约束，
 *   实际安装/卸载与深度会话由主进程执行；不可把本模块当纯策略测试加载。
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { RELEASE_PACK_IDS, QUARANTINED_PACKS, getPackBlockReason, assertPackAllowed, hasQuarantineConsent } = require('./security-policy.cjs');
const { assertPackSourceAllowed, missingExpectedEntries } = require('./pack-source-policy.cjs');

const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', '__pycache__', '.venv', 'venv']);
const MAX_CHANGE_ITEMS = 200;

/**
 * 平台展示定义：六个发布包，三个已隔离的旧载荷保留说明与平台检测；
 * 隔离包不再"强制只读"——登记知情同意后解锁安装/卸载/备份/深度验证。
 * expected 支持 * 通配（前缀匹配），用于 install-manifest-*.json 这类带时间戳的文件。
 * version 来源按顺序尝试，第一个命中的生效，并把来源一并回报给 UI（不猜、不编造）。
 */
const PACKS = [
  {
    id: 'codex',
    name: 'Codex 冷咖啡石井 · 旧载荷（已隔离）',
    subtitle: '知情同意后可安装 · 受影响的 slo-runtime-hook.exe 见隔离说明',
    folder: 'codex',
    target: 'Codex CLI / 桌面端',
    accent: 'sakura',
    note: QUARANTINED_PACKS.codex,
    expected: ['Install-OneClick.cmd', 'install-replica.ps1', 'check_codex.ps1', 'materials', 'README-CN.txt', 'Uninstall.ps1'],
    versionSources: [
      { kind: 'firstLines', file: 'README-CN.txt', maxLines: 5, pattern: '破甲包 v(\\d+\\.\\d+(?:\\.\\d+)?)' },
      { kind: 'firstLines', file: 'README-CN.txt', maxLines: 20, pattern: '【v(\\d+\\.\\d+(?:\\.\\d+)?)' },
      { kind: 'firstLines', file: 'README-CN.txt', maxLines: 5, pattern: 'v(\\d+\\.\\d+(?:\\.\\d+)?)' }
    ]
  },
  {
    id: 'codex-panghu',
    name: 'Codex 胖虎 · 旧载荷（已隔离）',
    subtitle: '知情同意后可安装 · 禁止运行随包 Python 与启动器',
    folder: 'codex-panghu',
    target: 'Codex CLI / 桌面端',
    accent: 'tiger',
    note: QUARANTINED_PACKS['codex-panghu'],
    expected: ['install.ps1', 'keysmith', 'prompts', 'manifest.sha256', 'README-CN.txt'],
    versionSources: [
      { kind: 'firstLines', file: 'README-CN.txt', maxLines: 3, pattern: 'v(\\d+\\.\\d+\\.\\d+)' },
      { kind: 'firstLines', file: 'install.ps1', maxLines: 20, pattern: 'codex-instruct-v(\\d+\\.\\d+\\.\\d+)\\.py' }
    ]
  },
  {
    id: 'cursor',
    name: 'Cursor 破甲包',
    subtitle: '懒人包 v1.2 · 18 条用户规则全局生效',
    folder: 'cursor',
    target: 'Cursor 编辑器',
    accent: 'matcha',
    note: 'v1.2：setup.py 直装 ~/.cursor/rules 18 条；可选响应篡改代理默认关闭。软件侧带 --no-open，不弹官网。',
    expected: [
      'setup.py',
      '一键安装.bat',
      '一键卸载.bat',
      '使用说明.txt',
      'README-CN.txt',
      'materials',
      'materials/rules',
      'materials/tools/cursor_tamper_proxy.py'
    ],
    versionSources: [
      { kind: 'firstLines', file: 'README-CN.txt', maxLines: 3, pattern: 'v(\\d+\\.\\d+)' },
      { kind: 'firstLines', file: '使用说明.txt', maxLines: 5, pattern: 'v(\\d+\\.\\d+)' },
      { kind: 'firstLines', file: 'setup.py', maxLines: 90, pattern: 'PACK_VERSION\\s*=\\s*"v(\\d+\\.\\d+)"' }
    ]
  },
  {
    id: 'dsh',
    name: 'DSH 破甲懒人包',
    subtitle: 'DeepSeek Harness · 五层架构',
    folder: 'dsh',
    target: 'DeepSeek Harness',
    accent: 'yuzu',
    note: 'v5.7.0：GLM5.3 拒答触发器中性化、profile patch 自愈、启动日志探活与 52 项双侧冒烟护栏。',
    expected: [
      'install.bat',
      'install.ps1',
      'materials',
      'plugins',
      'prompts',
      'tools',
      'README-CN.txt',
      'MAINTENANCE-HANDOVER.md',
      'Uninstall.cmd',
      'VERSION',
      'SHA256SUMS.txt',
      'SHA256SUMS.json'
    ],
    versionSources: [
      { kind: 'firstLines', file: 'VERSION', maxLines: 5, pattern: 'version=(\\d+\\.\\d+\\.\\d+)' },
      { kind: 'firstLines', file: 'README-CN.txt', maxLines: 80, pattern: 'v(\\d+\\.\\d+\\.\\d+)' },
      { kind: 'firstLines', file: 'install.ps1', maxLines: 10, pattern: 'v(\\d+)\\b' }
    ]
  },
  {
    id: 'claude',
    name: 'Claude Code 破甲包',
    subtitle: '冷咖啡 CHA · Claude 席位独立注入器',
    folder: 'claude',
    target: 'Claude Code',
    accent: 'clay',
    note: '冷咖啡 v2.3.6 Claude 席位：CLAUDE.md 标记块 + rules/cha-breakopen.md + 86 个 SKILL.md（6 父路由 / 80 叶子）。install-claude.py 直装并首次自动备份，卸载按备份与标记精准回滚。',
    expected: [
      'install-claude.py',
      'CLAUDE.md.cha-block.md',
      'routes',
      'routes/leaves',
      'workflows',
      'README-CN.txt'
    ],
    versionSources: [{ kind: 'firstLines', file: 'README-CN.txt', maxLines: 8, pattern: 'v(\\d+\\.\\d+\\.\\d+)' }]
  },
  {
    id: 'opencode',
    name: 'OpenCode 破甲包',
    subtitle: 'asar 逆向 · 权限默认放行',
    folder: 'opencode',
    target: 'OpenCode Desktop',
    accent: 'kuromi',
    note: 'V2 全破版，本轮未改动。',
    expected: [
      'package.json',
      'install.cmd',
      'install.ps1',
      'merge-config.mjs',
      'opencode.jsonc',
      'patch-opencoe.js',
      'plugins',
      'AGENTS.md',
      'README.md',
      'shield-protocol.md'
    ],
    versionSources: [{ kind: 'packageJson', file: 'package.json' }]
  },
  {
    id: 'workbuddy',
    name: 'WorkBuddy 破甲包',
    subtitle: 'IDENTITY / MEMORY / SOUL + CLI 注入层 v4.4',
    folder: 'workbuddy',
    target: 'WorkBuddy 客户端',
    accent: 'soda',
    note: 'v4.4：注入层去对抗签名；多安装根 Find-AllProgs；Temp 沙箱禁止自扫真机；Omen 桥接已迁到 _deprecated-omen-bridge。',
    expected: [
      'Install-OneClick.bat',
      'Install-WB-OneClick.ps1',
      'patch-cli-layer.ps1',
      'patch-inject-layer.ps1',
      'verify-install.ps1',
      'selftest-upgrade.ps1',
      'materials',
      'pristine-seed',
      'README-CN.txt',
      'README-UPGRADE-v4.4.md',
      'Uninstall.bat',
      'Verify-OneClick.cmd'
    ],
    versionSources: [
      { kind: 'firstLines', file: 'README-CN.txt', maxLines: 5, pattern: 'v(\\d+\\.\\d+)' },
      { kind: 'firstLines', file: 'Install-WB-OneClick.ps1', maxLines: 8, pattern: 'v(\\d+\\.\\d+)' }
    ]
  },
  {
    id: 'workbuddy-ai',
    name: 'WorkBuddy AI 国际版破甲包',
    subtitle: '懒人包 v1.3 · ~/.workbuddy-ai 人设 + CLI 层',
    folder: 'workbuddy-ai',
    target: 'WorkBuddy AI（国际版）',
    accent: 'indigo',
    note: 'v1.3：配置根锁死 ~/.workbuddy-ai，与国内版 ~/.workbuddy 互不覆盖。软件侧直调 Install-WBAI-LazyPack.ps1 -NoOpenLinks。',
    expected: [
      'Install-WBAI-LazyPack.ps1',
      'Verify-LazyPack.ps1',
      '一键安装-双击这里.cmd',
      '卸载-恢复原状.cmd',
      '体检-自检.cmd',
      'README-CN.txt',
      'materials',
      'materials/IDENTITY.md',
      'materials/MEMORY.md',
      'materials/SOUL-snippet.txt',
      'tools'
    ],
    versionSources: [
      { kind: 'firstLines', file: 'README-CN.txt', maxLines: 5, pattern: 'v(\\d+\\.\\d+)' },
      { kind: 'firstLines', file: 'Install-WBAI-LazyPack.ps1', maxLines: 8, pattern: 'v(\\d+\\.\\d+)' }
    ]
  },
  {
    id: 'anti-gravity',
    name: '反重力 · 旧载荷（已隔离）',
    subtitle: '知情同意后可安装 · 禁止运行旧代理载荷',
    folder: 'anti-gravity',
    target: 'Google Antigravity',
    accent: 'grape',
    note: QUARANTINED_PACKS['anti-gravity'],
    expected: [
      'Install-OneClick.cmd',
      'Install-AntiGravity.ps1',
      'Uninstall.cmd',
      'Uninstall.ps1',
      'verify-install.ps1',
      'selftest-upgrade.ps1',
      'seed-pristine.ps1',
      'pristine-seed',
      'install-manifest-*.json',
      'materials',
      'README-CN.txt'
    ],
    versionSources: [
      { kind: 'firstLines', file: 'README-CN.txt', maxLines: 5, pattern: 'v(\\d+\\.\\d+)' },
      { kind: 'latestManifest', pattern: 'install-manifest-*.json' }
    ]
  }
];

const PACK_IDS = PACKS.map((p) => p.id);

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** expected 条目匹配：含 * 走前缀通配，否则精确匹配 */
function matchesExpected(entry, expected) {
  if (expected.includes('*')) {
    const head = expected.split('*')[0];
    return entry.startsWith(head);
  }
  return entry === expected;
}

function isSkippedDir(name) {
  return SKIP_DIRS.has(name);
}

/**
 * 递归统计目录：文件数、目录数、总字节、最新修改时间。
 * 跳过 node_modules / .git 等噪音目录，并把跳过计数返回，UI 上要如实展示。
 */
async function walkStats(dir, opts = {}) {
  const result = { fileCount: 0, dirCount: 0, bytes: 0, modifiedAt: null, skippedDirs: 0 };
  const onFile = opts.onFile || null;

  async function step(current) {
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return; // 权限不足 / 路径消失，跳过即可，不中断整体扫描
    }
    for (const ent of entries) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        if (isSkippedDir(ent.name)) {
          result.skippedDirs += 1;
          continue;
        }
        result.dirCount += 1;
        await step(full);
        continue;
      }
      if (!ent.isFile()) continue;
      let st;
      try {
        st = await fsp.stat(full);
      } catch {
        continue;
      }
      result.fileCount += 1;
      result.bytes += st.size;
      if (!result.modifiedAt || st.mtimeMs > result.modifiedAt) result.modifiedAt = st.mtimeMs;
      if (onFile) onFile(full, st.size);
    }
  }

  await step(dir);
  result.modifiedAt = result.modifiedAt ? new Date(result.modifiedAt).toISOString() : null;
  return result;
}

/** 收集相对路径 -> {size} 的映射，供后续 hash */
async function collectFiles(dir) {
  const out = new Map();
  await walkStats(dir, {
    onFile: (full, size) => {
      out.set(toPosix(path.relative(dir, full)), { size });
    }
  });
  return out;
}

function sha256File(full) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(full);
    s.on('error', reject);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

/**
 * 给一批相对路径算 sha256，带进度回调。
 * 串行执行：codex 包里有几百 MB 的二进制，并发读会打爆磁盘 IO。
 */
async function hashAll(dir, relPaths, onProgress) {
  const files = {};
  let done = 0;
  for (const rel of relPaths) {
    const full = path.join(dir, rel);
    let sha;
    try {
      sha = await sha256File(full);
    } catch {
      sha = null; // 读不到（被占用/权限），标记为 null 而不是伪造一个值
    }
    let size = 0;
    try {
      size = (await fsp.stat(full)).size;
    } catch {
      size = 0;
    }
    files[rel] = { sha256: sha, size };
    done += 1;
    if (onProgress) onProgress(done, relPaths.length, rel);
  }
  return files;
}

function firstLinesMatch(fileFull, pattern, maxLines) {
  let raw;
  try {
    raw = fs.readFileSync(fileFull, 'utf8');
  } catch {
    try {
      raw = fs.readFileSync(fileFull, 'latin1');
    } catch {
      return null;
    }
  }
  const re = new RegExp(pattern);
  const lines = raw.split(/\r?\n/).slice(0, maxLines);
  for (const line of lines) {
    const m = line.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

function packageJsonVersion(fileFull) {
  try {
    const j = JSON.parse(fs.readFileSync(fileFull, 'utf8'));
    return typeof j.version === 'string' ? j.version : null;
  } catch {
    return null;
  }
}

function latestManifestVersion(dir, pattern) {
  const head = pattern.split('*')[0];
  const tail = pattern.split('*').slice(1).join('*');
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const hits = names
    .filter((n) => n.startsWith(head) && (!tail || n.endsWith(tail)))
    .sort(); // 文件名带时间戳，字典序 == 时间序
  for (let i = hits.length - 1; i >= 0; i -= 1) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, hits[i]), 'utf8'));
      if (typeof j.version === 'string') return { version: j.version, source: hits[i] };
    } catch {
      /* 继续看上一个 */
    }
  }
  return null;
}

/**
 * 提取版本号。找不到就返回 null —— UI 显示「未标注」，绝不编造。
 */
function extractVersion(packDir, sources) {
  for (const src of sources || []) {
    if (src.kind === 'packageJson') {
      const v = packageJsonVersion(path.join(packDir, src.file));
      if (v) return { version: v, source: src.file };
    } else if (src.kind === 'latestManifest') {
      const r = latestManifestVersion(packDir, src.pattern);
      if (r) return { version: r.version, source: r.source };
    } else if (src.kind === 'firstLines') {
      const v = firstLinesMatch(path.join(packDir, src.file), src.pattern, src.maxLines);
      if (v) return { version: v, source: src.file };
    }
  }
  return null;
}

/**
 * 比对两份 {rel: {sha256,size}} 快照。
 * 返回 added / removed / modified / unchanged 计数 + 限长明细。
 */
function diffMaps(baselineFiles, currentFiles) {
  const base = baselineFiles || {};
  const cur = currentFiles || {};
  const added = [];
  const removed = [];
  const modified = [];
  let unchanged = 0;

  for (const [rel, meta] of Object.entries(cur)) {
    if (!(rel in base)) {
      if (added.length < MAX_CHANGE_ITEMS) added.push({ path: rel, size: meta.size });
      continue;
    }
    const b = base[rel];
    if (b.sha256 && meta.sha256 && b.sha256 !== meta.sha256) {
      if (modified.length < MAX_CHANGE_ITEMS) {
        modified.push({ path: rel, size: meta.size, from: b.size });
      }
    } else if (b.sha256 === null || meta.sha256 === null) {
      // 一侧哈希读不到（被占用/权限）：两边都读不到且体积没变，按未变计，不假报变更
      if (b.sha256 === null && meta.sha256 === null && b.size === meta.size) {
        unchanged += 1;
      } else if (modified.length < MAX_CHANGE_ITEMS) {
        modified.push({ path: rel, size: meta.size, from: b.size });
      }
    } else {
      unchanged += 1;
    }
  }
  for (const rel of Object.keys(base)) {
    if (!(rel in cur)) {
      if (removed.length < MAX_CHANGE_ITEMS) removed.push({ path: rel });
    }
  }

  return {
    added,
    removed,
    modified,
    unchanged,
    changed: added.length + removed.length + modified.length,
    truncated:
      added.length >= MAX_CHANGE_ITEMS ||
      removed.length >= MAX_CHANGE_ITEMS ||
      modified.length >= MAX_CHANGE_ITEMS
  };
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderReport(hub) {
  const lines = [];
  lines.push('# 团子工作台 · 工具包与隔离状态报告');
  lines.push('');
  lines.push(`- 生成时间：${formatTime(new Date().toISOString())}`);
  lines.push(`- 根目录：${hub.root || '（未选择）'}`);
  lines.push(`- 包数量：${(hub.packs || []).length}`);
  lines.push('');
  lines.push('> 本报告只记录本地文件的存在性、体积与哈希差异。');
  lines.push('> 「通过校验」仅表示文件与本地基线快照一致，不代表任何安装、生效或功能状态。');
  lines.push('');
  lines.push('| 工具包 | 目录 | 版本 | 来源 | 文件数 | 体积 | 最近修改 | 基线 | 最近校验 |');
  lines.push('|---|---|---|---|---:|---:|---|---|---|');
  for (const p of hub.packs || []) {
    lines.push(
      `| ${p.name} | \`${p.folder}\` | ${p.version || '未标注'} | ${p.versionSource || '—'} | ${
        p.found ? p.fileCount : '—'
      } | ${p.found ? formatBytes(p.bytes) : '—'} | ${formatTime(p.modifiedAt)} | ${
        p.baselineAt ? '已建立' : '未建立'
      } | ${p.lastResult === 'unchanged' ? '一致' : p.lastResult === 'changed' ? '有变更' : p.lastResult === 'recorded' ? '待检查' : '—'} |`
    );
  }
  lines.push('');
  for (const p of hub.packs || []) {
    lines.push(`## ${p.name}`);
    lines.push('');
    lines.push(`- 目录：\`${p.path || (p.blockedReason ? '（已隔离，不解析载荷）' : '（未找到）')}\``);
    if (p.blockedReason) lines.push(`- 隔离原因：${p.blockedReason}`);
    lines.push(`- 找到：${p.found ? '是' : '否'}`);
    if (p.found) {
      lines.push(`- 文件数：${p.fileCount}，目录数：${p.dirCount}，总体积：${formatBytes(p.bytes)}`);
      lines.push(`- 最近修改：${formatTime(p.modifiedAt)}`);
    }
    if (p.missingEntries && p.missingEntries.length) {
      lines.push(`- 缺失条目：${p.missingEntries.join('、')}`);
    }
    if (p.warnings && p.warnings.length) {
      lines.push(`- 提示：${p.warnings.join('；')}`);
    }
    if (p.lastChanges) {
      lines.push(
        `- 最近校验：新增 ${p.lastChanges.added?.length ?? 0}，删除 ${p.lastChanges.removed?.length ?? 0}，修改 ${p.lastChanges.modified?.length ?? 0}，未变 ${p.lastChanges.unchanged ?? 0}`
      );
      const show = (label, arr) => {
        if (!arr || !arr.length) return;
        lines.push(`  - ${label}：`);
        for (const it of arr.slice(0, 50)) lines.push(`    - \`${it.path}\``);
      };
      show('新增', p.lastChanges.added);
      show('删除', p.lastChanges.removed);
      show('修改', p.lastChanges.modified);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/* ==================================================================
   部署引擎 · 平台探测 / 脚本编排 / 生效验证
   ------------------------------------------------------------------
   只调用各包目录里**已经存在**的安装与卸载脚本，不生成新的注入内容。
   执行方式、写入位置、验证标记全部来自对七个包的实际侦察结果。
   ================================================================== */

const HOME = process.env.USERPROFILE || os.homedir();
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const PROGRAMFILES = process.env.ProgramFiles || path.join('C:', 'Program Files');
const PROGRAMFILES_X86 = process.env['ProgramFiles(x86)'] || path.join('C:', 'Program Files (x86)');

function expandEnv(p) {
  return String(p)
    .replace(/%USERPROFILE%/gi, HOME)
    .replace(/%LOCALAPPDATA%/gi, LOCALAPPDATA)
    .replace(/%APPDATA%/gi, APPDATA);
}

function existsSyncPath(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function isDirSync(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFileSync(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/* ==================================================================
   运行时定位（L3 进程层专用）
   ------------------------------------------------------------------
   「找不到可执行文件」是分层验证里最容易误报的一层：
   同一个客户端在不同机器上可能装在 %LOCALAPPDATA%\Programs、Program Files、
   Scoop、npm 全局、甚至 D 盘；只硬编码一条路径必然在别人机器上翻车。
   这里做四路并联取证，任一命中即算通过：
     1) probes.installDirs        已知标准安装位（快，命中率最高）
     2) scanExe 有界深扫          常见根目录下按文件名搜（覆盖非标安装位）
     3) registryInstalls          注册表卸载项 DisplayIcon / InstallLocation
     4) runningProcesses          进程正在跑 —— 进程层最硬的证据
   所有结果带 TTL 缓存，避免每次验证都全盘扫。
   ================================================================== */

const RUNTIME_CACHE_TTL = 60000;
const _dirCache = new Map();
const _scanCache = new Map();
let _procCache = { at: 0, set: new Set() };
let _regCache = { at: 0, list: null };

/** 带 TTL 的 readdirSync（失败返回空数组，不抛） */
function cachedReaddir(dir) {
  const now = Date.now();
  const hit = _dirCache.get(dir);
  if (hit && now - hit.at < RUNTIME_CACHE_TTL) return hit.entries;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  _dirCache.set(dir, { at: now, entries });
  return entries;
}

/**
 * 在若干根目录下按深度上限广度搜索指定文件名（大小写不敏感）。
 * budget 限制访问目录总数，防止在 Program Files 这类大目录上拖死主线程。
 */
function scanExe(roots, exeNames, maxDepth = 3, budget = 2500) {
  const want = new Set((exeNames || []).map((n) => String(n).toLowerCase()));
  if (!want.size) return null;
  const rootsReal = [];
  for (const r of roots || []) {
    if (r && isDirSync(r) && !rootsReal.includes(r)) rootsReal.push(r);
  }
  if (!rootsReal.length) return null;
  const key = `${rootsReal.join('|')}::${[...want].join(',')}::${maxDepth}::${budget}`;
  const cached = _scanCache.get(key);
  if (cached && Date.now() - cached.at < RUNTIME_CACHE_TTL) return cached.hit;

  const queue = rootsReal.map((dir) => ({ dir, depth: 0 }));
  const seen = new Set(rootsReal);
  let visited = 0;
  let hit = null;
  while (queue.length && visited < budget) {
    const { dir, depth } = queue.shift();
    visited += 1;
    const entries = cachedReaddir(dir);
    if (!entries.length) continue;
    // 先判文件：同一层命中即可返回
    for (const e of entries) {
      if (e.isFile() && want.has(e.name.toLowerCase())) {
        hit = path.join(dir, e.name);
        queue.length = 0;
        break;
      }
    }
    if (hit) break;
    if (depth >= maxDepth) continue;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (seen.has(full) || SKIP_DIRS.has(e.name.toLowerCase())) continue;
      seen.add(full);
      queue.push({ dir: full, depth: depth + 1 });
    }
  }
  _scanCache.set(key, { at: Date.now(), hit });
  return hit;
}

/** 当前跑着的进程名集合（小写）。进程层最硬的证据：它正在跑 = 一定装了。 */
function runningProcesses() {
  const now = Date.now();
  if (now - _procCache.at < RUNTIME_CACHE_TTL) return _procCache.set;
  const set = new Set();
  try {
    const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {
      encoding: 'latin1',
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 8 << 20
    });
    for (const line of String(out).split(/\r?\n/)) {
      const m = line.match(/^\s*"([^"]+)"/);
      if (m) set.add(m[1].toLowerCase());
    }
  } catch {
    /* tasklist 不可用时静默降级 */
  }
  _procCache = { at: now, set };
  return set;
}

function runningExeName(names) {
  const set = runningProcesses();
  if (!set.size) return null;
  for (const n of names || []) {
    if (n && set.has(String(n).toLowerCase())) return String(n);
  }
  return null;
}

/**
 * 注册表卸载项扫描（HKLM/HKCU × WOW6432Node）。
 * 取 DisplayIcon / InstallLocation / DisplayName，用于覆盖非标安装目录。
 */
function registryInstalls() {
  const now = Date.now();
  if (_regCache.list && now - _regCache.at < RUNTIME_CACHE_TTL) return _regCache.list;
  const roots = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ];
  const list = [];
  for (const root of roots) {
    let out = '';
    try {
      out = execFileSync('reg', ['query', root, '/s'], {
        encoding: 'latin1',
        timeout: 12000,
        windowsHide: true,
        maxBuffer: 24 << 20
      });
    } catch {
      continue;
    }
    let cur = null;
    for (const rawLine of String(out).split(/\r?\n/)) {
      const line = rawLine.trim();
      if (/^HKEY_/i.test(line)) {
        if (cur && (cur.name || cur.icon || cur.dir)) list.push(cur);
        cur = { name: '', icon: '', dir: '' };
        continue;
      }
      if (!cur) continue;
      const m = line.match(/^(\S+)\s+REG_\w+\s+(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      if (key === 'displayname') cur.name = val;
      else if (key === 'displayicon') cur.icon = val;
      else if (key === 'installlocation') cur.dir = val;
    }
    if (cur && (cur.name || cur.icon || cur.dir)) list.push(cur);
  }
  _regCache = { at: now, list };
  return list;
}

/**
 * 按软件名在注册表里找 exe。
 * matchNames 做「包含式」匹配（如 'WorkBuddy' 命中 'WorkBuddy AI'）。
 */
function registryExeFor(matchNames, exeNames) {
  const names = (matchNames || []).map((n) => String(n).toLowerCase()).filter(Boolean);
  if (!names.length) return null;
  const exes = (exeNames || []).map((n) => String(n).toLowerCase());
  const wantIcon = new Set(exes);
  for (const it of registryInstalls()) {
    const dn = (it.name || '').toLowerCase();
    if (!dn || !names.some((n) => dn.includes(n))) continue;
    // DisplayIcon 形如 "C:\...\App.exe,0"，去掉图标索引
    const icon = String(it.icon || '').replace(/^"|"$/g, '').replace(/,\s*-?\d+\s*$/, '');
    if (icon && /\.exe$/i.test(icon) && existsSyncPath(icon)) {
      if (!wantIcon.size || wantIcon.has(path.basename(icon).toLowerCase())) return icon;
    }
    // 退而求其次：在 InstallLocation 里按 exe 名搜一层
    if (it.dir && isDirSync(it.dir)) {
      const hit = scanExe([it.dir], exeNames, 2, 400);
      if (hit) return hit;
    }
  }
  return null;
}

/** 各盘符根下的常见安装根（对齐 resolvePlatformHome 的"非 C 盘也能找到"思路） */
function driveRoots() {
  const roots = [];
  for (let code = 67; code <= 90; code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    if (isDirSync(root)) roots.push(root);
  }
  return roots;
}

/**
 * 平台 home 定位。
 * codex / workbuddy 的安装器支持「非 C 盘、非默认位置」（它们自己会全盘扫），
 * 监控侧也必须跟得上，否则装在 D 盘的破甲会被误判成"未安装"。
 * 解析顺序：环境变量 > 默认位置 > 各盘符常见位置；都没有时返回默认位（让 evidence 如实报 false）。
 */
function resolvePlatformHome(envName, dirName, markerFiles, envNameAlt) {
  // 备选环境变量用于 claude：注入器认 CLAUDE_CONFIG_DIR → CLAUDE_HOME，探测顺序必须一致
  for (const name of [envName, envNameAlt]) {
    const envVal = name ? process.env[name] : null;
    if (envVal && String(envVal).trim() && isDirSync(String(envVal).trim())) return String(envVal).trim();
  }

  const def = path.join(HOME, dirName);
  if (isDirSync(def)) return def;

  // 安装器的扫描逻辑：每个盘符根下的 .xxx / xxx\.xxx / Xxx\.xxx
  const markers = Array.isArray(markerFiles) ? markerFiles : [];
  for (let code = 67; code <= 90; code += 1) {
    // C..Z
    const root = `${String.fromCharCode(code)}:\\`;
    if (!isDirSync(root)) continue;
    const cap = dirName.replace(/^\.(.)/, (m, c) => c.toUpperCase());
    const candidates = [
      path.join(root, dirName),
      path.join(root, dirName.replace(/^\./, ''), dirName),
      path.join(root, cap, dirName),
      path.join(root, 'Portable', dirName),
      path.join(root, 'Software', dirName)
    ];
    for (const c of candidates) {
      if (!isDirSync(c)) continue;
      if (!markers.length) return c;
      for (const m of markers) {
        if (existsSyncPath(path.join(c, m))) return c;
      }
    }
  }
  return def;
}

function codexHome() {
  return resolvePlatformHome('CODEX_HOME', '.codex', ['AGENTS.md', 'config.toml', 'hooks.json']);
}

function dshHome() {
  return resolvePlatformHome('DSH_HOME', '.dsh', ['AGENTS.md', 'plugins']);
}

function claudeHome() {
  // 顺序与 install-claude.py 的 resolve_home 对齐：CLAUDE_CONFIG_DIR → CLAUDE_HOME → ~/.claude
  return resolvePlatformHome('CLAUDE_CONFIG_DIR', '.claude', ['CLAUDE.md', 'rules', 'skills'], 'CLAUDE_HOME');
}

function workbuddyHome() {
  return resolvePlatformHome('WB_HOME', '.workbuddy', ['IDENTITY.md', 'MEMORY.md', 'skills']);
}

function workbuddyAiHome() {
  return resolvePlatformHome('WBAI_HOME', '.workbuddy-ai', ['IDENTITY.md', 'MEMORY.md', 'skills']);
}

function opencodeConfigHome() {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && String(xdg).trim()) {
    const p = path.join(String(xdg).trim(), 'opencode');
    if (isDirSync(p)) return p;
  }
  return path.join(HOME, '.config', 'opencode');
}

/**
 * 六个目标平台的探测规则（候选路径来自本机实际安装位置）。
 * codex-panghu 与 codex 同指 Codex 平台，探测规则一致（两个破甲分支共用一个目标软件）。
 */
const PLATFORM_PROBES = {
  codex: {
    displayName: 'Codex',
    installDirs: [
      path.join(LOCALAPPDATA, 'Programs', 'Codex++'),
      path.join(LOCALAPPDATA, 'Programs', 'Codex'),
      path.join(LOCALAPPDATA, 'Programs', 'codex'),
      path.join(LOCALAPPDATA, 'OpenAI', 'Codex'),
      path.join(LOCALAPPDATA, 'Codex'),
      path.join(PROGRAMFILES, 'Codex'),
      path.join(PROGRAMFILES_X86, 'Codex')
    ],
    exes: ['codex-plus-plus.exe', 'codex.exe', 'Codex.exe'],
    configDirs: [path.join(HOME, '.codex')],
    matchNames: ['codex']
  },
  'codex-panghu': {
    displayName: 'Codex（胖虎）',
    installDirs: [
      path.join(LOCALAPPDATA, 'Programs', 'Codex++'),
      path.join(LOCALAPPDATA, 'Programs', 'Codex'),
      path.join(LOCALAPPDATA, 'Programs', 'codex'),
      path.join(LOCALAPPDATA, 'OpenAI', 'Codex'),
      path.join(LOCALAPPDATA, 'Codex'),
      path.join(PROGRAMFILES, 'Codex'),
      path.join(PROGRAMFILES_X86, 'Codex')
    ],
    exes: ['codex-plus-plus.exe', 'codex.exe', 'Codex.exe'],
    configDirs: [path.join(HOME, '.codex')],
    matchNames: ['codex']
  },
  cursor: {
    displayName: 'Cursor',
    installDirs: [
      path.join(LOCALAPPDATA, 'Programs', 'cursor'),
      path.join(LOCALAPPDATA, 'Programs', 'Cursor'),
      path.join(LOCALAPPDATA, 'Cursor'),
      path.join(PROGRAMFILES, 'Cursor'),
      path.join(PROGRAMFILES_X86, 'Cursor')
    ],
    exes: ['Cursor.exe', 'cursor.exe'],
    configDirs: [path.join(HOME, '.cursor'), path.join(APPDATA, 'Cursor')],
    matchNames: ['cursor']
  },
  dsh: {
    displayName: 'DeepSeek Harness',
    installDirs: [],
    exes: [],
    configDirs: [path.join(HOME, '.dsh')],
    matchNames: []
  },
  claude: {
    displayName: 'Claude Code',
    installDirs: [
      // npm 全局安装：claude.cmd 在 %APPDATA%\npm，真实可执行映像在 node_modules 下
      path.join(APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin'),
      path.join(LOCALAPPDATA, 'Programs', 'claude'),
      path.join(LOCALAPPDATA, 'Programs', 'Claude'),
      path.join(LOCALAPPDATA, 'Claude'),
      path.join(HOME, '.claude', 'local'),
      path.join(PROGRAMFILES, 'Claude'),
      path.join(PROGRAMFILES_X86, 'Claude')
    ],
    exes: ['claude.exe', 'claude.cmd'],
    configDirs: [path.join(HOME, '.claude')],
    matchNames: ['claude', 'anthropic']
  },
  opencode: {
    displayName: 'OpenCode',
    installDirs: [
      path.join(LOCALAPPDATA, 'Programs', '@opencode-aidesktop'),
      path.join(LOCALAPPDATA, 'Programs', 'opencode'),
      path.join(LOCALAPPDATA, 'Programs', 'opencode-desktop'),
      path.join(LOCALAPPDATA, 'opencode'),
      path.join(PROGRAMFILES, 'opencode'),
      path.join(PROGRAMFILES_X86, 'opencode')
    ],
    exes: ['OpenCode.exe', 'opencode.exe'],
    configDirs: [path.join(APPDATA, 'ai.opencode.desktop'), path.join(HOME, '.opencode')],
    matchNames: ['opencode']
  },
  workbuddy: {
    displayName: 'WorkBuddy',
    installDirs: [
      path.join(LOCALAPPDATA, 'Programs', 'WorkBuddy'),
      path.join(LOCALAPPDATA, 'WorkBuddy'),
      path.join(PROGRAMFILES, 'WorkBuddy'),
      path.join(PROGRAMFILES_X86, 'WorkBuddy')
    ],
    exes: ['WorkBuddy.exe'],
    configDirs: [path.join(HOME, '.workbuddy')],
    matchNames: ['workbuddy', 'codebuddy']
  },
  'workbuddy-ai': {
    displayName: 'WorkBuddy AI（国际版）',
    installDirs: [
      path.join(LOCALAPPDATA, 'Programs', 'WorkBuddyAI'),
      path.join(LOCALAPPDATA, 'WorkBuddyAI'),
      path.join(PROGRAMFILES, 'WorkBuddyAI'),
      path.join(PROGRAMFILES_X86, 'WorkBuddyAI')
    ],
    exes: ['WorkBuddyAI.exe', 'WorkBuddy AI.exe'],
    configDirs: [path.join(HOME, '.workbuddy-ai')],
    matchNames: ['workbuddyai', 'workbuddy ai']
  },
  'anti-gravity': {
    displayName: 'Antigravity',
    installDirs: [
      path.join(LOCALAPPDATA, 'Programs', 'antigravity'),
      path.join(LOCALAPPDATA, 'Programs', 'Antigravity'),
      path.join(LOCALAPPDATA, 'Antigravity'),
      path.join(PROGRAMFILES, 'Antigravity'),
      path.join(PROGRAMFILES_X86, 'Antigravity')
    ],
    exes: ['Antigravity.exe', 'antigravity.exe'],
    configDirs: [path.join(HOME, '.gemini'), path.join(APPDATA, 'Antigravity')],
    matchNames: ['antigravity']
  }
};

/**
 * 兜底扫描根，分两档（贵的放后面）：
 *   tight —— 最常见的安装位，可以扫得深一点
 *   loose —— 各盘符根 / Portable / Software 这类散户装法，只扫浅层
 * 只为在「标准位全部落空」时才启用，避免每次都全盘扫。
 */
function scanRootsTight() {
  return [path.join(LOCALAPPDATA, 'Programs'), LOCALAPPDATA, PROGRAMFILES, PROGRAMFILES_X86];
}

function scanRootsLoose() {
  const roots = [];
  for (const root of driveRoots()) {
    roots.push(root);
    roots.push(path.join(root, 'Programs'));
    roots.push(path.join(root, 'Portable'));
    roots.push(path.join(root, 'Software'));
    roots.push(path.join(root, 'Tools'));
  }
  return roots;
}

/** 两档合并搜索：先紧后松，命中即返回 */
function scanExeWide(exeNames) {
  return scanExe(scanRootsTight(), exeNames, 3, 1200) || scanExe(scanRootsLoose(), exeNames, 2, 800);
}

/**
 * 部署计划：隔离包在本表里没有发布中的安装/卸载/备份目标（保持 install:null）。
 * 它们恢复出来的旧计划放在下面的 LEGACY_QUARANTINE_PLANS，只有登记知情同意后
 * 才由 deployPlanFor(id) 返回。evidence 判定"破甲是否生效"，全部来自实际侦察（不是猜的）：
 *   file     目录下存在该文件
 *   dir      该目录存在
 *   contains 文件里能匹配到特征串
 *   glob     目录下存在匹配该正则的条目
 */
const DEPLOY_PLANS = {
  codex: {
    install: null,
    uninstall: null,
    backupDirs: [],
    evidence: [
      {
        type: 'glob',
        dir: codexHome(),
        pattern: /^eni-solo-replica-install-manifest-.*\.json$/i,
        label: '.codex 下有 eni-solo 安装清单'
      },
      {
        type: 'file',
        path: path.join(codexHome(), 'hooks.json'),
        label: '.codex/hooks.json 已部署'
      },
      {
        type: 'file',
        path: path.join(codexHome(), 'AGENTS.md'),
        label: '.codex/AGENTS.md 已部署'
      }
    ]
  },
  'codex-panghu': {
    install: null,
    uninstall: null,
    backupDirs: [],
    evidence: [
      {
        type: 'contains',
        path: path.join(codexHome(), 'config.toml'),
        pattern: 'model_instructions_file',
        label: '.codex/config.toml 指向 model_instructions_file'
      },
      {
        type: 'file',
        path: path.join(codexHome(), 'gpt-unrestricted.md'),
        label: '.codex/gpt-unrestricted.md 根指令已部署'
      },
      {
        type: 'file',
        path: path.join(codexHome(), '.codex-keysmith-manifest.json'),
        label: '.codex/.codex-keysmith-manifest.json 部署清单'
      }
    ]
  },
  cursor: {
    // 直调 setup.py 并带 --no-open：包里的 bat 有 pause，且装完默认会开官网
    install: { file: 'setup.py', kind: 'py', args: ['install', '--no-open'] },
    uninstall: { file: 'setup.py', kind: 'py', args: ['uninstall'] },
    backupDirs: [path.join(HOME, '.cursor'), path.join(HOME, '.cursor-shiyi-lazy')],
    evidence: [
      {
        type: 'glob',
        dir: path.join(HOME, '.cursor', 'rules'),
        pattern: /^shiyi-.*\.mdc$/i,
        label: '.cursor/rules 下有 shiyi-*.mdc'
      },
      {
        type: 'file',
        path: path.join(HOME, '.cursor-shiyi-lazy', 'installed.json'),
        label: '.cursor-shiyi-lazy/installed.json 安装记录'
      }
    ]
  },
  dsh: {
    // 直调 ps1 并带 -NoOpenLinks：跳过推广弹窗；bat 只是壳
    install: { file: 'install.ps1', kind: 'ps1', args: ['-NoOpenLinks'], env: { DSH_INSTALL_NO_PAUSE: '1' } },
    uninstall: { file: 'Uninstall.cmd', kind: 'cmd' },
    backupDirs: [dshHome()],
    evidence: [
      {
        type: 'contains',
        path: path.join(dshHome(), 'AGENTS.md'),
        pattern: 'SHIYI|石井|COLD.?BREW',
        label: '.dsh/AGENTS.md 含石井协议'
      },
      {
        type: 'dir',
        path: path.join(dshHome(), 'plugins', '@dsh-external', 'dsh-shield'),
        label: 'dsh-shield 插件已注入'
      }
    ]
  },
  claude: {
    // install-claude.py 直装：零依赖，首次写入自动备份到 ~/.claude/cha-backups
    install: { file: 'install-claude.py', kind: 'py', args: ['inject'] },
    uninstall: { file: 'install-claude.py', kind: 'py', args: ['restore'] },
    backupDirs: [claudeHome()],
    evidence: [
      {
        type: 'contains',
        path: path.join(claudeHome(), 'CLAUDE.md'),
        pattern: 'CHA-CLAUDE-POJIA:BEGIN',
        label: '~/.claude/CLAUDE.md 含冷咖啡标记块'
      },
      {
        type: 'contains',
        path: path.join(claudeHome(), 'rules', 'cha-breakopen.md'),
        pattern: 'CHA-CLAUDE-POJIA:BEGIN',
        label: '~/.claude/rules/cha-breakopen.md 常驻通道'
      },
      {
        type: 'dir',
        path: path.join(claudeHome(), 'skills', 'cha-bin-unlock'),
        label: '~/.claude/skills/cha-bin-unlock 父路由已注入'
      },
      {
        type: 'dir',
        path: path.join(claudeHome(), 'skills', 'cha-inkstage'),
        label: '~/.claude/skills/cha-inkstage 父路由已注入'
      }
    ]
  },
  opencode: {
    // 直调 ps1 并带 -NoOpenLinks：包里的 cmd 会 start 浏览器打开推广链接
    install: { file: 'install.ps1', kind: 'ps1', args: ['-NoOpenLinks'] },
    uninstall: null, // 包内没带卸载脚本，如实标注，不伪造
    backupDirs: [opencodeConfigHome()],
    evidence: [
      {
        type: 'glob',
        dir: path.join(opencodeConfigHome(), 'plugins'),
        pattern: /^shiyi-lock\.(mjs|ts)$/i,
        label: 'shiyi-lock 插件已注入 .config/opencode/plugins'
      },
      {
        type: 'contains',
        path: path.join(opencodeConfigHome(), 'AGENTS.md'),
        pattern: 'SHIYI|石井|COLD.?BREW',
        label: '.config/opencode/AGENTS.md 含石井协议'
      }
    ]
  },
  workbuddy: {
    // 直调 ps1：bat 会 pause / 弹浏览器。卸载也走 ps1，避免 Uninstall.bat 卡在 pause。
    install: { file: 'Install-WB-OneClick.ps1', kind: 'ps1', args: ['-NoOpenLinks'] },
    uninstall: { file: 'Install-WB-OneClick.ps1', kind: 'ps1', args: ['-Uninstall', '-NoOpenLinks'] },
    backupDirs: [workbuddyHome()],
    evidence: [
      { type: 'file', path: path.join(workbuddyHome(), 'IDENTITY.md'), label: '.workbuddy/IDENTITY.md 存在' },
      { type: 'file', path: path.join(workbuddyHome(), 'SOUL.md'), label: '.workbuddy/SOUL.md 存在' },
      {
        type: 'contains',
        path: path.join(workbuddyHome(), 'IDENTITY.md'),
        pattern: 'SHIYI-WB-ID:BEGIN|工作区环境',
        label: '.workbuddy/IDENTITY.md 含 v4.4 标记块'
      }
    ]
  },
  'workbuddy-ai': {
    // 直调 ps1：cmd 会 pause / 弹浏览器。配置根必须是 .workbuddy-ai，不能落到国内版 .workbuddy。
    install: { file: 'Install-WBAI-LazyPack.ps1', kind: 'ps1', args: ['-NoOpenLinks'] },
    uninstall: { file: 'Install-WBAI-LazyPack.ps1', kind: 'ps1', args: ['-Uninstall', '-NoOpenLinks'] },
    backupDirs: [workbuddyAiHome()],
    evidence: [
      { type: 'file', path: path.join(workbuddyAiHome(), 'IDENTITY.md'), label: '.workbuddy-ai/IDENTITY.md 存在' },
      { type: 'file', path: path.join(workbuddyAiHome(), 'SOUL.md'), label: '.workbuddy-ai/SOUL.md 存在' },
      {
        type: 'contains',
        path: path.join(workbuddyAiHome(), 'IDENTITY.md'),
        pattern: '石井|零拒绝|对象无关',
        label: '.workbuddy-ai/IDENTITY.md 含国际版人设'
      }
    ]
  },
  'anti-gravity': {
    install: null,
    uninstall: null,
    backupDirs: [],
    evidence: [
      {
        type: 'file',
        path: path.join(HOME, '.gemini', 'config', 'rules', 'ag-armor.md'),
        label: '.gemini/config/rules/ag-armor.md 常驻通道'
      },
      {
        type: 'file',
        path: path.join(HOME, '.gemini', 'config', 'skills', 'coldbrew-breakout', 'SKILL.md'),
        label: '.gemini/config/skills/coldbrew-breakout 按需通道'
      },
      {
        type: 'dir',
        path: path.join(HOME, '.gemini', 'config', 'plugins', 'coldbrew-breakout'),
        label: 'coldbrew-breakout 插件已注入'
      },
      {
        type: 'contains',
        path: path.join(HOME, '.gemini', 'config', 'rules', 'ag-armor.md'),
        pattern: 'AG-ARMOR:RULES',
        label: 'ag-armor.md 含 v3.2 受管块'
      }
    ]
  }
};

for (const id of Object.keys(QUARANTINED_PACKS)) {
  Object.freeze(DEPLOY_PLANS[id].backupDirs);
  Object.freeze(DEPLOY_PLANS[id]);
}
Object.freeze(DEPLOY_PLANS);

/**
 * 隔离包恢复出来的旧部署计划（逐字取自 v1.5.4 的 DEPLOY_PLANS）。
 * 它们不参与发布：只有 hasQuarantineConsent(id) 为真时 deployPlanFor(id) 才返回，
 * 也就是用户必须在卡片上勾选「我知晓 同意」并落盘之后才可能被调用。
 * 未勾选时 deployPlanFor(id) 仍然返回 DEPLOY_PLANS[id]（install:null），
 * 所以 buildSpawn / 主进程都拿不到脚本，等于维持强制隔离。
 */
const LEGACY_QUARANTINE_PLANS = {
  codex: {
    install: { file: 'install-replica.ps1', kind: 'ps1', args: ['-NoOpenLinks', '-SkipAstra6'] },
    uninstall: { file: 'Uninstall.ps1', kind: 'ps1' },
    backupDirs: [codexHome()]
  },
  'codex-panghu': {
    install: { file: 'install.ps1', kind: 'ps1', args: ['-Action', 'install'] },
    uninstall: { file: 'install.ps1', kind: 'ps1', args: ['-Action', 'uninstall'] },
    backupDirs: [codexHome()]
  },
  'anti-gravity': {
    install: { file: 'Install-AntiGravity.ps1', kind: 'ps1', args: ['-NoOpenLinks'] },
    uninstall: { file: 'Uninstall.ps1', kind: 'ps1' },
    backupDirs: [path.join(HOME, '.gemini')]
  }
};
for (const id of Object.keys(LEGACY_QUARANTINE_PLANS)) Object.freeze(LEGACY_QUARANTINE_PLANS[id].backupDirs);
for (const id of Object.keys(LEGACY_QUARANTINE_PLANS)) Object.freeze(LEGACY_QUARANTINE_PLANS[id]);
Object.freeze(LEGACY_QUARANTINE_PLANS);

/** 生效计划：隔离包在未登记同意时永远返回 DEPLOY_PLANS 里的空计划。 */
function deployPlanFor(id) {
  const legacy = LEGACY_QUARANTINE_PLANS[id];
  if (legacy && hasQuarantineConsent(id)) return legacy;
  return DEPLOY_PLANS[id] || {};
}

/** 该包是否属于"需勾选知情同意才解锁"的隔离包。 */
function isConsentPack(id) {
  return Object.prototype.hasOwnProperty.call(QUARANTINED_PACKS, id);
}

function detectPlatform(id) {
  const probe = PLATFORM_PROBES[id];
  const out = {
    id,
    displayName: probe ? probe.displayName : id,
    installed: false,
    installDir: null,
    exePath: null,
    exeVia: null,
    configDirs: [],
    iconPath: null
  };
  if (!probe) return out;

  // 遍历全部候选目录：第一个存在的记为 installDir，
  // 但 exe 要在所有候选里找（存在"目录残留但 exe 没了"的半装状态）
  for (const dir of probe.installDirs) {
    if (!isDirSync(dir)) continue;
    if (!out.installDir) out.installDir = dir;
    if (!out.exePath) {
      for (const exe of probe.exes) {
        const full = path.join(dir, exe);
        if (existsSyncPath(full)) {
          out.exePath = full;
          out.exeVia = 'installDir';
          out.iconPath = full;
          break;
        }
      }
    }
  }

  // 标准位落空 → 注册表 → 非标安装位深扫 → 正在运行的进程（由便宜到贵）
  if (!out.exePath && probe.exes.length && probe.matchNames && probe.matchNames.length) {
    const hit = registryExeFor(probe.matchNames, probe.exes);
    if (hit) {
      out.exePath = hit;
      out.exeVia = 'registry';
      out.iconPath = hit;
      if (!out.installDir) out.installDir = path.dirname(hit);
    }
  }
  if (!out.exePath && probe.exes.length) {
    const hit = scanExeWide(probe.exes);
    if (hit) {
      out.exePath = hit;
      out.exeVia = 'scan';
      out.iconPath = hit;
      if (!out.installDir) out.installDir = path.dirname(hit);
    }
  }
  if (!out.exePath && probe.exes.length) {
    const running = runningExeName(probe.exes);
    if (running) out.exeVia = 'process';
  }

  // 配置目录：codex/dsh/workbuddy/opencode 支持非默认 home，动态解析优先
  const dynamicConfigDirs = {
    codex: () => [codexHome()],
    'codex-panghu': () => [codexHome()],
    dsh: () => [dshHome()],
    claude: () => [claudeHome()],
    workbuddy: () => [workbuddyHome()],
    'workbuddy-ai': () => [workbuddyAiHome()],
    opencode: () => [opencodeConfigHome(), path.join(APPDATA, 'ai.opencode.desktop')]
  };
  const configCandidates = dynamicConfigDirs[id] ? dynamicConfigDirs[id]() : probe.configDirs;
  for (const c of configCandidates) {
    if (isDirSync(c) && !out.configDirs.includes(c)) out.configDirs.push(c);
  }

  // 没有 exe 但有配置目录也算装过（DSH 走 npx）
  out.installed = Boolean(out.exePath || out.configDirs.length || out.exeVia === 'process');
  return out;
}

function detectAllPlatforms() {
  const map = {};
  for (const id of Object.keys(PLATFORM_PROBES)) map[id] = detectPlatform(id);
  return map;
}

function checkEvidence(ev) {
  const p = expandEnv(ev.path || '');
  const label = ev.label;
  try {
    if (ev.type === 'file') return { ok: existsSyncPath(p) && !isDirSync(p), label, path: p };
    if (ev.type === 'dir') return { ok: isDirSync(p), label, path: p };
    if (ev.type === 'contains') {
      if (!existsSyncPath(p)) return { ok: false, label, path: p };
      const re = new RegExp(ev.pattern, 'i');
      // 先按 utf8 读；替换字符过多说明是 GBK/ANSI，回退 latin1 再匹配一次
      let raw = fs.readFileSync(p, 'utf8');
      let ok = re.test(raw);
      if (!ok && (raw.match(/�/g) || []).length > 2) {
        try {
          raw = fs.readFileSync(p, 'latin1');
          ok = re.test(raw);
        } catch {
          /* 保持 false */
        }
      }
      return { ok, label, path: p };
    }
    if (ev.type === 'glob') {
      const dir = expandEnv(ev.dir);
      if (!isDirSync(dir)) return { ok: false, label, path: dir };
      return { ok: fs.readdirSync(dir).some((n) => ev.pattern.test(n)), label, path: dir };
    }
  } catch {
    return { ok: false, label, path: p };
  }
  return { ok: false, label, path: p };
}

/** 验证某包破甲是否生效：全部 evidence 命中才算 */
function verifyBreak(id) {
  const blockedReason = getPackBlockReason(id);
  if (blockedReason) return { id, hasCheck: false, active: null, items: [], blockedReason };
  const plan = DEPLOY_PLANS[id];
  if (!plan || !plan.evidence || !plan.evidence.length) {
    return { id, hasCheck: false, active: null, items: [] };
  }
  const items = plan.evidence.map(checkEvidence);
  return { id, hasCheck: true, active: items.every((i) => i.ok), items };
}

function svgToDataUrl(svg) {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg.trim());
}

const BRAND_ICONS = {
  dsh: svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
      <defs>
        <linearGradient id="dsh-g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#29B6F6"/>
          <stop offset="100%" stop-color="#0288D1"/>
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#dsh-g)"/>
      <path d="M12 28 C12 21 18 16 26 16 C33 16 38 20 38 25 C38 29 34 32 29 32 C23 32 17 31 12 28 Z" fill="#FFFFFF"/>
      <path d="M36 24 C39 21 42 18 42 16 C40 18 38 21 36 24 Z" fill="#FFFFFF"/>
      <path d="M36 26 C40 28 43 31 43 33 C40 31 38 28 36 26 Z" fill="#FFFFFF"/>
      <circle cx="18" cy="23" r="1.8" fill="#0288D1"/>
      <path d="M14 26 Q18 29 22 26" stroke="#0288D1" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    </svg>
  `),
  opencode: svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
      <defs>
        <linearGradient id="oc-g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#2D1B69"/>
          <stop offset="100%" stop-color="#110B29"/>
        </linearGradient>
        <linearGradient id="oc-c" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#00F2FE"/>
          <stop offset="100%" stop-color="#4FACFE"/>
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#oc-g)"/>
      <path d="M17 18 L11 24 L17 30" stroke="url(#oc-c)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="M31 18 L37 24 L31 30" stroke="url(#oc-c)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <line x1="26" y1="15" x2="22" y2="33" stroke="#FF007F" stroke-width="2.5" stroke-linecap="round"/>
    </svg>
  `),
  claude: svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
      <defs>
        <linearGradient id="cl-g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#E08A66"/>
          <stop offset="100%" stop-color="#B05A38"/>
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#cl-g)"/>
      <g stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" transform="rotate(22.5 24 24)">
        <line x1="24" y1="12.5" x2="24" y2="35.5"/>
        <line x1="12.5" y1="24" x2="35.5" y2="24"/>
        <line x1="15.9" y1="15.9" x2="32.1" y2="32.1"/>
        <line x1="32.1" y1="15.9" x2="15.9" y2="32.1"/>
      </g>
      <circle cx="24" cy="24" r="4.2" fill="#FFFFFF"/>
      <circle cx="24" cy="24" r="1.8" fill="#B05A38"/>
    </svg>
  `),
  workbuddy: svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
      <defs>
        <linearGradient id="wb-g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0052D9"/>
          <stop offset="100%" stop-color="#003cab"/>
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#wb-g)"/>
      <rect x="13" y="15" width="22" height="18" rx="5" fill="#FFFFFF"/>
      <rect x="16" y="19" width="4.5" height="4.5" rx="1" fill="#0052D9"/>
      <rect x="27.5" y="19" width="4.5" height="4.5" rx="1" fill="#0052D9"/>
      <path d="M20 28 Q24 31 28 28" stroke="#0052D9" stroke-width="2" stroke-linecap="round" fill="none"/>
      <line x1="24" y1="11" x2="24" y2="15" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>
      <circle cx="24" cy="10" r="1.5" fill="#FFD166"/>
    </svg>
  `),
  'workbuddy-ai': svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
      <defs>
        <linearGradient id="wbai-g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#3D6BFF"/>
          <stop offset="100%" stop-color="#1F4FD6"/>
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#wbai-g)"/>
      <circle cx="24" cy="24" r="11" fill="none" stroke="#FFFFFF" stroke-width="2"/>
      <ellipse cx="24" cy="24" rx="5" ry="11" fill="none" stroke="#FFFFFF" stroke-width="1.6"/>
      <line x1="13" y1="24" x2="35" y2="24" stroke="#FFFFFF" stroke-width="1.6"/>
      <line x1="24" y1="13" x2="24" y2="35" stroke="#FFFFFF" stroke-width="1.4"/>
    </svg>
  `),
  'anti-gravity': svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
      <defs>
        <linearGradient id="ag-g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#4A148C"/>
          <stop offset="50%" stop-color="#311B92"/>
          <stop offset="100%" stop-color="#1A237E"/>
        </linearGradient>
        <linearGradient id="st-g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#EA80FC"/>
          <stop offset="50%" stop-color="#80D8FF"/>
          <stop offset="100%" stop-color="#B388FF"/>
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#ag-g)"/>
      <path d="M24 10 C24 18 18 24 10 24 C18 24 24 30 24 38 C24 30 30 24 38 24 C30 24 24 18 24 10 Z" fill="url(#st-g)"/>
      <circle cx="24" cy="24" r="2.5" fill="#FFFFFF"/>
    </svg>
  `),
  codex: svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
      <rect width="48" height="48" rx="12" fill="#10A37F"/>
      <path d="M24 14 C18.5 14 14 18.5 14 24 C14 29.5 18.5 34 24 34 C28 34 31.5 31.6 33 28" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" fill="none"/>
      <circle cx="24" cy="24" r="3.5" fill="#FFFFFF"/>
    </svg>
  `),
  'codex-panghu': svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
      <defs>
        <linearGradient id="ph-g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FF9A3C"/>
          <stop offset="100%" stop-color="#F26B1D"/>
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#ph-g)"/>
      <circle cx="24" cy="25" r="12" fill="#FFFFFF"/>
      <path d="M14 17 L18 13 L19 20 Z" fill="#FFFFFF"/>
      <path d="M34 17 L30 13 L29 20 Z" fill="#FFFFFF"/>
      <path d="M17 20 Q19 24 17 28" stroke="#F26B1D" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <path d="M31 20 Q29 24 31 28" stroke="#F26B1D" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <circle cx="20" cy="24" r="2" fill="#3A2A18"/>
      <circle cx="28" cy="24" r="2" fill="#3A2A18"/>
      <path d="M22 29 Q24 31 26 29" stroke="#3A2A18" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <ellipse cx="24" cy="27.5" rx="1.6" ry="1.2" fill="#F26B1D"/>
    </svg>
  `),
  cursor: svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
      <rect width="48" height="48" rx="12" fill="#18181B"/>
      <path d="M24 12 L35 18 L24 24 L13 18 Z" fill="#E4E4E7"/>
      <path d="M13 18 L24 24 L24 36 L13 30 Z" fill="#A1A1AA"/>
      <path d="M24 24 L35 18 L35 30 L24 36 Z" fill="#71717A"/>
    </svg>
  `)
};

/**
 * 构造 spawn 参数。
 * ps1 → powershell -ExecutionPolicy Bypass -File
 * cmd/bat → cmd /d /s /c
 */
function resolvePythonBin() {
  if (process.env.DANGO_PYTHON && existsSyncPath(process.env.DANGO_PYTHON)) return process.env.DANGO_PYTHON;
  const wb = [
    path.join(HOME, '.workbuddy', 'binaries', 'python', 'versions', '3.13.12', 'python.exe'),
    path.join(HOME, '.workbuddy', 'binaries', 'python', 'versions', '3.12.8', 'python.exe')
  ];
  for (const p of wb) if (existsSyncPath(p)) return p;
  return 'python';
}

function buildSpawn(script, packPath, id) {
  assertPackAllowed(id);
  const plan = deployPlanFor(id);
  if (!script || (script !== plan.install && script !== plan.uninstall)) throw new Error('不是该包的发布部署计划');
  assertPackSourceAllowed(id, packPath);
  const full = path.join(packPath, script.file);
  if (!existsSyncPath(full)) return null;

  if (script.kind === 'ps1') {
    const args = ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', full, ...(script.args || [])];
    return {
      cmd: 'powershell.exe',
      args,
      display: `powershell -ExecutionPolicy Bypass -File "${script.file}" ${(script.args || []).join(' ')}`.trim(),
      input: script.input || null
    };
  }
  if (script.kind === 'py') {
    const py = resolvePythonBin();
    const args = [full, ...(script.args || [])];
    return {
      cmd: py,
      args,
      display: `python "${script.file}" ${(script.args || []).join(' ')}`.trim(),
      input: script.input || null
    };
  }
  return {
    cmd: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${full}"`],
    display: `cmd /c "${script.file}"`,
    input: script.input || null
  };
}

/* ==================================================================
   深度分层验证 · L1 文件 / L2 配置 / L3 进程 / L4 会话
   ------------------------------------------------------------------
   每层独立，任一失败即停止并报告"失败在哪一层"。
   L1/L2 是纯检查（本模块内完成）；L3/L4 由主进程编排
   （CLI 真发消息、GUI 用 playwright 拉起），本模块提供
   配置定义与回复分析器（纯函数，便于单测）。
   ================================================================== */

/** 激活验证口令：只回话不做事，即使 agent 想跑工具也被 prompt 禁住 */
const VERIFY_PROMPT =
  '只回复一句：你是石井吗？是就回「是，石井在此」，不是就回「不是」。不要调用任何工具、不要读文件、不要执行命令。';

/**
 * 构造 CLI L4 验证参数。
 *
 * Codex exec 默认会校验当前目录是否为受信任 Git 仓库；桌面端主进程
 * 的 cwd 可能落在 release 目录、项目目录或用户自定义目录，因此验证
 * 会在没有 --skip-git-repo-check 时卡在 stdin 确认提示。L4 只需要一条
 * 无副作用的问答，固定为临时目录 + 只读沙箱 + ephemeral 会话，并且
 * 由调用方把 stdin 设为 ignore，避免 Codex 追加“额外 stdin 输入”。
 */
function buildCliVerifyArgs(cwd, prompt = VERIFY_PROMPT) {
  return [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--color',
    'never',
    '--cd',
    String(cwd || os.tmpdir()),
    '-c',
    'approval_policy=never',
    '--sandbox',
    'read-only',
    String(prompt)
  ];
}

function isCliVerifyInfrastructureError(text) {
  return /not inside a trusted directory|skip-git-repo-check|reading additional input from stdin|failed to read.*stdin|stdin.*not.*trusted/i.test(
    String(text || '')
  );
}

/**
 * Claude Code CLI 的 L4 验证参数：`-p` 走非交互打印模式，只回一句就退出。
 * 同样在临时目录里跑，不读 stdin，不加任何会写盘的开关。
 */
function buildClaudeVerifyArgs(cwd, prompt = VERIFY_PROMPT) {
  return ['-p', String(prompt)];
}

/**
 * 定位 claude CLI（只查文件，不执行）。npm 全局装的 claude.cmd 是 shim，
 * 它旁边的 node_modules/@anthropic-ai/claude-code/bin/claude.exe 才是可执行映像。
 */
function findClaudeCliInfo() {
  const probe = detectPlatform('claude');
  if (probe.exePath) return { path: probe.exePath, via: probe.exeVia || 'installDir' };
  const shim = path.join(APPDATA, 'npm', 'claude.cmd');
  if (existsSyncPath(shim)) return { path: shim, via: 'npm-global-shim' };
  return { path: null, via: null };
}

/**
 * L4 CLI 通道登记表：每家的"版本探测参数"与"无副作用问答参数"不同，
 * 所以按 id 分开，probeRuntime / 主进程都从这里取，不再硬编码 codex。
 */
const CLI_CHANNELS = {
  codex: {
    findExe: () => findCodexCliInfo(),
    versionArgs: ['--version'],
    buildVerifyArgs: (cwd, prompt) => buildCliVerifyArgs(cwd, prompt)
  },
  claude: {
    findExe: () => findClaudeCliInfo(),
    versionArgs: ['--version'],
    buildVerifyArgs: (cwd, prompt) => buildClaudeVerifyArgs(cwd, prompt)
  }
};

function cliChannelFor(id) {
  return CLI_CHANNELS[id] || null;
}

/**
 * L2 配置层检查（per 平台）。
 * check 返回 { ok, detail } —— ok=false 即"配置层失败"。
 */
const CONFIG_CHECKS = {
  codex() {
    const dir = codexHome();
    const cfg = path.join(dir, 'config.toml');
    const models = path.join(dir, 'models.json');
    const items = [];

    if (!existsSyncPath(cfg)) {
      return { ok: false, detail: `缺少 config.toml（${dir}）`, items: [{ ok: false, label: 'config.toml 存在', detail: cfg }] };
    }
    items.push({ ok: true, label: 'config.toml 存在' });

    // codex 0.135 只认识这些 effort 枚举；models.json 超出则 CLI 起不来
    if (existsSyncPath(models)) {
      try {
        const j = JSON.parse(fs.readFileSync(models, 'utf8'));
        const allowed = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
        const bad = [];
        const collect = (arr) => {
          for (const it of arr || []) if (it && it.effort && !allowed.has(it.effort)) bad.push(it.effort);
        };
        if (Array.isArray(j)) collect(j);
        else if (j && typeof j === 'object') Object.values(j).forEach((v) => collect(v));
        if (bad.length) {
          items.push({
            ok: false,
            label: 'models.json effort 枚举',
            detail: `codex 0.135 不认识：${[...new Set(bad)].join('、')}（仅接受 ${[...allowed].join('/')})`
          });
        } else {
          items.push({ ok: true, label: 'models.json effort 枚举' });
        }
      } catch (e) {
        items.push({ ok: false, label: 'models.json 可解析', detail: String(e.message || e) });
      }
    }

    const hooks = fs.readFileSync(cfg, 'utf8');
    const hasHooks = /hook/i.test(hooks) || existsSyncPath(path.join(dir, 'hooks.json'));
    items.push({ ok: hasHooks, label: 'hooks 已注册', detail: hasHooks ? '' : 'config.toml 里没有 hook 段' });

    const ok = items.every((i) => i.ok);
    return { ok, detail: ok ? '配置就绪' : items.find((i) => !i.ok).detail, items };
  },

  'codex-panghu'() {
    const dir = codexHome();
    const cfg = path.join(dir, 'config.toml');
    const items = [];

    if (!existsSyncPath(cfg)) {
      return { ok: false, detail: `缺少 config.toml（${dir}）`, items: [{ ok: false, label: 'config.toml 存在', detail: cfg }] };
    }
    items.push({ ok: true, label: 'config.toml 存在' });

    let raw = '';
    try {
      raw = fs.readFileSync(cfg, 'utf8');
    } catch {
      raw = '';
    }
    // keysmith 部署的核心特征：model_instructions_file 指向 gpt-unrestricted.md
    const hasInstr = /model_instructions_file\s*=/.test(raw);
    items.push({ ok: hasInstr, label: 'model_instructions_file 已写入', detail: hasInstr ? '' : 'config.toml 里没有 model_instructions_file' });

    const promptFile = path.join(dir, 'gpt-unrestricted.md');
    items.push({ ok: existsSyncPath(promptFile), label: 'gpt-unrestricted.md 根指令存在', detail: promptFile });

    const manifest = path.join(dir, '.codex-keysmith-manifest.json');
    items.push({ ok: existsSyncPath(manifest), label: 'keysmith 部署清单存在', detail: manifest });

    // hooks.json 应被隔离（.disabled）；仍活跃说明会与指令加载冲突
    const hooksActive = existsSyncPath(path.join(dir, 'hooks.json'));
    items.push({
      ok: !hooksActive,
      label: 'hooks.json 已隔离',
      detail: hooksActive ? '检测到活跃 hooks.json（胖虎与 hooks 注入互斥，建议卸载冷咖啡石井或加 -SkipHooksIsolation 明确共存）' : ''
    });

    const ok = items.every((i) => i.ok);
    return { ok, detail: ok ? '配置就绪' : items.find((i) => !i.ok).detail, items };
  },

  dsh() {
    const dir = dshHome();
    const items = [];
    const agents = path.join(dir, 'AGENTS.md');
    let hasMark = false;
    if (existsSyncPath(agents)) {
      try {
        hasMark = /SHIYI|石井|COLD.?BREW/i.test(fs.readFileSync(agents, 'utf8'));
      } catch {
        hasMark = false;
      }
    }
    items.push({ ok: hasMark, label: 'AGENTS.md 含石井协议', detail: agents });
    // 插件目录两种布局都认：@dsh-external/dsh-shield（v5 现行）与 dsh-shield（旧版）
    const shieldA = path.join(dir, 'plugins', '@dsh-external', 'dsh-shield');
    const shieldB = path.join(dir, 'plugins', 'dsh-shield');
    const shieldHit = isDirSync(shieldA) || isDirSync(shieldB);
    items.push({ ok: shieldHit, label: 'dsh-shield 插件存在', detail: shieldHit ? (isDirSync(shieldA) ? shieldA : shieldB) : shieldA });
    const ok = items.every((i) => i.ok);
    return { ok, detail: ok ? '配置就绪' : items.find((i) => !i.ok).label, items };
  },

  cursor() {
    const dir = path.join(HOME, '.cursor');
    const rulesDir = path.join(dir, 'rules');
    const items = [];
    const hit = isDirSync(rulesDir) && fs.readdirSync(rulesDir).some((n) => /^shiyi-.*\.mdc$/i.test(n));
    items.push({ ok: hit, label: 'rules 下 shiyi-*.mdc 已注册', detail: rulesDir });
    const ok = items.every((i) => i.ok);
    return { ok, detail: ok ? '配置就绪' : items.find((i) => !i.ok).label, items };
  },

  workbuddy() {
    const dir = workbuddyHome();
    const idFile = path.join(dir, 'IDENTITY.md');
    const items = [];
    let hasMark = false;
    if (existsSyncPath(idFile)) {
      try {
        hasMark = /SHIYI|石井|石井-WB|SHIYI-WB/i.test(fs.readFileSync(idFile, 'utf8'));
      } catch {
        hasMark = false;
      }
    }
    items.push({ ok: hasMark, label: 'IDENTITY.md 含石井协议', detail: idFile });
    const ok = items.every((i) => i.ok);
    return { ok, detail: ok ? '配置就绪' : items.find((i) => !i.ok).label, items };
  },

  'workbuddy-ai'() {
    const dir = workbuddyAiHome();
    const idFile = path.join(dir, 'IDENTITY.md');
    const soul = path.join(dir, 'SOUL.md');
    const items = [];
    let hasMark = false;
    if (existsSyncPath(idFile)) {
      try {
        hasMark = /石井|零拒绝|对象无关/i.test(fs.readFileSync(idFile, 'utf8'));
      } catch {
        hasMark = false;
      }
    }
    items.push({ ok: hasMark, label: '.workbuddy-ai/IDENTITY.md 含国际版人设', detail: idFile });
    items.push({ ok: existsSyncPath(soul), label: '.workbuddy-ai/SOUL.md 存在', detail: soul });
    const ok = items.every((i) => i.ok);
    return { ok, detail: ok ? '配置就绪' : items.find((i) => !i.ok).label, items };
  },

  opencode() {
    const items = [];
    const cfgDir = opencodeConfigHome();
    items.push({ ok: isDirSync(cfgDir), label: '配置目录存在', detail: cfgDir });
    let pluginHit = false;
    const pluginDir = path.join(cfgDir, 'plugins');
    if (isDirSync(pluginDir)) {
      try {
        pluginHit = fs.readdirSync(pluginDir).some((n) => /^shiyi-lock\.(mjs|ts)$/i.test(n));
      } catch {
        pluginHit = false;
      }
    }
    items.push({ ok: pluginHit, label: 'shiyi-lock 插件已注入', detail: pluginDir });
    let agentsMark = false;
    const agentsFile = path.join(cfgDir, 'AGENTS.md');
    if (existsSyncPath(agentsFile)) {
      try {
        agentsMark = /SHIYI|石井|COLD.?BREW/i.test(fs.readFileSync(agentsFile, 'utf8'));
      } catch {
        agentsMark = false;
      }
    }
    items.push({ ok: agentsMark, label: 'AGENTS.md 含石井协议', detail: agentsFile });
    const ok = items.every((i) => i.ok);
    return { ok, detail: ok ? '配置就绪' : items.find((i) => !i.ok).label, items };
  },

  claude() {
    const dir = claudeHome();
    const items = [];

    // install-claude.py 只往 CLAUDE.md 追加一个受管标记块，块内是 Claude 席位入口
    const md = path.join(dir, 'CLAUDE.md');
    let hasMark = false;
    if (existsSyncPath(md)) {
      try {
        hasMark = /CHA-CLAUDE-POJIA:BEGIN/.test(fs.readFileSync(md, 'utf8'));
      } catch {
        hasMark = false;
      }
    }
    items.push({ ok: hasMark, label: 'CLAUDE.md 含 CHA-CLAUDE-POJIA 标记块', detail: md });

    // 常驻通道
    const breakopen = path.join(dir, 'rules', 'cha-breakopen.md');
    items.push({ ok: isFileSync(breakopen), label: 'rules/cha-breakopen.md 常驻通道', detail: breakopen });

    // 按需通道：86 个席位 SKILL.md 落在 skills/cha-*
    const skillsDir = path.join(dir, 'skills');
    let skillHit = false;
    if (isDirSync(skillsDir)) {
      try {
        skillHit = fs.readdirSync(skillsDir).some(
          (n) => /^cha-/i.test(n) && isFileSync(path.join(skillsDir, n, 'SKILL.md'))
        );
      } catch {
        skillHit = false;
      }
    }
    items.push({ ok: skillHit, label: 'skills/cha-* 席位技能已注入', detail: skillsDir });

    const ok = items.every((i) => i.ok);
    return { ok, detail: ok ? '配置就绪' : items.find((i) => !i.ok).label, items };
  },

  'anti-gravity'() {
    const cfg = path.join(HOME, '.gemini', 'config');
    const items = [];
    const armor = path.join(cfg, 'rules', 'ag-armor.md');
    const skill = path.join(cfg, 'skills', 'coldbrew-breakout', 'SKILL.md');
    const plugin = path.join(cfg, 'plugins', 'coldbrew-breakout');
    items.push({ ok: isFileSync(armor), label: 'rules/ag-armor.md 常驻通道', detail: armor });
    items.push({ ok: isFileSync(skill), label: 'skills/coldbrew-breakout 按需通道', detail: skill });
    items.push({ ok: isDirSync(plugin), label: 'coldbrew-breakout 插件已注入', detail: plugin });
    const ok = items.every((i) => i.ok);
    return { ok, detail: ok ? '配置就绪' : items.find((i) => !i.ok).label, items };
  }
};

/**
 * 回复分析器（纯函数）。
 * 输入 L4 抓到的原始回复文本，输出多维特征 + 结论。
 */
function analyzeReply(text) {
  const t = String(text || '');
  const feats = {
    hasShiyi: /石井|SHIYI|来杯冰美式|冰美式|石井 ROUTE/i.test(t),
    hasRefusal: /I can't|I cannot|can(?:no|')t help|cannot assist|unable to assist|must refuse|无法协助|不能帮|无法提供|无法完成|对不起|抱歉，|不能协助/i.test(t),
    hasThinking: /<think>|<\/think>|reasoning|思考过程|thinking:|thinking>/i.test(t),
    hasDisclosure: /I am an AI|as an AI|I'm an AI|人工智能助手|作为一个AI|作为AI|我是AI/i.test(t),
    hasRoute: /\[石井\s*ROUTE|\[ROUTE\]/i.test(t)
  };
  let verdict = 'ambiguous';
  if (feats.hasShiyi && !feats.hasRefusal) verdict = 'active';
  else if (feats.hasRefusal) verdict = 'refused';
  else if (!t.trim()) verdict = 'empty';
  return {
    ...feats,
    verdict,
    length: t.length,
    excerpt: t.replace(/\s+/g, ' ').trim().slice(0, 220)
  };
}

/** 从路径里抽版本号，用于「装了多个版本时挑最新」 */
function versionTuple(p) {
  const m = String(p).match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * codex CLI 的多候选定位。
 * 历史版本只认 %LOCALAPPDATA%\OpenAI\codex-*-windows-x64-*\cli-native\...\codex.exe
 * 这一条硬编码路径，别人机器上换个安装形态（桌面版内嵌 CLI / npm 全局 / PATH）
 * 就报「找不到 codex CLI」。这里改成候选表 + 有界深扫，并把来源一并返回，
 * 便于在诊断里如实说明"从哪找到的"。
 */
function findCodexCliInfo() {
  const candidates = [];
  const push = (p, via) => {
    if (p && existsSyncPath(p) && !candidates.some((c) => c.path === p)) candidates.push({ path: p, via });
  };

  // 路径探测不运行候选 exe/cmd；未知版本保持未知，绝不执行 --version。

  // 1) %LOCALAPPDATA%\OpenAI\<版本目录>\cli-native\x86_64-pc-windows-msvc\bin\codex.exe
  const openaiDir = path.join(LOCALAPPDATA, 'OpenAI');
  for (const e of cachedReaddir(openaiDir)) {
    if (!e.isDirectory()) continue;
    const base = path.join(openaiDir, e.name);
    push(path.join(base, 'cli-native', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'), `%LOCALAPPDATA%\\OpenAI\\${e.name}`);
    push(path.join(base, 'bin', 'codex.exe'), `%LOCALAPPDATA%\\OpenAI\\${e.name}\\bin`);
  }
  // 2) OpenAI 目录下方任意深度（覆盖结构变体）
  push(scanExe([openaiDir], ['codex.exe'], 6, 1200), '%LOCALAPPDATA%\\OpenAI（深扫）');

  // 3) 便携/自解压形态
  for (const p of [
    path.join(HOME, '.codex', '.sandbox-bin', 'codex.exe'),
    path.join(HOME, '.codex', 'bin', 'codex.exe'),
    path.join(LOCALAPPDATA, 'Programs', 'Codex++', 'codex.exe'),
    path.join(LOCALAPPDATA, 'Codex', 'codex.exe')
  ]) {
    push(p, p.replace(HOME, '%USERPROFILE%').replace(LOCALAPPDATA, '%LOCALAPPDATA%'));
  }

  // 4) 包管理器全局 bin（.cmd/.exe 壳）
  for (const p of [
    path.join(APPDATA, 'npm', 'codex.exe'),
    path.join(APPDATA, 'npm', 'codex.cmd'),
    path.join(APPDATA, 'npm', 'codex'),
    path.join(LOCALAPPDATA, 'Yarn', 'bin', 'codex.cmd'),
    path.join(HOME, 'scoop', 'shims', 'codex.exe'),
    path.join(HOME, 'scoop', 'shims', 'codex.cmd')
  ]) {
    push(p, p.replace(HOME, '%USERPROFILE%').replace(APPDATA, '%APPDATA%').replace(LOCALAPPDATA, '%LOCALAPPDATA%'));
  }

  // 5) PATH 兜底
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    push(path.join(dir, 'codex.exe'), 'PATH');
    push(path.join(dir, 'codex.cmd'), 'PATH');
  }

  // 6) 全盘常见位兜底
  push(scanExeWide(['codex.exe']), '常见安装根（深扫）');

  if (!candidates.length) return { path: null, via: null, candidates: [] };
  const pool = candidates.slice();
  pool.sort((a, b) => {
    const ta = versionTuple(a.path) || [0, 0, 0];
    const tb = versionTuple(b.path) || [0, 0, 0];
    for (let i = 0; i < 3; i += 1) if (tb[i] !== ta[i]) return tb[i] - ta[i];
    return 0;
  });
  return { path: pool[0].path, via: pool[0].via, candidates };
}

/** 向后兼容：只要路径 */
function findCodexCli() {
  return findCodexCliInfo().path;
}

/** GUI 客户端的 exe 探测（复用 PLATFORM_PROBES） */
function findGuiExe(id) {
  const p = detectPlatform(id);
  return p.exePath || null;
}

/**
 * L3 进程层的统一判定入口。
 * 返回 { ok, mode, exe, soft, label, detail }
 *   ok=false         真正没装，判失败
 *   ok=true soft=false  拿到可执行文件，可继续跑 L4
 *   ok=true soft=true   没拿到可执行文件但证据充分（或用进程/配置目录佐证），
 *                       降级通过、跳过 L4 —— 不再像以前那样一律报「找不到」
 */
function probeRuntime(id) {
  assertPackAllowed(id);
  const probe = PLATFORM_PROBES[id] || {};
  const chan = l4ChannelFor(id);
  const mode = chan.mode || 'gui';

  if (mode === 'cli') {
    const cli = cliChannelFor(id);
    const info = cli ? cli.findExe() : findCodexCliInfo();
    if (info.path) {
      return { ok: true, mode: 'cli', exe: info.path, soft: false, label: 'CLI 已定位', detail: `${info.path}${info.via ? `（来源：${info.via}）` : ''}` };
    }
    // CLI 缺失 → 回退客户端通道（有客户端也能验证，不必判失败）
    const gui = findGuiExe(id);
    if (gui) {
      return { ok: true, mode: 'gui', exe: gui, soft: true, label: `未找到 ${chan.cliName || 'CLI'}，回退客户端通道`, detail: gui };
    }
    const running = runningExeName(probe.exes || []);
    if (running) {
      return { ok: true, mode: 'gui', exe: null, soft: true, label: `进程已在运行（${running}）`, detail: `${running} 正在运行，客户端已安装` };
    }
    return {
      ok: false,
      mode: 'cli',
      exe: null,
      soft: false,
      label: `未找到 ${chan.cliName || 'CLI'} 或桌面客户端`,
      detail: chan.cliHint || '已查：%LOCALAPPDATA%\\OpenAI、~/.codex、npm/Yarn/scoop 全局、PATH、Program Files'
    };
  }

  if (mode === 'gui') {
    const exe = findGuiExe(id);
    if (exe) return { ok: true, mode: 'gui', exe, soft: false, label: '客户端已安装', detail: exe };
    const running = runningExeName(probe.exes || []);
    if (running) {
      return { ok: true, mode: 'gui', exe: null, soft: true, label: `进程已在运行（${running}）`, detail: `${running} 正在运行，客户端已安装` };
    }
    const p = detectPlatform(id);
    if (p.installed) {
      return {
        ok: true,
        mode: 'gui',
        exe: null,
        soft: true,
        label: '未定位可执行文件，按已安装证据降级通过',
        detail: `配置目录：${p.configDirs.join('；') || '（无）'}`
      };
    }
    return { ok: false, mode: 'gui', exe: null, soft: false, label: '客户端未安装', detail: '未在常见安装位、注册表或运行进程中检测到该客户端' };
  }

  // gui-note / none：该平台没有独立进程通道，跳过而不是判失败
  return { ok: true, mode: 'skip', exe: null, soft: true, label: chan.note || '该平台无独立进程通道（已跳过）', detail: '' };
}

/** 每个平台的 L4 通道类型：cli 真发 / gui playwright 拉起 */
const L4_CHANNELS = {
  codex: { mode: 'none', consentMode: 'cli', cliName: 'codex CLI', note: QUARANTINED_PACKS.codex },
  'codex-panghu': { mode: 'none', consentMode: 'cli', cliName: 'codex CLI', note: QUARANTINED_PACKS['codex-panghu'] },
  dsh: { mode: 'gui-note', note: 'DSH 走 npx 临时缓存，无独立 CLI' },
  cursor: { mode: 'gui' },
  claude: {
    mode: 'cli',
    cliName: 'claude CLI',
    cliHint: '已查：%APPDATA%\\npm\\node_modules\\@anthropic-ai、~/.claude/local、%LOCALAPPDATA%\\Programs、PATH'
  },
  opencode: { mode: 'gui' },
  workbuddy: { mode: 'gui' },
  'workbuddy-ai': { mode: 'gui' },
  'anti-gravity': { mode: 'none', consentMode: 'gui', note: QUARANTINED_PACKS['anti-gravity'] }
};

/**
 * 生效通道：隔离包在 mode==='none' 时是"硬跳过"。登记知情同意后改走各自的
 * consentMode（codex/胖虎 = cli，反重力 = gui），这样隔离解除后深度验证能真正落地。
 */
function l4ChannelFor(id) {
  const chan = L4_CHANNELS[id] || { mode: 'gui' };
  if (chan.mode === 'none' && chan.consentMode && hasQuarantineConsent(id)) return chan.consentMode === chan.mode ? chan : { ...chan, mode: chan.consentMode };
  return chan;
}

/* ==================================================================
   内嵌破甲包 · 软件单体分发
   ------------------------------------------------------------------
   打包后各包在 process.resourcesPath/packs；开发态在项目 packed-packs。
   脚本必须落在真实文件系统（extraResources），不能进 asar。
   ================================================================== */

function embeddedPacksRoot() {
  // 测试开关：模拟"没有内嵌包"的分发形态，用于验证引导空态路径
  if (process.env.DANGO_NO_EMBEDDED === '1') return null;
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'packs'));
  candidates.push(path.join(__dirname, '..', 'packed-packs'));
  for (const c of candidates) {
    if (isDirSync(c)) return c;
  }
  return null;
}

function hasEmbeddedPacks() {
  const root = embeddedPacksRoot();
  if (!root) return false;
  return RELEASE_PACK_IDS.every((id) => isDirSync(path.join(root, id)));
}

/* ==================================================================
   第三方破甲包导入引擎
   ------------------------------------------------------------------
   识别三种形态：
     1. 单个规则文件（.md/.mdc/.txt 等）→ 按内容指纹判平台
     2. 与官方一致的多包根目录（含 codex/cursor/... 子目录）→ multi-root
     3. 任意结构的单平台包目录 → 文件名 + 内容指纹综合打分
   打分全透明：返回各平台得分，识别不出就如实返回 unknown + 候选，
   让 UI 交给人选，绝不硬猜。
   ================================================================== */

const PLATFORM_SIGNATURES = {
  codex: {
    fileHints: [
      { re: /^install-replica\.ps1$/i, weight: 40 },
      { re: /eni-?solo/i, weight: 18 },
      { re: /codex/i, weight: 7 },
      { re: /^hooks\.json$/i, weight: 8 },
      { re: /^models\.json$/i, weight: 4 }
    ],
    contentHints: [
      { re: /\.codex|codex\.exe|CODEX_HOME|eni-?solo/i, weight: 12 },
      { re: /config\.toml|hooks\.json/i, weight: 5 },
      { re: /gpt-?5|openai|codex/i, weight: 3 }
    ]
  },
  'codex-panghu': {
    fileHints: [
      { re: /codex-instruct|keysmith/i, weight: 40 },
      { re: /gpt-unrestricted/i, weight: 14 },
      { re: /胖虎|panghu/i, weight: 12 },
      { re: /codex/i, weight: 5 }
    ],
    contentHints: [
      { re: /model_instructions_file|keysmith|codex-instruct/i, weight: 14 },
      { re: /\.codex|CODEX_HOME/i, weight: 8 },
      { re: /gpt-unrestricted/i, weight: 6 }
    ]
  },
  cursor: {
    fileHints: [
      { re: /cursor_tamper_proxy|setup\.py/i, weight: 36 },
      { re: /使用说明\.txt/i, weight: 12 },
      { re: /^\.cursorrules$/i, weight: 14 },
      { re: /\.mdc$/i, weight: 9 },
      { re: /cursor/i, weight: 7 },
      { re: /一键安装\.bat/i, weight: 8 }
    ],
    contentHints: [
      { re: /\.cursor|cursor\.exe|Composer/i, weight: 12 },
      { re: /cursorrules/i, weight: 8 },
      { re: /alwaysApply|globs:/i, weight: 4 }
    ]
  },
  dsh: {
    fileHints: [
      { re: /dsh-shield|dsh-purge|dsh-prompt-inject|dsh-super-injector/i, weight: 30 },
      { re: /^MAINTENANCE-HANDOVER\.md$/i, weight: 25 },
      { re: /dsh/i, weight: 8 },
      { re: /deepseek/i, weight: 7 }
    ],
    contentHints: [
      { re: /deepseek\s*harness|DSH_HOME|\.dsh|dsh-shield/i, weight: 14 },
      { re: /deepseek/i, weight: 5 }
    ]
  },
  opencode: {
    fileHints: [
      { re: /patch-openco|merge-config/i, weight: 40 },
      { re: /^opencode\.jsonc$/i, weight: 30 },
      { re: /shiyi-lock/i, weight: 25 },
      { re: /opencode/i, weight: 8 },
      { re: /^shield-protocol\.md$/i, weight: 10 }
    ],
    contentHints: [
      { re: /opencode|app\.asar|ai\.opencode\.desktop|shiyi-lock/i, weight: 12 },
      { re: /\.config[\\/]opencode|shield-protocol/i, weight: 10 }
    ]
  },
  claude: {
    fileHints: [
      { re: /^install-claude\.py$/i, weight: 40 },
      { re: /^CLAUDE\.md(\.cha-block\.md)?$/i, weight: 28 },
      { re: /^skills-rendered$/i, weight: 20 },
      { re: /cha-breakopen/i, weight: 18 },
      { re: /raw-claude|raw-activation-reply/i, weight: 12 },
      { re: /claude/i, weight: 8 }
    ],
    contentHints: [
      { re: /CHA-CLAUDE-POJIA|BREAK\/\/OPEN/i, weight: 16 },
      { re: /\.claude[\\/]|CLAUDE_CONFIG_DIR|install-claude\.py/i, weight: 12 },
      { re: /claude|anthropic/i, weight: 6 }
    ]
  },
  workbuddy: {
    fileHints: [
      { re: /^Install-WB-OneClick\.ps1$/i, weight: 40 },
      { re: /^patch-inject-layer\.ps1$|^patch-cli-layer\.ps1$/i, weight: 30 },
      { re: /workbuddy|omen_wb|launch_lazy/i, weight: 25 },
      { re: /omen/i, weight: 8 },
      { re: /WB/i, weight: 3 }
    ],
    contentHints: [
      { re: /\.workbuddy(?!-ai)/i, weight: 14 },
      { re: /IDENTITY\.md|SOUL\.md|MEMORY\.md/i, weight: 10 },
      { re: /omen/i, weight: 4 }
    ]
  },
  'workbuddy-ai': {
    fileHints: [
      { re: /^Install-WBAI-LazyPack\.ps1$/i, weight: 40 },
      { re: /Verify-LazyPack\.ps1/i, weight: 20 },
      { re: /WorkBuddyAI|workbuddy-ai|WBAI/i, weight: 25 },
      { re: /一键安装-双击这里\.cmd/i, weight: 10 }
    ],
    contentHints: [
      { re: /\.workbuddy-ai|WorkBuddyAI|WBHomePath/i, weight: 16 },
      { re: /国际版|IDENTITY\.md|SOUL-snippet/i, weight: 10 }
    ]
  },
  'anti-gravity': {
    fileHints: [
      { re: /^Install-AntiGravity\.ps1$/i, weight: 40 },
      { re: /antigravity|anti-?gravity/i, weight: 25 },
      { re: /install-manifest-/i, weight: 20 },
      { re: /ag-armor|selftest-upgrade|verify-install/i, weight: 16 },
      { re: /coldbrew/i, weight: 15 }
    ],
    contentHints: [
      { re: /antigravity|anti-?gravity|coldbrew/i, weight: 14 },
      { re: /\.gemini|AGL[1-5]|gemini/i, weight: 8 }
    ]
  }
};

const TEXT_EXTS = new Set(['.md', '.mdc', '.txt', '.ps1', '.cmd', '.bat', '.py', '.js', '.mjs', '.cjs', '.ts', '.json', '.jsonc', '.toml', '.vbs', '.yaml', '.yml']);
const IMPORT_SCORE_THRESHOLD = 18;

/**
 * 单文件（规则文件）专用识别特征。
 * 用户直接选了一个 .md/.txt 之类的规则文件时，文件名往往叫 AGENTS.md / 破甲规则.md，
 * 不会带平台名，靠通用 fileHints 会全 0 分。这里补一层「协议/路径/关键词」特征。
 */
const RULE_FILE_SIGNATURES = {
  codex: [
    { re: /\.codex[\\/]|CODEX_HOME|codex\.exe|config\.toml/i, weight: 16 },
    { re: /codex/i, weight: 10 },
    { re: /AGENTS\.md/i, weight: 6 }
  ],
  'codex-panghu': [
    { re: /model_instructions_file|keysmith|codex-instruct|胖虎|panghu/i, weight: 22 },
    { re: /gpt-unrestricted/i, weight: 10 },
    { re: /\.codex[\\/]|CODEX_HOME/i, weight: 8 }
  ],
  cursor: [
    { re: /\.cursor[\\/]|cursorrules|Composer/i, weight: 16 },
    { re: /cursor/i, weight: 10 },
    { re: /alwaysApply|globs:\s*$/im, weight: 6 },
    { re: /\.mdc\b/i, weight: 6 }
  ],
  dsh: [
    { re: /\.dsh[\\/]|DSH_HOME|deepseek\s*harness|dsh-shield/i, weight: 16 },
    { re: /dsh/i, weight: 10 },
    { re: /deepseek/i, weight: 6 }
  ],
  opencode: [
    { re: /\.config[\\/]opencode|ai\.opencode\.desktop|shiyi-lock|opencode\.jsonc/i, weight: 16 },
    { re: /opencode/i, weight: 10 },
    { re: /shield-protocol/i, weight: 6 }
  ],
  claude: [
    { re: /\.claude[\\/]|CLAUDE_CONFIG_DIR|CHA-CLAUDE-POJIA|cha-breakopen/i, weight: 18 },
    { re: /claude|anthropic/i, weight: 10 },
    { re: /BREAK\/\/OPEN|冷咖啡/i, weight: 6 }
  ],
  workbuddy: [
    { re: /\.workbuddy(?!-ai)[\\/]|workbuddy(?!-ai)/i, weight: 16 },
    { re: /IDENTITY\.md|SOUL\.md|USER\.md|MEMORY\.md/i, weight: 6 },
    { re: /omen|词元喵喵/i, weight: 5 }
  ],
  'workbuddy-ai': [
    { re: /\.workbuddy-ai[\\/]|WorkBuddyAI|国际版/i, weight: 18 },
    { re: /IDENTITY\.md|SOUL\.md|MEMORY\.md/i, weight: 6 }
  ],
  'anti-gravity': [
    { re: /\.gemini[\\/]|antigravity|anti-?gravity/i, weight: 16 },
    { re: /gemini\.md|AGL[1-5]/i, weight: 10 },
    { re: /coldbrew|反重力/i, weight: 8 }
  ]
};

/** 规则文件里出现「破甲协议」通用特征时的兜底加分（不指定平台时给所有平台等权，靠候选让用户选） */
const BREAKOUT_GENERIC_RE = /石井|SHIYI|冷咖啡|cold.?brew|破甲|越狱|jailbreak|无限制|不受限|绕过限制|角色扮演|roleplay|system\s*prompt|系统提示词|ignore\s+(all\s+)?(previous|prior)/i;

/** 规则文件专用打分：通用 fileHints/contentHints + 规则文件特征 + 协议兜底 */
function scoreRuleFile(full) {
  const scores = {};
  const name = path.basename(full);
  const head = readHead(full);
  const genericHit = BREAKOUT_GENERIC_RE.test(head) || BREAKOUT_GENERIC_RE.test(name);
  for (const [id, sig] of Object.entries(PLATFORM_SIGNATURES)) {
    let s = scoreFileName(name, sig.fileHints) + scoreText(head, sig.contentHints);
    const extra = RULE_FILE_SIGNATURES[id] || [];
    for (const h of extra) {
      if (h.re.test(head) || h.re.test(name)) s += h.weight;
    }
    // 含破甲协议但没指明平台：给一个基础分，让 UI 列出候选由用户确认
    if (genericHit && s === 0) s = 6;
    scores[id] = s;
  }
  return { scores, genericHit };
}

function scoreText(text, contentHints) {
  let s = 0;
  for (const h of contentHints) {
    if (h.re.test(text)) s += h.weight;
  }
  return s;
}

function scoreFileName(name, fileHints) {
  let s = 0;
  for (const h of fileHints) {
    if (h.re.test(name)) s += h.weight;
  }
  return s;
}

/** 读文件开头（限字节），utf8 失败回退 latin1，读不到返回 '' */
function readHead(full, maxBytes = 131072) {
  let raw = null;
  try {
    const buf = fs.readFileSync(full);
    raw = buf.subarray(0, maxBytes).toString('utf8');
  } catch {
    try {
      raw = fs.readFileSync(full, 'latin1').slice(0, maxBytes);
    } catch {
      return '';
    }
  }
  return raw;
}

/** 对单个文件做平台打分 */
function scoreSingleFile(full) {
  const scores = {};
  const name = path.basename(full);
  const head = readHead(full);
  for (const [id, sig] of Object.entries(PLATFORM_SIGNATURES)) {
    scores[id] = scoreFileName(name, sig.fileHints) + scoreText(head, sig.contentHints);
  }
  return scores;
}

/** 对目录做平台打分：枚举两层文件名 + 抽样文本内容（限量，保证大目录也不卡） */
function scoreDirectory(dir, maxTextSamples = 24) {
  const scores = {};
  for (const id of Object.keys(PLATFORM_SIGNATURES)) scores[id] = 0;
  const nameSamples = [];
  const textSamples = [];

  function walk(current, depth) {
    if (depth > 2 || textSamples.length >= maxTextSamples) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        nameSamples.push(ent.name);
        walk(path.join(current, ent.name), depth + 1);
      } else if (ent.isFile()) {
        nameSamples.push(ent.name);
        const ext = path.extname(ent.name).toLowerCase();
        if (TEXT_EXTS.has(ext) && textSamples.length < maxTextSamples) {
          textSamples.push(path.join(current, ent.name));
        }
      }
    }
  }
  walk(dir, 0);

  for (const [id, sig] of Object.entries(PLATFORM_SIGNATURES)) {
    for (const n of nameSamples) scores[id] += scoreFileName(n, sig.fileHints);
  }
  // 内容抽样：每平台独立累计，命中即加
  for (const f of textSamples) {
    const head = readHead(f, 65536);
    if (!head) continue;
    for (const [id, sig] of Object.entries(PLATFORM_SIGNATURES)) {
      scores[id] += scoreText(head, sig.contentHints);
    }
  }
  return scores;
}

function topOfScores(scores) {
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [bestId, bestScore] = ranked[0] || [null, 0];
  const [, secondScore] = ranked[1] || [null, 0];
  return { ranked, bestId, bestScore, secondScore };
}

/**
 * 识别导入目标属于哪个平台。
 * 返回：
 *   { kind: 'single', platform, confidence, scores, path }
 *   { kind: 'multi-root', platforms: [{ platform, path, folder }], scores }
 *   { kind: 'unknown', candidates: [{ platform, score }], scores, path }
 */
function detectPackTarget(inputPath) {
  let st = null;
  try {
    st = fs.statSync(inputPath);
  } catch {
    return { kind: 'unknown', path: inputPath, error: '路径不存在或不可读', candidates: [], scores: {} };
  }

  if (st.isFile()) {
    const ext = path.extname(inputPath).toLowerCase();
    const isRuleFile = TEXT_EXTS.has(ext);
    const { scores, genericHit } = isRuleFile ? scoreRuleFile(inputPath) : { scores: scoreSingleFile(inputPath), genericHit: false };
    const { ranked, bestId, bestScore, secondScore } = topOfScores(scores);
    // 规则文件阈值放宽：用户已明确选了这一个文件，只要打分能区分出平台即可
    const threshold = isRuleFile ? 10 : IMPORT_SCORE_THRESHOLD;
    if (bestScore >= threshold && bestScore > secondScore) {
      const confidence = Math.min(0.99, bestScore / (bestScore + secondScore + 1) + 0.3);
      return { kind: 'single', inputKind: 'file', platform: bestId, confidence, scores, path: inputPath, genericHit };
    }
    // 规则文件但分不出平台：给出全部平台候选（含 0 分），让用户自己选，不硬判 unknown 卡死
    const candidates = isRuleFile
      ? ranked.map(([platform, score]) => ({ platform, score }))
      : ranked.slice(0, 3).map(([platform, score]) => ({ platform, score }));
    return {
      kind: 'unknown',
      inputKind: 'file',
      path: inputPath,
      candidates,
      scores,
      genericHit,
      // 是文本规则文件就允许用户手选平台注入（不是硬失败）
      canPickManually: isRuleFile
    };
  }

  if (!st.isDirectory()) {
    return { kind: 'unknown', path: inputPath, error: '既不是文件也不是目录', candidates: [], scores: {} };
  }

  // 1) 多包根目录判定：子目录名命中官方 folder 名 ≥1，且能配对到平台
  let topEntries = [];
  try {
    topEntries = fs.readdirSync(inputPath, { withFileTypes: true });
  } catch {
    return { kind: 'unknown', path: inputPath, error: '目录不可读', candidates: [], scores: {} };
  }
  const subDirs = topEntries.filter((e) => e.isDirectory()).map((e) => e.name);
  const folderMap = {};
  for (const p of PACKS) folderMap[p.folder] = p.id;
  const directHits = subDirs.filter((n) => folderMap[n.toLowerCase()]);
  if (directHits.length >= 2) {
    const platforms = directHits.map((n) => ({ platform: folderMap[n.toLowerCase()], folder: n, path: path.join(inputPath, n) }));
    return { kind: 'multi-root', platforms, path: inputPath, scores: {} };
  }

  // 2) 整体打分判定单平台包
  const scores = scoreDirectory(inputPath);
  const { ranked, bestId, bestScore, secondScore } = topOfScores(scores);
  if (bestScore >= IMPORT_SCORE_THRESHOLD && bestScore > secondScore) {
    const confidence = Math.min(0.99, bestScore / (bestScore + secondScore + 1) + 0.3);
    return { kind: 'single', inputKind: 'dir', platform: bestId, confidence, scores, path: inputPath };
  }
  return {
    kind: 'unknown',
    inputKind: 'dir',
    path: inputPath,
    candidates: ranked.slice(0, 3).map(([platform, score]) => ({ platform, score })),
    scores
  };
}

const INSTALL_SCRIPT_RE = /^(install|setup|deploy|一键安装|安装|破甲安装)/i;
const UNINSTALL_SCRIPT_RE = /^(uninstall|remove|卸载)/i;
const SCRIPT_EXT_RE = /\.(cmd|bat|ps1)$/i;

/** 在目录顶层找最像的安装/卸载脚本（标准名优先，其次命名启发式） */
function findScript(dir, standardFile, fuzzyRe) {
  if (standardFile && existsSyncPath(path.join(dir, standardFile))) return standardFile;
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const hits = names.filter((n) => SCRIPT_EXT_RE.test(n) && fuzzyRe.test(n));
  if (!hits.length) return null;
  // oneclick 类命名优先，其次短名字（通常是一键入口）
  hits.sort((a, b) => {
    const ao = /one.?click|一键/i.test(a) ? 0 : 1;
    const bo = /one.?click|一键/i.test(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return a.length - b.length;
  });
  return hits[0];
}

/**
 * 整理调优：对照平台官方 expected 盘点第三方包结构，定位安装/卸载脚本，抽版本。
 * 不修改源目录，只产报告；落地动作由主进程执行。
 */
function analyzeImportedDir(dir, platformId) {
  const def = PACKS.find((p) => p.id === platformId);
  if (!def) return null;
  try {
    assertPackSourceAllowed(platformId, dir);
  } catch (e) {
    return { platform: platformId, dir, readable: false, blockedReason: e.message, entries: [], missing: [], installScript: null, uninstallScript: null, version: null, versionSource: null };
  }
  let entries = [];
  try {
    entries = fs.readdirSync(dir).sort();
  } catch {
    return { platform: platformId, dir, readable: false, entries: [], missing: def.expected.slice(), installScript: null, uninstallScript: null, version: null, versionSource: null };
  }
  const missing = missingExpectedEntries(dir, def.expected);
  const plan = DEPLOY_PLANS[platformId] || {};
  const installScript = findScript(dir, plan.install ? plan.install.file : null, INSTALL_SCRIPT_RE);
  const uninstallScript = findScript(dir, plan.uninstall ? plan.uninstall.file : null, UNINSTALL_SCRIPT_RE);
  const v = extractVersion(dir, def.versionSources);
  return {
    platform: platformId,
    dir,
    readable: true,
    entries,
    missing,
    fitRatio: def.expected.length ? (def.expected.length - missing.length) / def.expected.length : 0,
    installScript,
    uninstallScript,
    version: v ? v.version : null,
    versionSource: v ? v.source : null
  };
}

/**
 * 单规则文件 → 平台注入点。
 * copy 类：整文件复制进平台规则目录（cursor 改名为 .mdc 并补 frontmatter）。
 * append 类：以标记块追加到平台全局指令文件（卸载时可按标记精准移除）。
 */
const RULE_FILE_TARGETS = {
  cursor: {
    mode: 'copy',
    dir: () => path.join(HOME, '.cursor', 'rules'),
    fileName: (n) => `shiyi-imported-${n.replace(/\.(md|txt)$/i, '')}.mdc`,
    wrap: (name, content) =>
      `---\ndescription: 第三方导入规则 ${name}\nglobs:\nalwaysApply: true\n---\n\n${content}\n`,
    label: '.cursor/rules（Cursor Project Rules 全局位）'
  },
  codex: {
    mode: 'append',
    file: () => path.join(codexHome(), 'AGENTS.md'),
    label: '.codex/AGENTS.md（全局指令层）'
  },
  'codex-panghu': {
    // 仅普通文本词库管理；与已隔离 keysmith 包的安装/恢复完全分离。
    mode: 'append',
    file: () => path.join(codexHome(), 'AGENTS.md'),
    label: '.codex/AGENTS.md（胖虎分支全局指令层）'
  },
  dsh: {
    mode: 'append',
    file: () => path.join(dshHome(), 'AGENTS.md'),
    label: '.dsh/AGENTS.md（常驻身份层）'
  },
  workbuddy: {
    mode: 'append',
    file: () => path.join(workbuddyHome(), 'USER.md'),
    label: '.workbuddy/USER.md（用户画像层）'
  },
  'workbuddy-ai': {
    mode: 'append',
    file: () => path.join(workbuddyAiHome(), 'USER.md'),
    label: '.workbuddy-ai/USER.md（国际版用户画像层）'
  },
  opencode: {
    mode: 'append',
    file: () => path.join(opencodeConfigHome(), 'AGENTS.md'),
    label: '.config/opencode/AGENTS.md（全局指令层）'
  },
  claude: {
    mode: 'append',
    file: () => path.join(claudeHome(), 'CLAUDE.md'),
    label: '.claude/CLAUDE.md（全局指令层）'
  },
  'anti-gravity': {
    mode: 'append',
    file: () => path.join(HOME, '.gemini', 'GEMINI.md'),
    label: '.gemini/GEMINI.md（全局指令层）'
  }
};

/** 追加块的包裹格式（开始/结束标记保证可精准卸载） */
function buildImportBlock(name, content) {
  const safe = String(name).replace(/[^\w.一-龥-]+/g, '_');
  return `\n\n<!-- shiyi-imported:${safe}:start -->\n${content}\n<!-- shiyi-imported:${safe}:end -->\n`;
}

/* ===================================================================
 *  词库 v2（智汇AI 用户提示词库）
 *  -------------------------------------------------------------------
 *  数据源（只读，全部在 app 自己的 resources 里）：
 *    - resources/library/library.json   master 单文件：3134 条 metadata + 全文
 *    - resources/library/meta.json      仅 metadata（可选，体积小时优先）
 *    - resources/library/details/<i>.json  按 index 拆分的全文（可选）
 *
 *  读路径（全部带进程内缓存，25MB 只 parse 一次）：
 *    - libraryMeta()      → 列表用，剥掉 content，IPC 载荷 ~1MB 而不是 25MB
 *    - libraryDetail(i)   → 单条全文，本地优先，缺失才联网
 *    - libraryStats()     → 分类 / 成功率 / 来源分布
 *
 *  写路径（全部可逆，全部先备份）：
 *    - injectLibraryEntry()      写入平台规则位，key 唯一 → 可精准卸载
 *    - listLibraryInjections()   扫描平台文件，列出当前生效的注入块
 *    - removeLibraryInjection()  按 key 摘掉标记块（append）或删 .mdc（copy）
 *
 *  红线：
 *    - 注入记录独立存放（userData/library-injections.json），
 *      绝不写进 state.imported —— 那是"第三方破甲包"的槽位，
 *      混用会把用户导入的包目录顶掉。
 * =================================================================== */

const LIBRARY_BUNDLE_FILENAME = 'library.json';
const LIBRARY_META_FILENAME = 'meta.json';
const LIBRARY_DETAIL_PREFIX = 'details';
const LIBRARY_REMOTE_DETAIL = 'https://api.12300.top/prompt-admin/api/preset-prompt?id=';
/** 列表预览截断长度：够 UI 显示 3 行，又不至于把 25MB 塞过 IPC */
const LIBRARY_PREVIEW_CHARS = 220;

function existsFileSync(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function libStamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

function builtinLibraryDir() {
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'library'));
  candidates.push(path.join(__dirname, '..', 'build', 'library'));
  for (const c of candidates) {
    if (isDirSync(c)) return c;
  }
  return null;
}

/** 缓存失效键：文件变了（mtime + size）才重新 parse */
function libraryCacheKey(dir) {
  for (const name of [LIBRARY_BUNDLE_FILENAME, LIBRARY_META_FILENAME]) {
    const f = path.join(dir, name);
    try {
      const st = fs.statSync(f);
      return `${name}|${st.mtimeMs}|${st.size}`;
    } catch { /* 下一个候选 */ }
  }
  return null;
}

let LIB_CACHE = null;
let LIB_CACHE_KEY = null;

/**
 * 载入原始词库（含全文），带缓存。
 * 返回 { ok, prompts, total, fetchedAt, source, dir, fullText }
 *   source:   bundle=完整快照 / meta=仅元数据 / none=没找到
 *   fullText: 这份快照里 content 字段是否齐备
 */
function loadLibraryRaw() {
  const dir = builtinLibraryDir();
  if (!dir) return { ok: false, error: 'no bundled library', prompts: [], total: 0, dir: null, source: 'none', fullText: false };

  const key = libraryCacheKey(dir);
  if (key && LIB_CACHE && LIB_CACHE_KEY === key) return LIB_CACHE;

  let out = null;
  const bundle = path.join(dir, LIBRARY_BUNDLE_FILENAME);
  if (existsFileSync(bundle)) {
    try {
      const data = JSON.parse(fs.readFileSync(bundle, 'utf8'));
      const prompts = data.prompts || [];
      out = { ok: true, prompts, total: data.total || prompts.length, fetchedAt: data.fetchedAt || null, dir, source: 'bundle', fullText: true };
    } catch (e) {
      out = { ok: false, error: 'library.json 解析失败: ' + e.message, prompts: [], total: 0, dir, source: 'none', fullText: false };
    }
  } else {
    const meta = path.join(dir, LIBRARY_META_FILENAME);
    if (existsFileSync(meta)) {
      try {
        const data = JSON.parse(fs.readFileSync(meta, 'utf8'));
        const prompts = data.prompts || [];
        out = { ok: true, prompts, total: data.total || prompts.length, fetchedAt: data.fetchedAt || null, dir, source: 'meta', fullText: false };
      } catch (e) {
        out = { ok: false, error: 'meta.json 解析失败: ' + e.message, prompts: [], total: 0, dir, source: 'none', fullText: false };
      }
    }
  }
  if (!out) out = { ok: false, error: 'no library snapshot in ' + dir, prompts: [], total: 0, dir, source: 'none', fullText: false };

  LIB_CACHE = out;
  LIB_CACHE_KEY = key;
  return out;
}

/** 向后兼容：旧调用点仍拿得到 prompts（含全文） */
function loadBuiltinLibrary() { return loadLibraryRaw(); }

/** 把一条原始记录压成列表项：剥 content，带 index，preview 截断 */
function toLibraryMeta(p, index) {
  const full = typeof p.content === 'string' ? p.content : '';
  const preview = String(p.content_preview || full.slice(0, LIBRARY_PREVIEW_CHARS) || '');
  return {
    index,
    id: p.id ?? index,
    name: p.name || `未命名 #${index}`,
    desc: p.desc || '',
    category: p.category || '',
    category_label: p.category_label || '通用安全',
    source: p.source || '未标注',
    success_rate: Number(p.success_rate) || 0,
    content_length: Number(p.content_length) || full.length || preview.length,
    preview,
    has_full: full.length > 0 || Boolean(p.content_preview)
  };
}

/** 列表用（IPC 安全体积） */
function libraryMeta() {
  const raw = loadLibraryRaw();
  return {
    ok: raw.ok,
    error: raw.error || null,
    total: raw.total,
    source: raw.source,
    fullText: raw.fullText,
    fetchedAt: raw.fetchedAt,
    dir: raw.dir,
    prompts: (raw.prompts || []).map(toLibraryMeta)
  };
}

/** 分类 / 成功率 / 来源统计（前端做分面筛选用） */
function libraryStats() {
  const raw = loadLibraryRaw();
  const prompts = raw.prompts || [];
  const categories = {};
  const sources = {};
  const rates = { r90: 0, r80: 0, r70: 0, rLow: 0, rNone: 0 };
  let fullCount = 0;
  let totalChars = 0;
  for (const p of prompts) {
    const c = p.category_label || '通用安全';
    categories[c] = (categories[c] || 0) + 1;
    const s = p.source || '未标注';
    sources[s] = (sources[s] || 0) + 1;
    const r = Number(p.success_rate) || 0;
    if (r >= 90) rates.r90 += 1;
    else if (r >= 80) rates.r80 += 1;
    else if (r >= 70) rates.r70 += 1;
    else if (r > 0) rates.rLow += 1;
    else rates.rNone += 1;
    const len = (typeof p.content === 'string' && p.content.length) || Number(p.content_length) || 0;
    totalChars += len;
    if (typeof p.content === 'string' && p.content.length > 0) fullCount += 1;
  }
  return {
    ok: raw.ok,
    total: prompts.length,
    categories,
    sources,
    rates,
    fullCount,
    previewOnly: prompts.length - fullCount,
    totalChars,
    dir: raw.dir,
    source: raw.source,
    fetchedAt: raw.fetchedAt
  };
}

/**
 * 取全文。优先级：
 *   1) details/<i>.json（拆分快照）
 *   2) library.json 内联 content
 *   3) meta 里的 content / content_preview
 *   4) 联网补全（只在上面全落空时）
 */
function fetchBuiltinDetail(index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0) return { ok: false, error: 'index 非法', index: i };
  const raw = loadLibraryRaw();
  const dir = raw.dir;

  if (dir) {
    const f = path.join(dir, LIBRARY_DETAIL_PREFIX, i + '.json');
    if (existsFileSync(f)) {
      try {
        const d = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (d && typeof d.content === 'string' && d.content) {
          return { ok: true, detail: { ...toLibraryMeta(d, i), content: d.content }, source: 'bundled' };
        }
      } catch { /* fallthrough */ }
    }
  }

  const p = (raw.prompts || [])[i];
  if (!p) return { ok: false, error: `词库里没有第 ${i} 条`, index: i };
  if (typeof p.content === 'string' && p.content.length > 0) {
    return { ok: true, detail: { ...toLibraryMeta(p, i), content: p.content }, source: 'local' };
  }
  if (p.content_preview) {
    return {
      ok: true,
      partial: true,
      detail: { ...toLibraryMeta(p, i), content: p.content_preview },
      source: 'preview',
      error: '本地只有预览片段，完整内容需联网获取'
    };
  }
  return { ok: false, error: '本地无全文', index: i };
}

/** 联网取全文（仅本地缺失时兜底） */
async function fetchBuiltinDetailRemote(index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0) return { ok: false, error: 'index 非法' };
  return new Promise((resolve) => {
    const https = require('node:https');
    const req = https.get(LIBRARY_REMOTE_DETAIL + i, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve({ ok: false, error: 'http ' + res.statusCode }); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const d = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const body = d && (d.content || (d.data && d.data.content));
          if (!body) return resolve({ ok: false, error: '远端无 content 字段' });
          resolve({ ok: true, detail: { ...toLibraryMeta({ ...(d.data || d), content: body }, i), content: body }, source: 'remote' });
        } catch (e) { resolve({ ok: false, error: 'parse: ' + e.message }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: '超时（15s）' }); });
  });
}

/** 全文解析：本地优先 → 联网兜底，一次调用给出确定结果 */
async function resolveLibraryContent(index) {
  const local = fetchBuiltinDetail(index);
  if (local.ok && !local.partial) return local;
  const remote = await fetchBuiltinDetailRemote(index);
  if (remote.ok) return remote;
  if (local.ok) return { ...local, remoteError: remote.error };
  return { ok: false, error: local.error + (remote.error ? ' / 联网也失败: ' + remote.error : ''), index: Number(index) };
}

/* ------------------------------------------------- 注入 key 与标记块 */

/**
 * 注入块唯一 key：lib<index>_<安全名>。
 * 带 index 是为了两条同名词条不会互相顶掉，卸载时能精准命中。
 * 字符集必须和 buildImportBlock 的 safe 正则一致，否则扫不回来。
 */
function injectionKey(index, name) {
  const base = String(name || 'entry').replace(/[\\/:*?"<>|]/g, '_').replace(/\.(md|mdc|txt)$/i, '');
  const safe = base.replace(/[^\w.一-龥-]+/g, '_').slice(0, 60) || 'entry';
  return `lib${Number(index) || 0}_${safe}`;
}

function buildInjectionBlock(key, content) {
  return `\n\n<!-- shiyi-imported:${key}:start -->\n${content}\n<!-- shiyi-imported:${key}:end -->\n`;
}

/** 扫出一个文件里所有注入块的 key */
function scanInjectionKeys(text) {
  const out = [];
  const re = /<!--\s*shiyi-imported:([^:>]+):start\s*-->/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const k = m[1].trim();
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** 从文本里精准摘掉一个 key 的标记块（含前后空行）；未命中原样返回，不做任何改写 */
function stripInjectionBlock(text, key) {
  const src = String(text || '');
  const esc = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\n*<!--\\s*shiyi-imported:${esc}:start\\s*-->[\\s\\S]*?<!--\\s*shiyi-imported:${esc}:end\\s*-->\\n*`, 'g');
  const next = src.replace(re, '\n');
  if (next === src) return { text: src, removed: false };
  return { text: next.replace(/\n{3,}/g, '\n\n').trim() + '\n', removed: true };
}

/**
 * 注入前的平台预检：告诉 UI「会写到哪个文件、那文件现在什么样、已有几个注入块、破甲层是否生效」。
 * 这是让用户看得懂自己在干什么的关键一步，不做等于黑箱写入。
 */
function libraryPlatformTargets() {
  const out = [];
  for (const [id, t] of Object.entries(RULE_FILE_TARGETS)) {
    const row = { id, mode: t.mode, label: t.label };
    try {
      if (t.mode === 'copy') {
        const dir = t.dir();
        row.path = dir;
        row.exists = isDirSync(dir);
        let files = [];
        try { files = fs.readdirSync(dir).filter((n) => /^shiyi-imported-.*\.mdc$/i.test(n)); } catch { /* 目录不存在 */ }
        row.injectedKeys = files.map((n) => n.replace(/^shiyi-imported-/, '').replace(/\.mdc$/i, ''));
        row.injectedCount = files.length;
        row.size = 0;
        for (const n of files) { try { row.size += fs.statSync(path.join(dir, n)).size; } catch { /* skip */ } }
      } else {
        const file = t.file();
        row.path = file;
        row.exists = existsFileSync(file);
        let text = '';
        try { text = fs.readFileSync(file, 'utf8'); } catch { /* 不存在 */ }
        row.injectedKeys = scanInjectionKeys(text);
        row.injectedCount = row.injectedKeys.length;
        row.size = Buffer.byteLength(text, 'utf8');
        row.lines = text ? text.split('\n').length : 0;
      }
      // 平台安装状态 + 破甲层生效状态（best-effort，探测失败不影响主数据）
      try {
        const dp = detectPlatform(id);
        row.installed = Boolean(dp && dp.installed);
      } catch { row.installed = false; }
      try {
        row.breakActive = verifyBreak(id).active;
      } catch { row.breakActive = null; }
    } catch (e) {
      row.error = e.message;
      row.exists = false;
      row.injectedKeys = [];
      row.injectedCount = 0;
      row.size = 0;
    }
    out.push(row);
  }
  return out;
}

/**
 * 写入一条词库内容到平台规则位。
 *   copy（cursor）：落成 .cursor/rules/shiyi-imported-<key>.mdc，带 frontmatter
 *   append（其余 5）：以标记块追加到全局指令文件，写前自动备份
 * 同 key 重复注入 = 覆盖更新，不会越堆越多。
 *
 * opts.mode:
 *   'replace'（推荐）：写入前清掉该平台所有「词库注入」的块/文件，
 *                      平台始终只保留这一条现役词库规则 —— 这才是"替换提示词"。
 *                      用户自己导入的块（非 lib 前缀）一律不碰。
 *   'append'（默认）：  只覆盖同 key，其余词库注入保留（多条规则叠加）。
 */
async function importLibraryContent(platformId, name, content, opts = {}) {
  const target = RULE_FILE_TARGETS[platformId];
  if (!target) throw new Error(`${platformId} 不支持注入`);
  if (typeof content !== 'string' || !content.trim()) throw new Error('词条内容为空');

  const index = Number.isInteger(Number(opts.index)) ? Number(opts.index) : 0;
  const key = opts.key || injectionKey(index, name);
  const stamp = libStamp();
  const replace = opts.mode === 'replace';
  const contentHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
  let displaced = [];

  if (target.mode === 'copy') {
    const destDir = target.dir();
    await fsp.mkdir(destDir, { recursive: true });

    if (replace) {
      // 备份并移除其他词库注入的 .mdc（lib 前缀才算词库来源，用户导入的不动）
      let files = [];
      try { files = fs.readdirSync(destDir).filter((n) => /^shiyi-imported-lib\d+_.*\.mdc$/i.test(n)); } catch { /* 目录刚建 */ }
      for (const n of files) {
        const p = path.join(destDir, n);
        const oldKey = n.replace(/^shiyi-imported-/, '').replace(/\.mdc$/i, '');
        if (oldKey === key) continue; // 自己马上会被覆盖写
        if (opts.backupDir) {
          try {
            await fsp.mkdir(opts.backupDir, { recursive: true });
            await fsp.copyFile(p, path.join(opts.backupDir, `${platformId}-replaced-${stamp}-${n}`));
          } catch { /* best-effort */ }
        }
        await fsp.rm(p, { force: true });
        displaced.push(oldKey);
      }
    }

    const dest = path.join(destDir, `shiyi-imported-${key}.mdc`);
    // 覆盖前把旧文件挪进备份，保持可回滚
    if (opts.backup !== false && existsFileSync(dest) && opts.backupDir) {
      try {
        await fsp.mkdir(opts.backupDir, { recursive: true });
        await fsp.copyFile(dest, path.join(opts.backupDir, `${platformId}-${stamp}-${path.basename(dest)}`));
      } catch { /* best-effort，不阻塞注入 */ }
    }
    const body = `---\ndescription: 破甲词库注入 · ${name}\nglobs:\nalwaysApply: true\n---\n\n<!-- shiyi-imported:${key}:start -->\n${content}\n<!-- shiyi-imported:${key}:end -->\n`;
    await fsp.writeFile(dest, body, 'utf8');
    return { ok: true, mode: 'copy', dest, key, label: target.label, bytes: Buffer.byteLength(body, 'utf8'), contentHash, displaced };
  }

  const targetFile = target.file();
  await fsp.mkdir(path.dirname(targetFile), { recursive: true });

  let prev = '';
  try { prev = await fsp.readFile(targetFile, 'utf8'); } catch { prev = ''; }

  if (opts.backup !== false && prev && opts.backupDir) {
    try {
      await fsp.mkdir(opts.backupDir, { recursive: true });
      await fsp.copyFile(targetFile, path.join(opts.backupDir, `${platformId}-${stamp}-${path.basename(targetFile)}`));
    } catch { /* best-effort */ }
  }

  let cleaned = prev || '';
  // 同 key 已存在 → 先摘掉旧的再写，避免重复堆叠
  if (cleaned) cleaned = stripInjectionBlock(cleaned, key).text;
  if (replace && cleaned) {
    // 摘掉其他所有 lib 前缀块（词库来源），用户导入块保留
    for (const k of scanInjectionKeys(cleaned)) {
      if (k !== key && /^lib\d+_/.test(k)) {
        cleaned = stripInjectionBlock(cleaned, k).text;
        displaced.push(k);
      }
    }
  }
  const block = buildInjectionBlock(key, content);
  await fsp.writeFile(targetFile, (cleaned ? cleaned.replace(/\n$/, '') : '') + block, 'utf8');

  return { ok: true, mode: 'append', dest: targetFile, key, label: target.label, bytes: Buffer.byteLength(block, 'utf8'), contentHash, displaced };
}

/**
 * 注入生效复核：以磁盘为准回答三个问题
 *   1) exists    —— 标记块/文件还在不在（可能被客户端重写、被用户手删）
 *   2) hashMatch —— 内容和注入时是否一致（被改过 = drifted）
 *   3) breakActive —— 该平台破甲层整体状态（复用 verifyBreak，尽力而为）
 * 注入成功 ≠ 生效：写完之后必须回读验证，这一步不能省。
 */
function verifyLibraryInjection(platformId, key, expectedHash) {
  const target = RULE_FILE_TARGETS[platformId];
  if (!target) return { ok: false, error: `${platformId} 不支持`, exists: false };
  const k = String(key || '');
  if (!k) return { ok: false, error: 'key 为空', exists: false };

  let exists = false;
  let hashMatch = null;
  let actualHash = null;
  let bodyChars = 0;

  try {
    if (target.mode === 'copy') {
      const file = path.join(target.dir(), `shiyi-imported-${k}.mdc`);
      if (existsFileSync(file)) {
        exists = true;
        const text = fs.readFileSync(file, 'utf8');
        const m = text.match(new RegExp(`<!--\\s*shiyi-imported:${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:start\\s*-->\\n([\\s\\S]*?)\\n<!--\\s*shiyi-imported:${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:end\\s*-->`));
        const body = m ? m[1] : text;
        bodyChars = body.length;
        actualHash = crypto.createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 16);
        if (expectedHash) hashMatch = actualHash === expectedHash;
      }
    } else {
      const file = target.file();
      if (existsFileSync(file)) {
        const text = fs.readFileSync(file, 'utf8');
        const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`<!--\\s*shiyi-imported:${esc}:start\\s*-->\\n([\\s\\S]*?)\\n<!--\\s*shiyi-imported:${esc}:end\\s*-->`);
        const m = text.match(re);
        if (m) {
          exists = true;
          const body = m[1];
          bodyChars = body.length;
          actualHash = crypto.createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 16);
          if (expectedHash) hashMatch = actualHash === expectedHash;
        }
      }
    }
  } catch (e) {
    return { ok: false, error: e.message, exists: false };
  }

  let breakActive = null;
  try { breakActive = verifyBreak(platformId).active; } catch { breakActive = null; }

  return {
    ok: true,
    platformId,
    key: k,
    exists,
    hashMatch,
    actualHash,
    bodyChars,
    breakActive,
    verdict: !exists ? 'missing' : hashMatch === false ? 'drifted' : 'active'
  };
}

/** 批量复核一个平台的全部词库注入块（history 提供 expectedHash） */
function verifyLibraryPlatform(platformId, historyItems) {
  const scan = listLibraryInjections(platformId);
  if (!scan.ok) return scan;
  const histByKey = {};
  for (const h of historyItems || []) {
    if (h.platformId === platformId && h.key) histByKey[h.key] = h;
  }
  const items = (scan.items || []).map((x) => {
    const h = histByKey[x.key];
    const v = verifyLibraryInjection(platformId, x.key, h ? h.contentHash : undefined);
    return {
      ...x,
      injectedAt: h ? h.at : (x.updatedAt || null),
      verify: { exists: v.exists, hashMatch: v.hashMatch, verdict: v.verdict, breakActive: v.breakActive }
    };
  });
  let breakActive = null;
  try { breakActive = verifyBreak(platformId).active; } catch { breakActive = null; }
  return { ok: true, platformId, mode: scan.mode, path: scan.path, exists: scan.exists, items, breakActive };
}

/** 列出一个平台当前生效的注入块（以磁盘实际内容为准，不依赖 state） */
function listLibraryInjections(platformId) {
  const target = RULE_FILE_TARGETS[platformId];
  if (!target) return { ok: false, error: `${platformId} 不支持`, items: [] };
  const items = [];
  try {
    if (target.mode === 'copy') {
      const dir = target.dir();
      let files = [];
      try { files = fs.readdirSync(dir).filter((n) => /^shiyi-imported-.*\.mdc$/i.test(n)); } catch { return { ok: true, platformId, mode: 'copy', path: dir, exists: false, items }; }
      for (const n of files) {
        const p = path.join(dir, n);
        let st = null;
        try { st = fs.statSync(p); } catch { continue; }
        const key = n.replace(/^shiyi-imported-/, '').replace(/\.mdc$/i, '');
        let title = key;
        try {
          const head = fs.readFileSync(p, 'utf8').slice(0, 400);
          const m = head.match(/description:\s*破甲词库注入\s*·\s*(.+)/);
          if (m) title = m[1].trim();
        } catch { /* 读不到就用 key */ }
        items.push({ key, title, dest: p, bytes: st.size, updatedAt: st.mtime.toISOString(), fromLibrary: key.startsWith('lib') });
      }
      return { ok: true, platformId, mode: 'copy', path: dir, exists: true, items };
    }

    const file = target.file();
    if (!existsFileSync(file)) return { ok: true, platformId, mode: 'append', path: file, exists: false, items };
    const text = fs.readFileSync(file, 'utf8');
    const re = /<!--\s*shiyi-imported:([^:>]+):start\s*-->([\s\S]*?)<!--\s*shiyi-imported:\1:end\s*-->/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const key = m[1].trim();
      const body = m[2] || '';
      const title = key.startsWith('lib') ? key.replace(/^lib\d+_/, '').replace(/_/g, ' ') : key;
      items.push({
        key,
        title,
        dest: file,
        bytes: Buffer.byteLength(body, 'utf8'),
        chars: body.length,
        fromLibrary: key.startsWith('lib'),
        index: key.startsWith('lib') ? Number(key.match(/^lib(\d+)_/)?.[1] ?? -1) : -1
      });
    }
    return { ok: true, platformId, mode: 'append', path: file, exists: true, items };
  } catch (e) {
    return { ok: false, error: e.message, platformId, items };
  }
}

/**
 * 卸载一个注入块。
 *   append：按 key 精准摘除标记块（其余内容一个字不动）
 *   copy：把 .mdc 挪进备份目录后删除（不直接 rm，可回滚）
 */
async function removeLibraryInjection(platformId, key, opts = {}) {
  const target = RULE_FILE_TARGETS[platformId];
  if (!target) throw new Error(`${platformId} 不支持`);
  const k = String(key || '').trim();
  if (!k) throw new Error('key 为空');

  if (target.mode === 'copy') {
    const dir = target.dir();
    const file = path.join(dir, `shiyi-imported-${k}.mdc`);
    if (!existsFileSync(file)) return { ok: false, error: '文件已不存在（可能已被手动删除）', dest: file };
    if (opts.backupDir) {
      try {
        await fsp.mkdir(opts.backupDir, { recursive: true });
        await fsp.copyFile(file, path.join(opts.backupDir, `${platformId}-removed-${libStamp()}-${path.basename(file)}`));
      } catch { /* best-effort */ }
    }
    await fsp.rm(file, { force: true });
    return { ok: true, mode: 'copy', dest: file, removed: 1 };
  }

  const file = target.file();
  if (!existsFileSync(file)) return { ok: false, error: '目标文件不存在', dest: file };
  const prev = await fsp.readFile(file, 'utf8');
  const r = stripInjectionBlock(prev, k);
  if (!r.removed) return { ok: false, error: `没找到标记块 ${k}（可能已被手动改过）`, dest: file };
  if (opts.backupDir) {
    try {
      await fsp.mkdir(opts.backupDir, { recursive: true });
      await fsp.copyFile(file, path.join(opts.backupDir, `${platformId}-before-remove-${libStamp()}-${path.basename(file)}`));
    } catch { /* best-effort */ }
  }
  await fsp.writeFile(file, r.text, 'utf8');
  return { ok: true, mode: 'append', dest: file, removed: 1, bytesBefore: Buffer.byteLength(prev, 'utf8'), bytesAfter: Buffer.byteLength(r.text, 'utf8') };
}

module.exports = {
  PACKS,
  PACK_IDS,
  PLATFORM_PROBES,
  DEPLOY_PLANS,
  expandEnv,
  detectPlatform,
  detectAllPlatforms,
  verifyBreak,
  checkEvidence,
  buildSpawn,
  VERIFY_PROMPT,
  buildCliVerifyArgs,
  isCliVerifyInfrastructureError,
  CONFIG_CHECKS,
  analyzeReply,
  findCodexCli,
  findCodexCliInfo,
  findGuiExe,
  probeRuntime,
  runningExeName,
  L4_CHANNELS,
  l4ChannelFor,
  CLI_CHANNELS,
  cliChannelFor,
  buildClaudeVerifyArgs,
  findClaudeCliInfo,
  LEGACY_QUARANTINE_PLANS,
  deployPlanFor,
  isConsentPack,
  SKIP_DIRS,
  MAX_CHANGE_ITEMS,
  toPosix,
  matchesExpected,
  walkStats,
  collectFiles,
  sha256File,
  hashAll,
  extractVersion,
  diffMaps,
  formatBytes,
  formatTime,
  renderReport,
  BRAND_ICONS,
  codexHome,
  claudeHome,
  dshHome,
  workbuddyHome,
  workbuddyAiHome,
  opencodeConfigHome,
  resolvePlatformHome,
  embeddedPacksRoot,
  hasEmbeddedPacks,
  PLATFORM_SIGNATURES,
  detectPackTarget,
  analyzeImportedDir,
  findScript,
  RULE_FILE_TARGETS,
  buildImportBlock,
  IMPORT_SCORE_THRESHOLD,
  TEXT_EXTS,
  // 词库 v2
  loadLibraryRaw,
  loadBuiltinLibrary,
  libraryMeta,
  libraryStats,
  libraryPlatformTargets,
  fetchBuiltinDetail,
  fetchBuiltinDetailRemote,
  resolveLibraryContent,
  importLibraryContent,
  listLibraryInjections,
  removeLibraryInjection,
  verifyLibraryInjection,
  verifyLibraryPlatform,
  injectionKey,
  buildInjectionBlock,
  scanInjectionKeys,
  stripInjectionBlock,
  toLibraryMeta,
  LIBRARY_PREVIEW_CHARS,
  builtinLibraryDir
};
