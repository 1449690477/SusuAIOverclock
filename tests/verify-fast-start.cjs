/**
 * verify-fast-start.cjs — 验证加速版 portable 的启动加速效果
 *
 * 计时口径（关键）：从双击 exe 到「主程序进程真正出现」为止。
 *   冷启动 = 需要 7z 解压到缓存，计时包含解压
 *   热启动 = 缓存已就绪，计时只含 NSIS 启动器开销 + Electron 自身启动
 *
 * 进程检测：用 CIM 按 ExecutablePath 匹配（纯 ASCII 路径，规避中文编码问题），
 * 且要求进程确实从缓存目录启动，避免误判 NSIS 启动器自身。
 */

'use strict';

const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// 可用 PORTABLE_EXE 指向新构建产物，默认仍验证 release 下的正式文件名。
const PORTABLE = process.env.PORTABLE_EXE
  ? path.resolve(process.env.PORTABLE_EXE)
  : path.join(__dirname, '..', 'release', 'SusuAIOverclock-1.2.0-portable.exe');
const CACHE = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'SusuAIOverclock-cache');

function killAll() {
  // 按路径杀，避免中文进程名编码问题
  const ps = [
    `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*SusuAIOverclock*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
  ].join('; ');
  try { execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, { stdio: 'ignore' }); } catch {}
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
}

/** 主程序进程是否已从缓存目录启动（返回 PID 或 null） */
function appPidFromCache() {
  try {
    const cmd = `(Get-CimInstance Win32_Process -Filter "Name LIKE '%'" | Where-Object { $_.ExecutablePath -like '*SusuAIOverclock-cache*' } | Select-Object -First 1 -ExpandProperty ProcessId)`;
    const out = execSync(`powershell -NoProfile -NonInteractive -Command "${cmd}"`, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000,
    }).trim();
    const pid = parseInt(out, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch { return null; }
}

function cacheStats() {
  if (!fs.existsSync(CACHE)) return { files: 0, mb: 0, dir: null, marker: false };
  let files = 0, bytes = 0, dir = null, marker = false;
  const walk = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { files++; try { bytes += fs.statSync(p).size; } catch {} }
    }
  };
  for (const v of fs.readdirSync(CACHE)) {
    const dir2 = path.join(CACHE, v);
    try { if (!fs.statSync(dir2).isDirectory()) continue; } catch { continue; }
    dir = v;
    walk(dir2);
    marker = fs.existsSync(path.join(dir2, '.cache-complete'));
  }
  return { files, mb: (bytes / 1048576).toFixed(1), dir, marker };
}

async function run(label) {
  console.log('');
  console.log('--- ' + label + ' ---');
  const t0 = Date.now();
  const child = spawn(PORTABLE, [], { detached: true, stdio: 'ignore' });
  child.unref();

  let readyAt = null;
  while (Date.now() - t0 < 180000) {
    if (appPidFromCache() !== null) {
      readyAt = (Date.now() - t0) / 1000;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const st = cacheStats();
  console.log('  缓存目录: ' + (st.dir ? path.join(CACHE, st.dir) : '(无)'));
  console.log('  缓存内容: ' + st.files + ' 文件 / ' + st.mb + ' MB  完成标记: ' + (st.marker ? '有' : '无'));
  console.log('  ' + (readyAt !== null ? '主进程出现: ' + readyAt.toFixed(1) + 's' : '未在 180s 内出现'));

  return readyAt;
}

(async () => {
  console.log('=== 加速版 portable 启动验证 ===');
  console.log('exe: ' + path.basename(PORTABLE) + '  ' + (fs.statSync(PORTABLE).size / 1048576).toFixed(1) + ' MB');
  console.log('缓存位置: ' + CACHE);

  killAll();
  await new Promise((r) => setTimeout(r, 1500));
  rmrf(CACHE);
  console.log('');
  console.log('[准备] 已清除缓存目录与残留进程');

  const cold = await run('第一次启动（冷启动：7z 解压到缓存）');

  killAll();
  await new Promise((r) => setTimeout(r, 3000));
  const st = cacheStats();
  console.log('');
  console.log('[准备] 缓存状态: ' + st.files + ' 文件 / ' + st.mb + ' MB / 标记 ' + (st.marker ? '有' : '无'));

  const warm = await run('第二次启动（热启动：缓存命中）');

  killAll();

  console.log('');
  console.log('=== 结果对比 ===');
  console.log('  冷启动（首次）: ' + (cold === null ? 'N/A' : cold.toFixed(1) + 's'));
  console.log('  热启动（后续）: ' + (warm === null ? 'N/A' : warm.toFixed(1) + 's'));
  if (cold && warm) console.log('  加速比: ' + (cold / warm).toFixed(1) + 'x');
  console.log('');
  console.log('  对照：原生模板每次启动都走 7z 解压 + CopyFiles 全量复制，实测 ~22s');
  console.log('=== done ===');
})();
