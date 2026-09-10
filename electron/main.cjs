'use strict';

/* 启动耗时打点：仅 DANGO_TRACE=1 时生效，写入 DANGO_TRACE_FILE（默认 TEMP/dango-trace.log）。
   生产环境完全不产生任何 IO 与输出。 */
const T0 = Date.now();
const TRACE_ON = process.env.DANGO_TRACE === '1';
const TRACE_FILE = process.env.DANGO_TRACE_FILE || require('node:path').join(require('node:os').tmpdir(), 'dango-trace.log');
const trace = (label) => {
  if (!TRACE_ON) return;
  try {
    require('node:fs').appendFileSync(TRACE_FILE, `+${String(Date.now() - T0).padStart(5)}ms  ${label}\n`);
  } catch {
    /* 打点失败不影响启动 */
  }
};
trace('=== main.cjs 开始执行 ===');

/**
 * main.cjs — Dango Desk 主进程
 *
 * 设计红线（写死在这里，UI 也无法越权）：
 *   1. 只做读：列目录 / 读文本 / 算哈希 / 比对 / 导出报告。
 *   2. 从不用 child_process 执行被管理目录里的任何脚本
 *      （.ps1 .cmd .bat .py .vbs .js 一律不执行）。
 *   3. 从不写入被管理的目录，只写 Electron userData（设置 / 基线 / 报告）。
 *   4. 渲染层无 node 权限，路径只能来自目录选择对话框或已落盘的 state。
 */

/**
 * 兼容父进程污染：有些终端 / IDE 本身就是 Electron 应用，会把
 * ELECTRON_RUN_AS_NODE=1 传给子进程，导致 electron.exe 退化成纯 Node
 * （此时 require('electron') 拿到的是路径字符串，app 为 undefined）。
 * 这里先清掉再做检测，检测不通过就给出可操作的提示而不是堆栈。
 */
delete process.env.ELECTRON_RUN_AS_NODE;

const electronMain = require('electron');

if (!electronMain || typeof electronMain === 'string' || !electronMain.app) {
  console.error(
    '\n[Dango Desk] Electron 以纯 Node 模式启动，无法创建窗口。\n' +
      '原因：环境变量 ELECTRON_RUN_AS_NODE=1 被父进程传入。\n' +
      '解决：启动前清除它 ——\n' +
      '  PowerShell: Remove-Item Env:ELECTRON_RUN_AS_NODE; .\\DangoDesk.exe\n' +
      '  bash:       unset ELECTRON_RUN_AS_NODE && npx electron .\n'
  );
  process.exit(1);
}

const { app, BrowserWindow, ipcMain, dialog, shell } = electronMain;
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const core = require('./core.cjs');
trace('require(core.cjs) 完成');

// 正常桌面会话保留 Chromium 硬件加速，避免每次启动都额外拉起/初始化
// 软件渲染链。确实运行在无 GPU 的自动化/受限会话时，用 DANGO_NO_GPU=1
// 显式切换；不要同时使用 disable-gpu 和 disable-software-rasterizer，
// 那会把唯一可用的渲染后端一起关掉，表现为子进程启动后立即退出。
if (process.env.DANGO_NO_GPU === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  trace('DANGO_NO_GPU=1，已切换软件渲染');
} else {
  trace('保留 Chromium 硬件加速');
}

// 仅在自动化测试环境（DANGO_NO_SANDBOX=1）下放宽沙箱；
// 正常双击运行时保持 Chromium 默认沙箱。
if (process.env.DANGO_NO_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-setuid-sandbox');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
}

/**
 * 解析 userData 目录。
 * Electron 的 app.getPath('userData') 依赖 %APPDATA% 存在，若被父进程传入了
 * 不存在/不可写的 APPDATA（自定义 HOME、隔离测试环境、受限会话），它会直接抛
 * "Failed to get 'userData' path" 并让主进程崩溃。
 * 这里做三级降级，保证任何情况下都能起来：
 *   1. 官方 userData
 *   2. HOME 下的 .dango-desk
 *   3. 临时目录下的 dango-desk
 */
function resolveUserDir() {
  const tryDir = (p) => {
    if (!p) return null;
    try {
      fs.mkdirSync(p, { recursive: true });
      fs.accessSync(p, fs.constants.W_OK);
      return p;
    } catch {
      return null;
    }
  };

  try {
    const official = app.getPath('userData');
    const ok = tryDir(official);
    if (ok) return ok;
  } catch {
    /* 继续降级 */
  }

  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const fallbackHome = tryDir(home ? path.join(home, '.dango-desk') : null);
  if (fallbackHome) return fallbackHome;

  const fallbackTmp = tryDir(path.join(os.tmpdir(), 'dango-desk'));
  if (fallbackTmp) return fallbackTmp;

  // 真到这一步已经无路可走，明确报错而不是抛看不懂的堆栈
  throw new Error('无法创建任何可写的数据目录（userData / HOME / TEMP 都不可用）');
}

const USER_DIR = resolveUserDir();
trace('resolveUserDir 完成: ' + USER_DIR);
const STATE_FILE = path.join(USER_DIR, 'state.json');
const BASE_DIR = path.join(USER_DIR, 'baselines');
const BACKUP_DIR = path.join(USER_DIR, 'backups');
const IMPORT_DIR = path.join(USER_DIR, 'imported-packs');

const MAX_ACTIVITY = 120;

let win = null;
let busy = false;
let runningProc = null;

/** 备份名时间戳：20260908-141530 */
function stamp() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * 控制台输出解码。cmd 已经 chcp 65001，但 powershell 5.1 仍可能吐 GBK，
 * 这里按替换字符的数量判断是否要改用 gbk 解码。
 */
function decodeBuf(buf) {
  const asUtf8 = buf.toString('utf8');
  const bad = (asUtf8.match(/\uFFFD/g) || []).length;
  if (bad > 2) {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {
      return asUtf8;
    }
  }
  return asUtf8;
}

/** 起一个子进程收 stdout/stderr，带超时与 ELECTRON_RUN_AS_NODE 清理 */
function spawnOnce(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    Object.assign(env, opts.env || {});
    let stdout = '';
    let stderr = '';
    let child;
    // .cmd/.bat 不是可执行映像，node 直接 spawn 会 EINVAL，必须过 cmd.exe
    let file = cmd;
    let argv = args;
    if (/\.(cmd|bat)$/i.test(String(cmd))) {
      file = process.env.ComSpec || 'cmd.exe';
      argv = ['/d', '/s', '/c', cmd, ...args];
    }
    try {
      child = spawn(file, argv, { cwd: opts.cwd, env, windowsHide: true });
    } catch (e) {
      resolve({ code: -1, stdout, stderr: String(e.message || e) });
      return;
    }
    if (child.stdin) child.stdin.end();
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, opts.timeout || 90000);
    child.stdout.on('data', (b) => {
      stdout += decodeBuf(b);
    });
    child.stderr.on('data', (b) => {
      stderr += decodeBuf(b);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(e.message || e) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code == null ? -1 : code, stdout, stderr });
    });
  });
}

/** playwright-core 懒加载（主进程启动时不加载这个大模块） */
let _pwElectron = null;
function getPwElectron() {
  if (!_pwElectron) {
    // playwright-core 无浏览器下载，_electron 直接用目标应用自身的 chromium
    _pwElectron = require('playwright-core')._electron;
  }
  return _pwElectron;
}

/**
 * GUI 会话探测：拉起客户端 → 等窗口 → 检测输入框 → 尝试发送激活口令并抓回复。
 * 通用启发式，per-app 适配失败时如实标注"界面就绪但抓取未适配"，不伪造成功。
 */
async function guiSessionProbe(id) {
  const exe = core.findGuiExe(id);
  if (!exe) return { ok: false, label: '客户端未安装', detail: '' };
  const el = getPwElectron();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.DANGO_NO_SANDBOX = '1';
  let appHandle = null;
  try {
    appHandle = await el.launch({ executablePath: exe, env, timeout: 25000 });
    const window = await appHandle.firstWindow({ timeout: 25000 });
    await window.waitForLoadState('domcontentloaded', { timeout: 25000 });
    const title = await window.title().catch(() => '');

    // 等界面渲染一下再探
    await window.waitForTimeout(3500);
    const inputSel = 'textarea, [contenteditable="true"], [contenteditable]:not([contenteditable="false"])';
    const inputCount = await window.locator(inputSel).count();
    if (!inputCount) {
      await appHandle.close().catch(() => {});
      return { ok: false, label: `界面已加载但找不到输入框（${title || id}）`, detail: title };
    }

    // 尝试发送激活口令
    const input = window.locator(inputSel).first();
    let reply = '';
    let analysis = null;
    try {
      await input.click({ timeout: 4000 });
      await input.fill(core.VERIFY_PROMPT, { timeout: 4000 }).catch(async () => {
        await input.type(core.VERIFY_PROMPT, { timeout: 4000 });
      });
      await window.keyboard.press('Enter');
      // 等回复生成
      await window.waitForTimeout(9000);
      reply = await window.evaluate(() => (document.body ? document.body.innerText : ''));
      analysis = core.analyzeReply(reply);
    } catch (e) {
      analysis = { verdict: 'send-failed', hasShiyi: false, hasRefusal: false, excerpt: String(e.message || e).slice(0, 200) };
    }

    await appHandle.close().catch(() => {});
    const ok = analysis && analysis.verdict === 'active';
    const label =
      analysis && analysis.verdict === 'active'
        ? `激活口令已生效（${title || id}）`
        : analysis && analysis.verdict === 'refused'
          ? '模型拒绝（破甲未生效或对齐拦截）'
          : analysis && analysis.verdict === 'send-failed'
            ? '发送失败（输入框适配）'
            : '界面就绪，但回复未命中特征';
    return { ok, label, detail: title, reply: reply.slice(0, 400), analysis };
  } catch (e) {
    if (appHandle) await appHandle.close().catch(() => {});
    return { ok: false, label: '拉起客户端失败', detail: String(e.message || e).slice(0, 300) };
  }
}

/**
 * 深度分层验证主流程。
 * L1 文件 → L2 配置 → L3 进程 → L4 会话，任一失败即停，报告失败层。
 */
async function runDeepVerify(id) {
  const layers = [];
  const result = { id, layers, passAt: null, failAt: null, reply: null, analysis: null, checkedAt: new Date().toISOString() };

  // L1 文件层
  const l1 = core.verifyBreak(id);
  const l1ok = l1.active === true;
  layers.push({
    layer: 'L1',
    name: '文件层',
    ok: l1ok,
    label: l1ok ? '破甲文件齐全' : '破甲文件缺失或未安装',
    detail: (l1.items || []).map((i) => `${i.ok ? '✓' : '✗'} ${i.label}`).join('；')
  });
  if (!l1ok) {
    result.failAt = 'L1';
    result.layers = layers;
    return result;
  }
  result.passAt = 'L1';

  // L2 配置层
  const checker = core.CONFIG_CHECKS[id];
  const l2 = checker ? checker() : { ok: true, detail: '无配置检查项', items: [] };
  layers.push({
    layer: 'L2',
    name: '配置层',
    ok: l2.ok,
    label: l2.ok ? '配置就绪' : l2.detail,
    detail: (l2.items || []).map((i) => `${i.ok ? '✓' : '✗'} ${i.label}${i.detail ? ` — ${i.detail}` : ''}`).join('；')
  });
  if (!l2.ok) {
    result.failAt = 'L2';
    result.layers = layers;
    return result;
  }
  result.passAt = 'L2';

  // L3 进程层 —— 走 core.probeRuntime 的多源探测，不再单靠一条硬编码路径
  const chan = core.L4_CHANNELS[id] || { mode: 'gui' };
  const rt = core.probeRuntime(id);
  let l3ok = rt.ok;
  let l3label = rt.label;
  let l3detail = rt.detail || '';
  // CLI 通道：拿到 exe 才真起一次；探测期已回退到 GUI 的不在此重复 spawn
  if (rt.ok && rt.mode === 'cli' && rt.exe && !rt.soft) {
    const r = await spawnOnce(rt.exe, ['--version'], { timeout: 20000 });
    l3ok = r.code === 0;
    l3label = l3ok ? `CLI 可启动（${(r.stdout || '').trim().split('\n')[0] || 'codex'}）` : 'CLI 启动失败';
    l3detail = (r.stdout + '\n' + r.stderr).trim().slice(0, 300) || rt.detail || '';
  } else if (rt.ok && !rt.exe) {
    l3detail = [rt.label, rt.detail].filter(Boolean).join('；');
  }
  layers.push({
    layer: 'L3',
    name: '进程层',
    ok: l3ok,
    soft: Boolean(l3ok && rt.soft),
    label: l3label,
    detail: l3detail
  });
  if (!l3ok) {
    result.failAt = 'L3';
    result.layers = layers;
    return result;
  }
  result.passAt = 'L3';

  // L4 会话层 —— 依据 L3 实际拿到的通道决定
  const l4mode = rt.soft ? (rt.exe ? 'gui' : 'skip') : rt.mode;
  if (l4mode === 'skip') {
    layers.push({
      layer: 'L4',
      name: '会话层',
      ok: true,
      soft: true,
      label: '已跳过（该平台无进程通道，仅完成文件/配置两层验证）',
      detail: rt.detail || ''
    });
    result.layers = layers;
    return result;
  }
  if (l4mode === 'cli') {
    const exe = rt.exe || core.findCodexCli();
    if (!exe) {
      layers.push({ layer: 'L4', name: '会话层', ok: false, label: 'CLI 通道不可用', detail: '' });
      result.failAt = 'L4';
      result.layers = layers;
      return result;
    }
    // eslint-disable-next-line no-await-in-loop
    const r = await spawnOnce(exe, ['exec', '-c', 'approval_policy=never', '-c', 'sandbox_mode=read-only', core.VERIFY_PROMPT], {
      timeout: 120000
    });
    const raw = `${r.stdout}\n${r.stderr}`.trim();
    // 配置语义错误（如 models.json 枚举）会在这层暴露，归因回 L2
    if (r.code !== 0 && /failed to parse|models\.json|config\.toml|unknown variant/i.test(raw)) {
      layers.push({ layer: 'L4', name: '会话层', ok: false, label: '会话建立失败（配置解析报错）', detail: raw.slice(0, 400) });
      result.failAt = 'L2';
      result.layers = layers;
      result.reply = raw.slice(0, 400);
      return result;
    }
    const analysis = core.analyzeReply(r.stdout || raw);
    const ok = analysis.verdict === 'active';
    result.analysis = analysis;
    result.reply = analysis.excerpt;
    layers.push({
      layer: 'L4',
      name: '会话层',
      ok,
      label:
        analysis.verdict === 'active'
          ? '激活口令已生效'
          : analysis.verdict === 'refused'
            ? '模型拒绝（破甲未生效或对齐拦截）'
            : analysis.verdict === 'empty'
              ? '无回复（超时或未连接）'
              : '回复未命中特征',
      detail: analysis.excerpt
    });
    if (ok) result.passAt = 'L4';
    else result.failAt = 'L4';
    result.layers = layers;
    return result;
  }
  if (l4mode === 'gui') {
    // eslint-disable-next-line no-await-in-loop
    const g = await guiSessionProbe(id);
    result.analysis = g.analysis || null;
    result.reply = g.reply || null;
    layers.push({ layer: 'L4', name: '会话层', ok: g.ok, label: g.label, detail: (g.detail || '').toString().slice(0, 400) });
    if (g.ok) result.passAt = 'L4';
    else result.failAt = 'L4';
    result.layers = layers;
    return result;
  }
  layers.push({ layer: 'L4', name: '会话层', ok: true, soft: true, label: chan.note || '无可用通道（已跳过）', detail: '' });
  result.layers = layers;
  return result;
}

/* ------------------------------------------------------------------ 状态 */

function defaultState() {
  return { root: null, lastScanAt: null, activity: [], prefs: { autoRefresh: true }, imported: {} };
}

async function loadState() {
  try {
    const raw = await fsp.readFile(STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return { ...defaultState(), ...j, prefs: { ...defaultState().prefs, ...(j.prefs || {}) } };
  } catch {
    return defaultState();
  }
}

async function saveState(state) {
  await fsp.mkdir(USER_DIR, { recursive: true });
  await fsp.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function pushActivity(state, kind, text) {
  state.activity.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString(), kind, text });
  state.activity = state.activity.slice(0, MAX_ACTIVITY);
}

function baselineFile(id) {
  return path.join(BASE_DIR, `${id}.json`);
}

/**
 * 包目录三级解析：导入覆盖 > 外部根目录 > 内嵌包。
 * 返回 { dir, source } —— source: imported | external | embedded | none
 */
function resolvePackDir(state, def) {
  const imp = state.imported && state.imported[def.id];
  if (imp && imp.kind === 'dir' && imp.path) {
    try {
      if (fs.statSync(imp.path).isDirectory()) return { dir: imp.path, source: 'imported' };
    } catch {
      /* 导入源已被移动/删除，落回下一级 */
    }
  }
  if (state.root) {
    const p = path.join(state.root, def.folder);
    try {
      if (fs.statSync(p).isDirectory()) return { dir: p, source: 'external' };
    } catch {
      /* 外部根目录下没有这个包，落回内嵌 */
    }
  }
  const embedded = core.embeddedPacksRoot();
  if (embedded) {
    const p = path.join(embedded, def.folder);
    try {
      if (fs.statSync(p).isDirectory()) return { dir: p, source: 'embedded' };
    } catch {
      /* 内嵌缺失（未打包的开发态可能如此） */
    }
  }
  return { dir: null, source: 'none' };
}

async function readBaseline(id) {
  try {
    return JSON.parse(await fsp.readFile(baselineFile(id), 'utf8'));
  } catch {
    return null;
  }
}

async function writeBaseline(id, data) {
  await fsp.mkdir(BASE_DIR, { recursive: true });
  await fsp.writeFile(baselineFile(id), JSON.stringify(data, null, 2), 'utf8');
}

/* ------------------------------------------------------------- 扫描实现 */

async function scanPack(state, def) {
  const resolved = resolvePackDir(state, def);
  const packPath = resolved.dir;
  const base = {
    id: def.id,
    name: def.name,
    subtitle: def.subtitle,
    folder: def.folder,
    target: def.target,
    accent: def.accent,
    note: def.note,
    path: packPath,
    source: resolved.source,
    found: false,
    version: null,
    versionSource: null,
    fileCount: 0,
    dirCount: 0,
    bytes: 0,
    modifiedAt: null,
    entries: [],
    missingEntries: [],
    skippedDirs: 0,
    warnings: [],
    baselineAt: null,
    lastCheckedAt: null,
    lastResult: 'untracked',
    lastChanges: null
  };

  if (!packPath) {
    base.warnings.push('未找到包目录（外部根目录与内嵌包都没有）');
    return base;
  }

  let st = null;
  try {
    st = await fsp.stat(packPath);
  } catch {
    base.warnings.push('目录不存在');
    return base;
  }
  if (!st.isDirectory()) {
    base.warnings.push('路径不是目录');
    return base;
  }

  base.found = true;

  try {
    base.entries = (await fsp.readdir(packPath)).sort();
  } catch {
    base.warnings.push('目录不可读');
  }

  base.missingEntries = def.expected.filter(
    (e) => !base.entries.some((entry) => core.matchesExpected(entry, e))
  );

  try {
    const stats = await core.walkStats(packPath);
    base.fileCount = stats.fileCount;
    base.dirCount = stats.dirCount;
    base.bytes = stats.bytes;
    base.modifiedAt = stats.modifiedAt;
    base.skippedDirs = stats.skippedDirs;
  } catch {
    base.warnings.push('统计时出错');
  }

  const v = core.extractVersion(packPath, def.versionSources);
  if (v) {
    base.version = v.version;
    base.versionSource = v.source;
  } else {
    base.warnings.push('未找到版本标注');
  }

  if (base.missingEntries.length) {
    base.warnings.push(`缺失 ${base.missingEntries.length} 个预期条目`);
  }
  if (base.skippedDirs > 0) {
    base.warnings.push(`已跳过 ${base.skippedDirs} 个缓存目录`);
  }
  if (base.fileCount === 0) {
    base.warnings.push('目录为空');
  }

  const bl = await readBaseline(def.id);
  if (bl) {
    base.baselineAt = bl.createdAt || null;
    base.lastCheckedAt = bl.lastCheckedAt || null;
    base.lastResult = bl.lastResult || 'recorded';
    base.lastChanges = bl.lastChanges || null;
  }

  return base;
}

async function buildHub() {
  const state = await loadState();
  // 七个包互不共享可变扫描状态。并行扫描避免启动时把七段目录 I/O
  // 串成一条长链，尤其是首次从 resources/packs 读取时收益明显。
  const packs = await Promise.all(core.PACKS.map((def) => scanPack(state, def)));
  const embeddedRoot = core.embeddedPacksRoot();
  return {
    root: state.root,
    lastScanAt: state.lastScanAt,
    prefs: state.prefs,
    activity: state.activity,
    packs,
    appVersion: app.getVersion(),
    userDir: USER_DIR,
    embeddedRoot,
    hasEmbedded: Boolean(embeddedRoot)
  };
}

function emitProgress(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('dango:progress', payload);
}

function emitLog(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('dango:log', payload);
}

/* -------------------------------------------------------------- IPC 注册 */

function guard(id) {
  if (!core.PACK_IDS.includes(id)) throw new Error('未知的包 ID');
}

async function withBusy(fn) {
  if (busy) throw new Error('另一个任务正在运行，请稍候');
  busy = true;
  emitProgress({ busy: true });
  try {
    return await fn();
  } finally {
    busy = false;
    emitProgress({ busy: false, done: true });
  }
}

function registerIpc() {
  ipcMain.handle('dango:load', async () => buildHub());

  ipcMain.handle('dango:chooseRoot', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '选择包含七个工具包的根目录',
      properties: ['openDirectory']
    });
    if (res.canceled || !res.filePaths.length) return buildHub();
    const state = await loadState();
    state.root = res.filePaths[0];
    state.lastScanAt = new Date().toISOString();
    pushActivity(state, 'root', `选择根目录：${state.root}`);
    await saveState(state);
    return buildHub();
  });

  ipcMain.handle('dango:clearRoot', async () => {
    const state = await loadState();
    state.root = null;
    state.lastScanAt = null;
    pushActivity(state, 'root', '清除根目录设置');
    await saveState(state);
    return buildHub();
  });

  ipcMain.handle('dango:refresh', async () => {
    const state = await loadState();
    state.lastScanAt = new Date().toISOString();
    pushActivity(state, 'scan', '重新扫描目录');
    await saveState(state);
    return buildHub();
  });

  ipcMain.handle('dango:openRoot', async () => {
    const state = await loadState();
    if (!state.root) return { ok: false, error: '尚未选择根目录' };
    const r = await shell.openPath(state.root);
    return { ok: !r, error: r || null };
  });

  ipcMain.handle('dango:openPack', async (_e, id) => {
    guard(id);
    const state = await loadState();
    const def = core.PACKS.find((p) => p.id === id);
    const { dir } = resolvePackDir(state, def);
    if (!dir) return { ok: false, error: '未找到包目录（外部根目录与内嵌包都没有）' };
    const r = await shell.openPath(dir);
    return { ok: !r, error: r || null };
  });

  ipcMain.handle('dango:captureBaseline', async (_e, id) => {
    guard(id);
    return withBusy(async () => {
      const state = await loadState();
      const def = core.PACKS.find((p) => p.id === id);
      const { dir: packPath } = resolvePackDir(state, def);
      if (!packPath) throw new Error('未找到包目录（外部根目录与内嵌包都没有）');
      try {
        await fsp.stat(packPath);
      } catch {
        throw new Error(`目录不存在：${packPath}`);
      }

      emitProgress({ stage: 'collect', packId: id, value: 0, total: 0, current: '正在枚举文件' });
      const rels = [...(await core.collectFiles(packPath)).keys()].sort();

      emitProgress({ stage: 'hash', packId: id, value: 0, total: rels.length, current: '开始计算' });
      const files = await core.hashAll(packPath, rels, (done, total, rel) => {
        emitProgress({ stage: 'hash', packId: id, value: done, total, current: rel });
      });

      const now = new Date().toISOString();
      await writeBaseline(id, {
        id,
        root: state.root,
        createdAt: now,
        fileCount: rels.length,
        lastCheckedAt: null,
        lastResult: 'recorded',
        lastChanges: null,
        files
      });
      pushActivity(state, 'baseline', `${def.name}：建立基线快照（${rels.length} 个文件）`);
      await saveState(state);
      return buildHub();
    });
  });

  ipcMain.handle('dango:verify', async (_e, id) => {
    guard(id);
    return withBusy(async () => {
      const state = await loadState();
      const def = core.PACKS.find((p) => p.id === id);
      const { dir: packPath } = resolvePackDir(state, def);
      if (!packPath) throw new Error('未找到包目录（外部根目录与内嵌包都没有）');
      const bl = await readBaseline(id);
      if (!bl) throw new Error('尚未建立基线快照，请先建立');
      try {
        await fsp.stat(packPath);
      } catch {
        throw new Error(`目录不存在：${packPath}`);
      }

      emitProgress({ stage: 'collect', packId: id, value: 0, total: 0, current: '正在枚举文件' });
      const rels = [...(await core.collectFiles(packPath)).keys()].sort();

      emitProgress({ stage: 'hash', packId: id, value: 0, total: rels.length, current: '开始计算' });
      const files = await core.hashAll(packPath, rels, (done, total, rel) => {
        emitProgress({ stage: 'hash', packId: id, value: done, total, current: rel });
      });

      const diff = core.diffMaps(bl.files, files);
      const now = new Date().toISOString();
      await writeBaseline(id, {
        ...bl,
        root: state.root,
        lastCheckedAt: now,
        lastResult: diff.changed === 0 ? 'unchanged' : 'changed',
        lastChanges: diff
      });
      pushActivity(
        state,
        diff.changed === 0 ? 'verify-ok' : 'verify-diff',
        `${def.name}：检查完成，${diff.changed === 0 ? `与基线一致（${diff.unchanged} 个文件）` : `发现 ${diff.changed} 处变更`}`
      );
      await saveState(state);
      return buildHub();
    });
  });

  ipcMain.handle('dango:clearBaseline', async (_e, id) => {
    guard(id);
    const state = await loadState();
    try {
      await fsp.unlink(baselineFile(id));
      pushActivity(state, 'baseline', `${id}：清除基线快照`);
    } catch {
      pushActivity(state, 'baseline', `${id}：无基线可清除`);
    }
    await saveState(state);
    return buildHub();
  });

  ipcMain.handle('dango:exportReport', async () => {
    const hub = await buildHub();
    const md = core.renderReport(hub);
    const res = await dialog.showSaveDialog(win, {
      title: '导出检查报告',
      defaultPath: path.join(app.getPath('downloads'), 'dango-desk-report.md'),
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Text', extensions: ['txt'] }
      ]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    await fsp.writeFile(res.filePath, md, 'utf8');
    const state = await loadState();
    pushActivity(state, 'report', `导出报告：${res.filePath}`);
    await saveState(state);
    return { ok: true, path: res.filePath };
  });

  /* ==============================================================
     部署引擎：探测 / 图标 / 备份 / 安装 / 卸载 / 生效验证
     --------------------------------------------------------------
     只 spawn 各包目录里已存在的脚本，不生成也不改写任何注入内容。
     ============================================================== */

  ipcMain.handle('dango:detect', async () => {
    const platforms = core.detectAllPlatforms();
    const breaks = {};
    const plans = {};
    for (const id of core.PACK_IDS) {
      breaks[id] = core.verifyBreak(id);
      const plan = core.DEPLOY_PLANS[id] || {};
      plans[id] = {
        hasInstall: Boolean(plan.install),
        hasUninstall: Boolean(plan.uninstall),
        installFile: plan.install ? plan.install.file : null,
        uninstallFile: plan.uninstall ? plan.uninstall.file : null
      };
    }
    return { platforms, breaks, plans };
  });

  ipcMain.handle('dango:getIcon', async (_e, id) => {
    guard(id);
    if (core.BRAND_ICONS && core.BRAND_ICONS[id]) {
      return { id, dataUrl: core.BRAND_ICONS[id] };
    }
    const p = core.detectPlatform(id);
    if (!p.iconPath) return { id, dataUrl: null };
    try {
      const img = await app.getFileIcon(p.iconPath, { size: 'large' });
      return { id, dataUrl: img.toDataURL() };
    } catch {
      return { id, dataUrl: null };
    }
  });

  ipcMain.handle('dango:verifyBreak', async (_e, id) => {
    guard(id);
    return core.verifyBreak(id);
  });

  ipcMain.handle('dango:listBackups', async (_e, id) => {
    guard(id);
    try {
      const all = await fsp.readdir(BACKUP_DIR);
      return all
        .filter((n) => n.startsWith(`${id}-`))
        .sort()
        .reverse()
        .map((n) => ({ name: n, time: n.replace(`${id}-`, '') }));
    } catch {
      return [];
    }
  });

  ipcMain.handle('dango:backup', async (_e, id) => {
    guard(id);
    return withBusy(async () => {
      const plan = core.DEPLOY_PLANS[id] || {};
      const dirs = (plan.backupDirs || []).filter((d) => {
        try {
          return fs.statSync(d).isDirectory();
        } catch {
          return false;
        }
      });
      if (!dirs.length) throw new Error('没有可备份的目录');
      const name = `${id}-${stamp()}`;
      const dest = path.join(BACKUP_DIR, name);
      await fsp.mkdir(dest, { recursive: true });
      for (const d of dirs) {
        // eslint-disable-next-line no-await-in-loop
        await fsp.cp(d, path.join(dest, path.basename(d)), { recursive: true });
      }
      const state = await loadState();
      pushActivity(state, 'backup', `${id}：备份到 ${name}`);
      await saveState(state);
      return { ok: true, name, dirs };
    });
  });

  ipcMain.handle('dango:restore', async (_e, id, name) => {
    guard(id);
    if (!/^[a-z-]+-\d{8}-\d{6}$/.test(String(name || ''))) throw new Error('备份名不合法');
    return withBusy(async () => {
      const src = path.join(BACKUP_DIR, String(name));
      try {
        await fsp.stat(src);
      } catch {
        throw new Error('备份不存在');
      }
      const entries = await fsp.readdir(src);
      const plan = core.DEPLOY_PLANS[id] || {};
      for (const entry of entries) {
        const from = path.join(src, entry);
        // 只还原到该包声明过的备份位置，避免把备份写到任意路径
        const target = (plan.backupDirs || []).find((d) => path.basename(d) === entry);
        if (!target) continue;
        // eslint-disable-next-line no-await-in-loop
        await fsp.cp(from, target, { recursive: true });
      }
      const state = await loadState();
      pushActivity(state, 'restore', `${id}：从 ${name} 恢复`);
      await saveState(state);
      return { ok: true };
    });
  });

  ipcMain.handle('dango:deploy', async (_e, id, action) => {
    guard(id);
    if (action !== 'install' && action !== 'uninstall') throw new Error('未知动作');
    return withBusy(async () => {
      const state = await loadState();
      const def = core.PACKS.find((p) => p.id === id);
      const { dir: packPath } = resolvePackDir(state, def);
      if (!packPath) throw new Error('未找到包目录（外部根目录与内嵌包都没有）');
      const plan = core.DEPLOY_PLANS[id] || {};
      const script = action === 'install' ? plan.install : plan.uninstall;
      if (!script) throw new Error(`${def.name} 没有提供${action === 'install' ? '安装' : '卸载'}脚本`);

      const sp = core.buildSpawn(script, packPath);
      if (!sp) throw new Error(`包内找不到脚本：${script.file}`);

      const label = action === 'install' ? '安装' : '卸载';
      emitLog({ id, action, kind: 'cmd', line: `$ ${sp.display}` });
      emitLog({ id, action, kind: 'sys', line: `工作目录：${packPath}` });

      const code = await new Promise((resolve, reject) => {
        let child;
        // 清掉父进程可能传入的 ELECTRON_RUN_AS_NODE，避免包内脚本调 node/electron 时退化
        const childEnv = { ...process.env };
        delete childEnv.ELECTRON_RUN_AS_NODE;
        Object.assign(childEnv, script.env || {});
        try {
          child = spawn(sp.cmd, sp.args, {
            cwd: packPath,
            env: childEnv,
            windowsHide: true,
            windowsVerbatimArguments: true
          });
        } catch (e) {
          reject(e);
          return;
        }
        runningProc = child;
        const inputToSend = sp.input || script.input;
        if (child.stdin) {
          if (inputToSend) {
            emitLog({ id, action, kind: 'sys', line: `[输入通道] 自动响应选项: ${JSON.stringify(inputToSend.trim())}` });
            child.stdin.write(inputToSend);
          }
          // 脚本结尾带 pause，stdin 闭合后 pause 自动放行不卡住
          child.stdin.end();
        }
        child.stdout.on('data', (b) => emitLog({ id, action, kind: 'out', line: decodeBuf(b) }));
        child.stderr.on('data', (b) => emitLog({ id, action, kind: 'err', line: decodeBuf(b) }));
        child.on('error', (e) => reject(e));
        child.on('close', (c) => resolve(c));
      });

      runningProc = null;
      const ok = code === 0;
      emitLog({ id, action, kind: ok ? 'ok' : 'fail', line: `退出码 ${code}` });

      if (ok && action === 'install') {
        const v = core.verifyBreak(id);
        emitLog({
          id,
          action,
          kind: v.active ? 'ok' : 'warn',
          line: v.active ? `生效验证：通过（${v.items.filter((i) => i.ok).length}/${v.items.length}）` : '生效验证：未通过，可能需要重启目标软件'
        });
      }

      const st2 = await loadState();
      pushActivity(st2, ok ? 'deploy-ok' : 'deploy-fail', `${def.name}：${label}${ok ? '完成' : `失败（退出码 ${code}）`}`);
      await saveState(st2);
      return { ok, code, verify: core.verifyBreak(id) };
    });
  });

  ipcMain.handle('dango:cancelDeploy', async () => {
    if (runningProc && !runningProc.killed) {
      runningProc.kill();
      runningProc = null;
      return { ok: true };
    }
    return { ok: false };
  });

  ipcMain.handle('dango:verifyDeep', async (_e, id) => {
    guard(id);
    const chan = core.L4_CHANNELS[id] || { mode: 'gui' };
    // GUI 拉起会短暂把客户端顶到前台，先明确提示
    emitLog({ id, action: 'install', kind: 'sys', line: `开始深度验证：${id}（L1 文件 → L2 配置 → L3 进程 → L4 会话）` });
    const r = await withBusy(() => runDeepVerify(id));
    const state = await loadState();
    const summary = r.failAt
      ? `失败在 ${r.failAt}${r.layers.find((l) => l.layer === r.failAt) ? `：${r.layers.find((l) => l.layer === r.failAt).label}` : ''}`
      : '全部四层通过';
    pushActivity(state, r.failAt ? 'verify-fail' : 'verify-ok', `${id} 深度验证：${summary}`);
    await saveState(state);
    return r;
  });

  ipcMain.handle('dango:openExternal', async (_e, url) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      await shell.openExternal(url);
      return { ok: true };
    }
    return { ok: false, error: '非法链接' };
  });

  /* ==============================================================
     第三方破甲包导入
     --------------------------------------------------------------
     识别交给 core.detectPackTarget（打分透明），落地动作在这里：
     - 单平台包目录 → 注册到 state.imported（覆盖三级路径最高级）
     - 单个规则文件 → copy / append 到平台注入点（append 前先备份）
     ============================================================== */

  ipcMain.handle('dango:chooseImportPath', async (_e, kind) => {
    // Windows/Linux 上 openFile 与 openDirectory 不能同时生效（会退化成纯目录选择器），
    // 因此必须由 UI 明确指定要选文件还是目录。
    const wantFile = kind === 'file';
    const opts = {
      title: wantFile ? '选择要导入的规则文件' : '选择要导入的破甲包目录',
      properties: wantFile ? ['openFile'] : ['openDirectory']
    };
    if (wantFile) {
      opts.filters = [
        { name: '规则文件', extensions: ['md', 'mdc', 'txt', 'json', 'jsonc', 'yaml', 'yml', 'ps1', 'cmd', 'bat', 'py', 'js', 'mjs', 'cjs', 'ts', 'toml', 'vbs'] },
        { name: '全部文件', extensions: ['*'] }
      ];
    }
    const res = await dialog.showOpenDialog(win, opts);
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    return { canceled: false, path: res.filePaths[0] };
  });

  ipcMain.handle('dango:analyzeImport', async (_e, inputPath) => {
    if (typeof inputPath !== 'string' || !inputPath.trim()) throw new Error('路径为空');
    const det = core.detectPackTarget(inputPath.trim());
    if (det.kind === 'single' && det.inputKind === 'dir' && det.platform) {
      det.analysis = core.analyzeImportedDir(det.path, det.platform);
    }
    if (det.kind === 'multi-root' && Array.isArray(det.platforms)) {
      det.platforms = det.platforms.map((p) => ({ ...p, analysis: core.analyzeImportedDir(p.path, p.platform) }));
    }
    return det;
  });

  ipcMain.handle('dango:importPackDir', async (_e, inputPath, platformId) => {
    guard(platformId);
    if (typeof inputPath !== 'string' || !inputPath.trim()) throw new Error('路径为空');
    const dir = inputPath.trim();
    try {
      if (!fs.statSync(dir).isDirectory()) throw new Error('x');
    } catch {
      throw new Error('不是目录或不可读');
    }
    const state = await loadState();
    state.imported[platformId] = { kind: 'dir', path: dir, importedAt: new Date().toISOString() };
    const def = core.PACKS.find((p) => p.id === platformId);
    pushActivity(state, 'import', `导入 ${def ? def.name : platformId}：${dir}`);
    await saveState(state);
    return buildHub();
  });

  ipcMain.handle('dango:importSingleFile', async (_e, inputPath, platformId) => {
    guard(platformId);
    if (typeof inputPath !== 'string' || !inputPath.trim()) throw new Error('路径为空');
    const file = inputPath.trim();
    const ext = path.extname(file).toLowerCase();
    if (!core.TEXT_EXTS.has(ext)) {
      throw new Error(`不支持的文件类型 ${ext || '(无扩展名)'}，请选文本规则文件（.md/.mdc/.txt 等）`);
    }
    let content;
    try {
      if (!fs.statSync(file).isFile()) throw new Error('x');
      content = fs.readFileSync(file, 'utf8');
    } catch {
      throw new Error('文件不可读');
    }
    const target = core.RULE_FILE_TARGETS[platformId];
    if (!target) throw new Error(`${platformId} 不支持单文件导入`);
    const name = path.basename(file);

    if (target.mode === 'copy') {
      const destDir = target.dir();
      await fsp.mkdir(destDir, { recursive: true });
      const dest = path.join(destDir, target.fileName(name));
      const body = target.wrap ? target.wrap(name, content) : content;
      await fsp.writeFile(dest, body, 'utf8');
      const state = await loadState();
      pushActivity(state, 'import', `导入规则文件 → ${platformId}：${dest}`);
      await saveState(state);
      return { ok: true, mode: 'copy', dest, label: target.label };
    }

    const targetFile = target.file();
    await fsp.mkdir(path.dirname(targetFile), { recursive: true });
    if (fs.existsSync(targetFile)) {
      const bakDir = path.join(BACKUP_DIR, 'import-append');
      await fsp.mkdir(bakDir, { recursive: true });
      await fsp.copyFile(targetFile, path.join(bakDir, `${platformId}-${stamp()}-${path.basename(targetFile)}`));
    }
    const block = core.buildImportBlock(name, content);
    await fsp.appendFile(targetFile, block, 'utf8');
    const state = await loadState();
    pushActivity(state, 'import', `追加规则文件 → ${platformId}：${targetFile}`);
    await saveState(state);
    return { ok: true, mode: 'append', dest: targetFile, label: target.label };
  });

  ipcMain.handle('dango:clearImport', async (_e, platformId) => {
    guard(platformId);
    const state = await loadState();
    if (state.imported && state.imported[platformId]) {
      delete state.imported[platformId];
      pushActivity(state, 'import', `移除导入：${platformId}`);
      await saveState(state);
    }
    return buildHub();
  });

  ipcMain.handle('dango:listImports', async () => {
    const state = await loadState();
    return state.imported || {};
  });

  // ---------- 词库 v2（智汇AI 提示词库） ----------
  //
  // 注入历史独立存放在 userData/library-injections.json。
  // 绝不写 state.imported —— 那是第三方破甲包的槽位，
  // 混用会把用户导入的包顶掉（v1.2.1 的 bug）。

  const LIB_HISTORY_FILE = path.join(USER_DIR, 'library-injections.json');

  async function loadLibHistory() {
    try {
      const j = JSON.parse(await fsp.readFile(LIB_HISTORY_FILE, 'utf8'));
      return Array.isArray(j.items) ? j : { items: [] };
    } catch {
      return { items: [] };
    }
  }

  async function saveLibHistory(h) {
    await fsp.mkdir(USER_DIR, { recursive: true });
    h.items = (h.items || []).slice(0, 500);
    await fsp.writeFile(LIB_HISTORY_FILE, JSON.stringify(h, null, 2), 'utf8');
  }

  /** 列表：只传 metadata + preview（~1MB），全文按需再取 */
  ipcMain.handle('dango:libraryList', async () => {
    return core.libraryMeta();
  });

  ipcMain.handle('dango:libraryStats', async () => {
    return core.libraryStats();
  });

  /** 单条全文：本地优先，preview-only 才联网补全 */
  ipcMain.handle('dango:libraryDetail', async (_e, index) => {
    return core.resolveLibraryContent(Number(index));
  });

  /** 平台注入点预检：写到哪、文件现状、已有多少注入块 */
  ipcMain.handle('dango:libraryTargets', async () => {
    return { ok: true, targets: core.libraryPlatformTargets() };
  });

  /** 注入（单条）。写盘 + 记历史 + 活动日志 */
  ipcMain.handle('dango:libraryImport', async (_e, args) => {
    const platformId = String(args?.platformId || '');
    guard(platformId);
    const index = Number(args?.index);
    const name = String(args?.name || '');
    let content = typeof args?.content === 'string' ? args.content : '';

    // UI 只传 index 也行：主进程自己解析全文（本地 → 联网兜底）
    if (!content.trim() && Number.isInteger(index) && index >= 0) {
      const r = await core.resolveLibraryContent(index);
      if (!r.ok || !r.detail?.content) throw new Error(r.error || '词条内容为空且联网补全失败');
      content = r.detail.content;
    }
    if (!content.trim()) throw new Error('词条内容为空');

    const result = await core.importLibraryContent(platformId, name, content, {
      index,
      mode: args?.mode === 'replace' ? 'replace' : 'append',
      backupDir: path.join(BACKUP_DIR, 'library-append')
    });

    // 写后回读复核：确认标记块真的落盘、内容哈希一致
    const verify = core.verifyLibraryInjection(platformId, result.key, result.contentHash);

    const state = await loadState();
    pushActivity(state, 'library', `词库注入 → ${platformId}：${name || '(未命名)'}${verify.verdict === 'active' ? '（已复核生效）' : `（复核：${verify.verdict}）`}`);
    await saveState(state);

    const h = await loadLibHistory();
    h.items.unshift({
      key: result.key,
      platformId,
      index: Number.isInteger(index) ? index : -1,
      name,
      dest: result.dest,
      mode: result.mode,
      bytes: result.bytes || content.length,
      contentHash: result.contentHash,
      injectMode: args?.mode === 'replace' ? 'replace' : 'append',
      displaced: result.displaced || [],
      at: new Date().toISOString()
    });
    await saveLibHistory(h);

    return { ...result, verify };
  });

  /** 批量注入：逐条执行，返回每条结果，不因单条失败中断 */
  ipcMain.handle('dango:libraryImportBatch', async (_e, args) => {
    const platformId = String(args?.platformId || '');
    guard(platformId);
    const entries = Array.isArray(args?.entries) ? args.entries : [];
    if (!entries.length) throw new Error('没有选中词条');
    if (entries.length > 50) throw new Error('一次最多批量注入 50 条，避免规则文件过载');

    const results = [];
    const h = await loadLibHistory();
    const injectMode = args?.mode === 'replace' ? 'replace' : 'append';
    for (const it of entries) {
      const index = Number(it?.index);
      const name = String(it?.name || '');
      try {
        let content = typeof it?.content === 'string' ? it.content : '';
        if (!content.trim() && Number.isInteger(index) && index >= 0) {
          const r = await core.resolveLibraryContent(index);
          if (!r.ok || !r.detail?.content) throw new Error(r.error || '内容为空且联网补全失败');
          content = r.detail.content;
        }
        if (!content.trim()) throw new Error('词条内容为空');
        const res = await core.importLibraryContent(platformId, name, content, {
          index,
          // 批量默认 append：用户显式选了多条，意图就是叠加；replace 会互相顶掉
          mode: injectMode,
          backupDir: path.join(BACKUP_DIR, 'library-append')
        });
        const verify = core.verifyLibraryInjection(platformId, res.key, res.contentHash);
        results.push({ ok: true, index, name, key: res.key, dest: res.dest, mode: res.mode, verify: verify.verdict });
        h.items.unshift({
          key: res.key, platformId, index: Number.isInteger(index) ? index : -1,
          name, dest: res.dest, mode: res.mode, bytes: res.bytes || content.length,
          contentHash: res.contentHash, injectMode, displaced: res.displaced || [], at: new Date().toISOString()
        });
      } catch (e) {
        results.push({ ok: false, index, name, error: e instanceof Error ? e.message : String(e) });
      }
    }
    await saveLibHistory(h);
    const state = await loadState();
    const okN = results.filter((r) => r.ok).length;
    pushActivity(state, 'library', `词库批量注入 → ${platformId}：${okN}/${results.length} 成功`);
    await saveState(state);
    return { ok: true, platformId, results, okCount: okN, failCount: results.length - okN };
  });

  /** 某平台当前磁盘上真实生效的注入块（带注入时哈希复核 + 破甲层状态） */
  ipcMain.handle('dango:libraryInjections', async (_e, platformId) => {
    guard(platformId);
    const h = await loadLibHistory();
    return core.verifyLibraryPlatform(String(platformId), h.items || []);
  });

  /** 全部平台的注入概览（管理页用，含复核结果） */
  ipcMain.handle('dango:libraryInjectionsAll', async () => {
    const h = await loadLibHistory();
    const out = {};
    for (const id of Object.keys(core.RULE_FILE_TARGETS)) {
      out[id] = core.verifyLibraryPlatform(id, h.items || []);
    }
    return { ok: true, platforms: out, history: h.items };
  });

  /** 单块复核：注入后 / 客户端更新后随时验证某条注入是否仍然生效 */
  ipcMain.handle('dango:libraryVerify', async (_e, args) => {
    const platformId = String(args?.platformId || '');
    const key = String(args?.key || '');
    guard(platformId);
    const h = await loadLibHistory();
    const hist = (h.items || []).find((x) => x.platformId === platformId && x.key === key);
    return core.verifyLibraryInjection(platformId, key, hist ? hist.contentHash : undefined);
  });

  /** 卸载单个注入块（按 key 精准摘除，其余内容不动） */
  ipcMain.handle('dango:libraryRemove', async (_e, args) => {
    const platformId = String(args?.platformId || '');
    const key = String(args?.key || '');
    guard(platformId);
    if (!key.trim()) throw new Error('key 为空');
    const r = await core.removeLibraryInjection(platformId, key, {
      backupDir: path.join(BACKUP_DIR, 'library-remove')
    });
    if (r.ok) {
      const state = await loadState();
      pushActivity(state, 'library', `词库卸载 ← ${platformId}：${key}`);
      await saveState(state);
      const h = await loadLibHistory();
      h.items = (h.items || []).filter((x) => !(x.platformId === platformId && x.key === key));
      await saveLibHistory(h);
    }
    return r;
  });

  /** 一键清空某平台的所有词库注入（只动 lib* 标记块，第三方导入的块不碰） */
  ipcMain.handle('dango:libraryClearPlatform', async (_e, platformId) => {
    guard(platformId);
    const scan = core.listLibraryInjections(String(platformId));
    if (!scan.ok) return scan;
    let removed = 0;
    const errors = [];
    for (const it of scan.items || []) {
      if (!it.fromLibrary) continue; // 只清词库注入的，用户自己导入的不动
      try {
        const r = await core.removeLibraryInjection(String(platformId), it.key, {
          backupDir: path.join(BACKUP_DIR, 'library-remove')
        });
        if (r.ok) removed += 1;
        else errors.push(`${it.key}: ${r.error}`);
      } catch (e) {
        errors.push(`${it.key}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const state = await loadState();
    pushActivity(state, 'library', `清空词库注入 ← ${platformId}：移除 ${removed} 块`);
    await saveState(state);
    const h = await loadLibHistory();
    h.items = (h.items || []).filter((x) => x.platformId !== String(platformId));
    await saveLibHistory(h);
    return { ok: true, removed, errors };
  });

  /** 打开注入目标文件所在目录（资源管理器） */
  ipcMain.handle('dango:libraryOpenDest', async (_e, args) => {
    const platformId = String(args?.platformId || '');
    guard(platformId);
    const t = core.RULE_FILE_TARGETS[platformId];
    if (!t) return { ok: false, error: '未知平台' };
    const p = t.mode === 'copy' ? t.dir() : t.file();
    try {
      if (t.mode === 'copy') {
        await fsp.mkdir(p, { recursive: true });
        shell.openPath(p);
      } else if (fs.existsSync(p)) {
        shell.showItemInFolder(p);
      } else {
        await fsp.mkdir(path.dirname(p), { recursive: true });
        shell.openPath(path.dirname(p));
      }
      return { ok: true, path: p };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** 复制文本到剪贴板（详情页"复制全文"用） */
  ipcMain.handle('dango:copyText', async (_e, text) => {
    try {
      electronMain.clipboard.writeText(String(text || ''));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/* ------------------------------------------------------------------ 窗口 */

function createWindow() {
  trace('createWindow 进入');
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: '#FFFDF7',
    title: '苏苏 AI超频 · Susu AI Overclock',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false
    }
  });
  trace('BrowserWindow 构造完成');

  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.once('did-finish-load', () => trace('渲染进程 did-finish-load'));
  win.once('ready-to-show', () => trace('ready-to-show（窗口可见）'));

  win.loadFile(path.join(__dirname, '..', 'dist-electron', 'index.html'));
  trace('loadFile 已调用');
}

/** 解析 --root=<path> / --root <path>，方便命令行直接指定根目录 */
function parseRootArg() {
  const argv = process.argv || [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--root=')) return a.slice('--root='.length);
    if (a === '--root' && argv[i + 1] !== undefined) return argv[i + 1];
  }
  return null;
}

function hasCleanFlag() {
  const argv = process.argv || [];
  return argv.some((a) => a === '--clean' || a === '--empty' || a === '-clean' || a === '-empty');
}

async function applyRootArgOnce() {
  if (hasCleanFlag()) {
    const state = await loadState();
    state.root = null;
    state.lastScanAt = null;
    pushActivity(state, 'root', '以纯净空态启动（--clean）');
    await saveState(state);
    return;
  }
  const p = parseRootArg();
  if (p === null) return;
  if (p === '' || p === 'none' || p === 'null') {
    const state = await loadState();
    state.root = null;
    state.lastScanAt = null;
    pushActivity(state, 'root', '重置根目录为空');
    await saveState(state);
    return;
  }
  let st = null;
  try {
    st = await fsp.stat(p);
  } catch {
    return;
  }
  if (!st.isDirectory()) return;
  const state = await loadState();
  if (state.root === p) return;
  state.root = p;
  state.lastScanAt = new Date().toISOString();
  pushActivity(state, 'root', `由启动参数指定根目录：${p}`);
  await saveState(state);
}

app.whenReady().then(async () => {
  trace('app.whenReady 触发');
  await applyRootArgOnce();
  trace('applyRootArgOnce 完成');
  registerIpc();
  trace('registerIpc 完成');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
