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

const { assertBuildInputsSafe } = require('./preflight-security.cjs');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'build', 'portable-fast.nsi');
const TARGET_DIR = path.join(ROOT, 'node_modules', 'app-builder-lib', 'templates', 'nsis');
const TARGET = path.join(TARGET_DIR, 'portable.nsi');
const BACKUP = path.join(TARGET_DIR, 'portable.nsi.orig');
const MARKER = '苏苏 AI超频 · 加速版 portable 启动器';

function disablePortableElevateHelper() {
  // electron-builder 25.x ignores config.nsis for portable; its schema also
  // rejects portable.packElevateHelper. Patch only the known constructor arm.
  // The portable launcher runs as the user and has no elevated updater.
  const target = path.join(ROOT, 'node_modules', 'app-builder-lib', 'out', 'targets', 'nsis', 'NsisTarget.js');
  const current = fs.readFileSync(target, 'utf8');
  const original = /(targetName === "portable"\r?\n\s*)\? Object\.create\(null\)/g;
  const replacement = '$1? { packElevateHelper: false } /* dango: portable needs no elevate helper */';
  const patchedArm = /targetName === "portable"\r?\n\s*\? \{ packElevateHelper: false \} \/\* dango: portable needs no elevate helper \*\//;
  if (patchedArm.test(current)) return;
  if ((current.match(original) || []).length !== 1) {
    throw new Error('[patch] Unrecognized NsisTarget.js; review freshly installed electron-builder on a clean host. Do not restore cached binaries.');
  }
  fs.writeFileSync(target, current.replace(original, replacement), 'utf8');
  console.log('[patch] portable elevate helper disabled (guarded builder compatibility patch)');
}

function main() {
  // FIRST: no template/dependency writes until the complete preflight succeeds.
  assertBuildInputsSafe({ root: ROOT });
  // 7za must come from freshly installed, independently verified dependencies
  // on the clean build host. Never copy an executable from this host's cache.
  disablePortableElevateHelper();
  if (!fs.existsSync(SRC)) {
    console.error('[patch] 源模板不存在: ' + SRC);
    process.exit(1);
  }
  if (!fs.existsSync(TARGET_DIR)) {
    console.error('[patch] electron-builder 模板目录不存在；请在全新可信构建机按锁文件重新安装并核验依赖，不要在已感染主机安装或构建');
    process.exit(1);
  }

  const template = fs.readFileSync(SRC, 'utf8');
  // The application version comes from package.json; ${VERSION} is substituted
  // by NSIS at compile time. A runtime-specific key prevents a prior Electron33
  // cache from silently defeating this EOL update. Only the launcher cache
  // identity changes — never official Electron bytes or any packaged content.
  const oldCacheKey = 'StrCpy $cacheDir "$cacheParent\\${VERSION}"';
  const newCacheKey = 'StrCpy $cacheDir "$cacheParent\\${VERSION}-electron44.4.3"';
  if (template.split(oldCacheKey).length !== 2) throw new Error('[patch] Unrecognized portable cache arm; review template before packaging');
  const src = template.replace(oldCacheKey, newCacheKey);

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
