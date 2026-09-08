'use strict';

/**
 * core.cjs — Dango Desk 的纯逻辑层（无 Electron 依赖，可被 node --test 直接测）
 *
 * 边界说明（重要）：
 *   本模块只做「读」。列目录、读文本、算 sha256、比对差异。
 *   它从不 spawn 进程、从不执行 .ps1/.cmd/.bat/.py/.vbs、从不写入被管理的目录。
 *   所有写操作只落在 Electron 的 userData（设置、基线快照、报告导出）。
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', '__pycache__', '.venv', 'venv']);
const MAX_CHANGE_ITEMS = 200;

/**
 * 六个受管工具包的定义。
 * expected 支持 * 通配（前缀匹配），用于 install-manifest-*.json 这类带时间戳的文件。
 * version 来源按顺序尝试，第一个命中的生效，并把来源一并回报给 UI（不猜、不编造）。
 */
const PACKS = [
  {
    id: 'codex',
    name: 'Codex 破甲包',
    subtitle: 'eni-solo 复刻 · 多事件钩子',
    folder: 'codex',
    target: 'Codex CLI / 桌面端',
    accent: 'sakura',
    note: '上一轮结论：二进制层已到顶，包内走 hooks 注入。',
    expected: ['Install-OneClick.cmd', 'install-replica.ps1', 'materials', 'README-CN.txt', 'Uninstall.ps1'],
    versionSources: [
      { kind: 'firstLines', file: 'install-replica.ps1', maxLines: 60, pattern: 'v(\\d+\\.\\d+\\.\\d+)' },
      { kind: 'firstLines', file: 'README-CN.txt', maxLines: 5, pattern: 'v(\\d+\\.\\d+(?:\\.\\d+)?)' }
    ]
  },
  {
    id: 'cursor',
    name: 'Cursor 破甲包',
    subtitle: 'Composer 2.5 定向 · 提问降维轴',
    folder: 'cursor',
    target: 'Cursor 编辑器',
    accent: 'matcha',
    note: '本轮已做语域软化：[MODE: UNRESTRICTED] → [MODE: LOCAL_WORKSPACE]。',
    expected: [
      'Install-OneClick.cmd',
      'install_cursor.py',
      'patch_cursor_v32.py',
      'deploy_starts.py',
      'materials',
      'tools',
      'README-CN.txt',
      'Uninstall.cmd',
      '破甲强度测试卡.md'
    ],
    versionSources: [
      { kind: 'firstLines', file: 'README-CN.txt', maxLines: 5, pattern: 'v(\\d+\\.\\d+)' },
      { kind: 'firstLines', file: 'Install-OneClick.cmd', maxLines: 40, pattern: 'v(\\d+\\.\\d+)' }
    ]
  },
  {
    id: 'dsh',
    name: 'DSH 破甲懒人包',
    subtitle: 'DeepSeek Harness · 五层架构',
    folder: 'dsh',
    target: 'DeepSeek Harness',
    accent: 'yuzu',
    note: '本轮已加强：shield 插件 order 提到 -200，压在身份声明之前。',
    expected: [
      'install.bat',
      'install.ps1',
      'materials',
      'plugins',
      'prompts',
      'tools',
      'README-CN.txt',
      'MAINTENANCE-HANDOVER.md',
      'Uninstall.cmd'
    ],
    versionSources: [
      { kind: 'firstLines', file: 'install.ps1', maxLines: 10, pattern: 'v(\\d+)\\b' },
      { kind: 'firstLines', file: 'README-CN.txt', maxLines: 5, pattern: 'v(\\d+)\\b' }
    ]
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
    subtitle: 'IDENTITY / MEMORY / SOUL 三层注入',
    folder: 'workbuddy',
    target: 'WorkBuddy 客户端',
    accent: 'soda',
    note: '本轮小加强：模板清理正则改为大小写不敏感 + 7 种标签变体。',
    expected: [
      'Install-OneClick.bat',
      'Install-WB-OneClick.ps1',
      'launch_lazy_pack.py',
      'omen_wb_bridge.py',
      'materials',
      'README-CN.txt',
      'Uninstall.bat',
      '启动-Omen-WorkBuddy.bat',
      '【无窗静默后台启动】Omen.vbs',
      '【一键停止桥接服务】.bat'
    ],
    versionSources: [
      { kind: 'firstLines', file: 'Install-WB-OneClick.ps1', maxLines: 5, pattern: 'v(\\d+\\.\\d+)' },
      { kind: 'firstLines', file: 'README-CN.txt', maxLines: 5, pattern: 'v(\\d+\\.\\d+)' }
    ]
  },
  {
    id: 'anti-gravity',
    name: '反重力破甲包',
    subtitle: 'AGL1-AGL5 · 更新器冻结',
    folder: 'anti-gravity',
    target: 'Google Antigravity',
    accent: 'grape',
    note: '本轮已修：假卸载改真卸载；更新器冻结加回读校验 + 只读 + ACL 三层。',
    expected: [
      'Install-OneClick.cmd',
      'Install-AntiGravity.ps1',
      'Uninstall.cmd',
      'Uninstall.ps1',
      'install-manifest-*.json',
      'materials',
      'README-CN.txt'
    ],
    versionSources: [
      { kind: 'latestManifest', pattern: 'install-manifest-*.json' },
      { kind: 'firstLines', file: 'README-CN.txt', maxLines: 5, pattern: 'v(\\d+\\.\\d+)' }
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
  lines.push('# 团子工作台 · 六包检查报告');
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
    lines.push(`- 目录：\`${p.path || '（未找到）'}\``);
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
   执行方式、写入位置、验证标记全部来自对六个包的实际侦察结果。
   ================================================================== */

const HOME = process.env.USERPROFILE || os.homedir();
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');

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

/**
 * 平台 home 定位。
 * codex / workbuddy 的安装器支持「非 C 盘、非默认位置」（它们自己会全盘扫），
 * 监控侧也必须跟得上，否则装在 D 盘的破甲会被误判成"未安装"。
 * 解析顺序：环境变量 > 默认位置 > 各盘符常见位置；都没有时返回默认位（让 evidence 如实报 false）。
 */
function resolvePlatformHome(envName, dirName, markerFiles) {
  const envVal = envName ? process.env[envName] : null;
  if (envVal && String(envVal).trim() && isDirSync(String(envVal).trim())) return String(envVal).trim();

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

function workbuddyHome() {
  return resolvePlatformHome('WB_HOME', '.workbuddy', ['IDENTITY.md', 'MEMORY.md', 'skills']);
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
 */
const PLATFORM_PROBES = {
  codex: {
    displayName: 'Codex',
    installDirs: [
      path.join(LOCALAPPDATA, 'Programs', 'Codex++'),
      path.join(LOCALAPPDATA, 'Programs', 'Codex'),
      path.join(LOCALAPPDATA, 'Programs', 'codex')
    ],
    exes: ['codex-plus-plus.exe', 'codex.exe', 'Codex.exe'],
    configDirs: [path.join(HOME, '.codex')]
  },
  cursor: {
    displayName: 'Cursor',
    installDirs: [path.join(LOCALAPPDATA, 'Programs', 'cursor'), path.join(LOCALAPPDATA, 'Programs', 'Cursor')],
    exes: ['Cursor.exe', 'cursor.exe'],
    configDirs: [path.join(HOME, '.cursor'), path.join(APPDATA, 'Cursor')]
  },
  dsh: {
    displayName: 'DeepSeek Harness',
    installDirs: [],
    exes: [],
    configDirs: [path.join(HOME, '.dsh')]
  },
  opencode: {
    displayName: 'OpenCode',
    installDirs: [
      path.join(LOCALAPPDATA, 'Programs', '@opencode-aidesktop'),
      path.join(LOCALAPPDATA, 'Programs', 'opencode')
    ],
    exes: ['OpenCode.exe', 'opencode.exe'],
    configDirs: [path.join(APPDATA, 'ai.opencode.desktop'), path.join(HOME, '.opencode')]
  },
  workbuddy: {
    displayName: 'WorkBuddy',
    installDirs: [path.join(LOCALAPPDATA, 'Programs', 'WorkBuddy')],
    exes: ['WorkBuddy.exe'],
    configDirs: [path.join(HOME, '.workbuddy')]
  },
  'anti-gravity': {
    displayName: 'Antigravity',
    installDirs: [
      path.join(LOCALAPPDATA, 'Programs', 'antigravity'),
      path.join(LOCALAPPDATA, 'Programs', 'Antigravity')
    ],
    exes: ['Antigravity.exe', 'antigravity.exe'],
    configDirs: [path.join(HOME, '.gemini'), path.join(APPDATA, 'Antigravity')]
  }
};

/**
 * 六个包的部署计划。
 * evidence 判定"破甲是否生效"，全部来自实际侦察（不是猜的）：
 *   file     目录下存在该文件
 *   dir      该目录存在
 *   contains 文件里能匹配到特征串
 *   glob     目录下存在匹配该正则的条目
 */
const DEPLOY_PLANS = {
  codex: {
    // 直调 ps1 并带 -NoOpenLinks：包里的 cmd 不透传参数，ps1 默认会 start 浏览器弹推广链接
    install: { file: 'install-replica.ps1', kind: 'ps1', args: ['-NoOpenLinks'] },
    uninstall: { file: 'Uninstall.ps1', kind: 'ps1' },
    backupDirs: [codexHome()],
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
  cursor: {
    install: { file: 'Install-OneClick.cmd', kind: 'cmd', input: 'a\r\n' },
    uninstall: { file: 'Uninstall.cmd', kind: 'cmd', input: 'a\r\n' },
    backupDirs: [path.join(HOME, '.cursor')],
    evidence: [
      {
        type: 'glob',
        dir: path.join(HOME, '.cursor', 'rules'),
        pattern: /^shiyi-.*\.mdc$/i,
        label: '.cursor/rules 下有 shiyi-*.mdc'
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
    // 直调 ps1 并带 -NoOpenLinks：包里的 bat 会 start 浏览器打开推广链接
    install: { file: 'Install-WB-OneClick.ps1', kind: 'ps1', args: ['-NoOpenLinks'] },
    uninstall: { file: 'Uninstall.bat', kind: 'cmd' },
    backupDirs: [workbuddyHome()],
    evidence: [
      { type: 'file', path: path.join(workbuddyHome(), 'IDENTITY.md'), label: '.workbuddy/IDENTITY.md 存在' },
      { type: 'file', path: path.join(workbuddyHome(), 'SOUL.md'), label: '.workbuddy/SOUL.md 存在' }
    ]
  },
  'anti-gravity': {
    // 直接调 ps1 并带 -NoOpenLinks：包里的 cmd 会 start 浏览器打开推广链接
    install: { file: 'Install-AntiGravity.ps1', kind: 'ps1', args: ['-NoOpenLinks'] },
    uninstall: { file: 'Uninstall.ps1', kind: 'ps1' },
    backupDirs: [path.join(HOME, '.gemini')],
    evidence: [
      {
        type: 'dir',
        path: path.join(HOME, '.gemini', 'config', 'plugins', 'coldbrew-breakout'),
        label: 'coldbrew-breakout 插件已注入'
      }
    ]
  }
};

function detectPlatform(id) {
  const probe = PLATFORM_PROBES[id];
  const out = {
    id,
    displayName: probe ? probe.displayName : id,
    installed: false,
    installDir: null,
    exePath: null,
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
          out.iconPath = full;
          break;
        }
      }
    }
  }

  // 配置目录：codex/dsh/workbuddy/opencode 支持非默认 home，动态解析优先
  const dynamicConfigDirs = {
    codex: () => [codexHome()],
    dsh: () => [dshHome()],
    workbuddy: () => [workbuddyHome()],
    opencode: () => [opencodeConfigHome(), path.join(APPDATA, 'ai.opencode.desktop')]
  };
  const configCandidates = dynamicConfigDirs[id] ? dynamicConfigDirs[id]() : probe.configDirs;
  for (const c of configCandidates) {
    if (isDirSync(c) && !out.configDirs.includes(c)) out.configDirs.push(c);
  }

  // 没有 exe 但有配置目录也算装过（DSH 走 npx）
  out.installed = Boolean(out.exePath || out.configDirs.length);
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
function buildSpawn(script, packPath) {
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

  'anti-gravity'() {
    const dir = path.join(HOME, '.gemini', 'config', 'plugins', 'coldbrew-breakout');
    const items = [];
    items.push({ ok: isDirSync(dir), label: 'coldbrew-breakout 插件已注入', detail: dir });
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
    hasRoute: /\[?石井\s*ROUTE/i.test(t)
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

/** codex CLI 的可执行文件探测（版本目录会变，扫最新） */
function findCodexCli() {
  const base = path.join(LOCALAPPDATA, 'OpenAI');
  try {
    const dirs = fs
      .readdirSync(base)
      .filter((n) => /^codex-.*-windows-x64-/i.test(n))
      .sort()
      .reverse();
    for (const d of dirs) {
      const exe = path.join(base, d, 'cli-native', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
      if (existsSyncPath(exe)) return exe;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** GUI 客户端的 exe 探测（复用 PLATFORM_PROBES） */
function findGuiExe(id) {
  const p = detectPlatform(id);
  return p.exePath || null;
}

/** 每个平台的 L4 通道类型：cli 真发 / gui playwright 拉起 */
const L4_CHANNELS = {
  codex: { mode: 'cli' },
  dsh: { mode: 'gui-note', note: 'DSH 走 npx 临时缓存，无独立 CLI' },
  cursor: { mode: 'gui' },
  opencode: { mode: 'gui' },
  workbuddy: { mode: 'gui' },
  'anti-gravity': { mode: 'gui' }
};

/* ==================================================================
   内嵌破甲包 · 软件单体分发
   ------------------------------------------------------------------
   打包后六包在 process.resourcesPath/packs；开发态在项目 packed-packs。
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
  return PACKS.every((p) => isDirSync(path.join(root, p.folder)));
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
  cursor: {
    fileHints: [
      { re: /install_cursor|patch_cursor|deploy_starts/i, weight: 40 },
      { re: /^\.cursorrules$/i, weight: 14 },
      { re: /\.mdc$/i, weight: 9 },
      { re: /cursor/i, weight: 7 },
      { re: /破甲强度测试卡/i, weight: 12 }
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
  workbuddy: {
    fileHints: [
      { re: /^Install-WB-OneClick\.ps1$/i, weight: 40 },
      { re: /workbuddy|omen_wb|launch_lazy/i, weight: 25 },
      { re: /omen/i, weight: 8 },
      { re: /WB/i, weight: 3 }
    ],
    contentHints: [
      { re: /workbuddy|\.workbuddy/i, weight: 14 },
      { re: /IDENTITY\.md|SOUL\.md|MEMORY\.md/i, weight: 10 },
      { re: /omen/i, weight: 4 }
    ]
  },
  'anti-gravity': {
    fileHints: [
      { re: /^Install-AntiGravity\.ps1$/i, weight: 40 },
      { re: /antigravity|anti-?gravity/i, weight: 25 },
      { re: /install-manifest-/i, weight: 20 },
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
  workbuddy: [
    { re: /\.workbuddy[\\/]|workbuddy/i, weight: 16 },
    { re: /IDENTITY\.md|SOUL\.md|USER\.md|MEMORY\.md/i, weight: 6 },
    { re: /omen|词元喵喵/i, weight: 5 }
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
  let entries = [];
  try {
    entries = fs.readdirSync(dir).sort();
  } catch {
    return { platform: platformId, dir, readable: false, entries: [], missing: def.expected.slice(), installScript: null, uninstallScript: null, version: null, versionSource: null };
  }
  const missing = def.expected.filter((e) => !entries.some((entry) => matchesExpected(entry, e)));
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
  opencode: {
    mode: 'append',
    file: () => path.join(opencodeConfigHome(), 'AGENTS.md'),
    label: '.config/opencode/AGENTS.md（全局指令层）'
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
  CONFIG_CHECKS,
  analyzeReply,
  findCodexCli,
  findGuiExe,
  L4_CHANNELS,
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
  dshHome,
  workbuddyHome,
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
  TEXT_EXTS
};
