/**
 * apply-portable-patch.cjs — 把加速版 portable 模板注入 electron-builder
 *
 * 背景：electron-builder 的 portable 分支硬编码读取
 *   node_modules/app-builder-lib/templates/nsis/portable.nsi
 * 该路径不接受 options.script 覆盖（见 NsisTarget.js:276），
 * 所以只能在打包前把模板换掉。node_modules 被重装会丢失，因此做成构建前置步骤。
 *
 * 用法：node scripts/apply-portable-patch.cjs
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'build', 'portable-fast.nsi');
const TARGET_DIR = path.join(ROOT, 'node_modules', 'app-builder-lib', 'templates', 'nsis');
const TARGET = path.join(TARGET_DIR, 'portable.nsi');
const BACKUP = path.join(TARGET_DIR, 'portable.nsi.orig');
const MARKER = '苏苏 AI超频 · 加速版 portable 启动器';

function restore7za() {
  const destDir = path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64');
  const dest = path.join(destDir, '7za.exe');
  const cache7za = path.join(
    process.env.LOCALAPPDATA || '',
    'electron-builder', 'Cache', '7zip@1.0.0', '7zip-win-x64-a34pt', 'bin', '7za.exe'
  );
  if (!fs.existsSync(cache7za)) {
    console.error('[patch] 找不到 7za.exe 缓存: ' + cache7za);
    process.exit(1);
  }
  fs.mkdirSync(destDir, { recursive: true });
  const cacheSize = fs.statSync(cache7za).size;
  const destOk = fs.existsSync(dest) && fs.statSync(dest).size === cacheSize;
  if (destOk) {
    console.log('[patch] 7za.exe 已就绪 (' + cacheSize + ' bytes)');
    return;
  }
  fs.copyFileSync(cache7za, dest);
  console.log('[patch] 已从 electron-builder 缓存恢复 7za.exe (' + cacheSize + ' bytes)');
}

function main() {
  restore7za();
  if (!fs.existsSync(SRC)) {
    console.error('[patch] 源模板不存在: ' + SRC);
    process.exit(1);
  }
  if (!fs.existsSync(TARGET_DIR)) {
    console.error('[patch] electron-builder 模板目录不存在，请先 npm install');
    process.exit(1);
  }

  const src = fs.readFileSync(SRC, 'utf8');

  // 首次执行：备份原始模板
  if (!fs.existsSync(BACKUP)) {
    const original = fs.readFileSync(TARGET, 'utf8');
    if (original.includes(MARKER)) {
      console.log('[patch] 目标已是加速版，跳过备份');
    } else {
      fs.writeFileSync(BACKUP, original, 'utf8');
      console.log('[patch] 已备份原始模板 -> portable.nsi.orig');
    }
  }

  const current = fs.readFileSync(TARGET, 'utf8');
  if (current.includes(MARKER) && current === src) {
    console.log('[patch] 模板已是最新加速版，无需改动');
    return;
  }

  fs.writeFileSync(TARGET, src, 'utf8');
  console.log('[patch] 已注入加速版 portable 模板 (' + src.length + ' 字节)');
}

main();
