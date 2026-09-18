'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const cacheRoot = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache');
const nsisDir = path.join(cacheRoot, 'nsis', 'nsis-3.0.4.1');
const cache7zaDir = path.join(cacheRoot, '7zip@1.0.0', '7zip-win-x64-a34pt', 'bin');
const cache7za = path.join(cache7zaDir, '7za.exe');
const dest7za = path.join(root, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');

function restore7za() {
  if (!fs.existsSync(cache7za)) {
    console.error('[pack] missing cache 7za: ' + cache7za);
    process.exit(1);
  }
  const cacheSize = fs.statSync(cache7za).size;
  fs.mkdirSync(path.dirname(dest7za), { recursive: true });
  fs.copyFileSync(cache7za, dest7za);
  const destSize = fs.statSync(dest7za).size;
  if (destSize !== cacheSize) {
    console.error('[pack] 7za copy size mismatch ' + destSize + ' != ' + cacheSize);
    process.exit(1);
  }
  console.log('[pack] 7za ready ' + destSize + ' bytes');
}

restore7za();

const env = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  CUSTOM_APP_BUILDER_PATH: path.join(__dirname, 'app-builder-shim.cmd'),
  ELECTRON_BUILDER_NSIS_DIR: nsisDir,
  USE_SYSTEM_7ZA: 'true',
  PATH: cache7zaDir + path.delimiter + (process.env.PATH || ''),
};

const eb = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
if (!fs.existsSync(eb)) {
  console.error('[pack] missing local electron-builder: ' + eb);
  process.exit(1);
}

const r = spawnSync(process.execPath, [eb, '--win', 'portable', '--x64'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
process.exit(r.status == null ? 1 : r.status);
