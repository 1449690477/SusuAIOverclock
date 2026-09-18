'use strict';

/**
 * app-builder-bin 5.0.0-alpha.10 在本机对 node-dep-tree / unpack-electron /
 * download-artifact / ksuid 经常 stdout 空串。electron-builder 会把空串当路径用。
 * 本 shim：能从本地 Cache 解析的命令直接回路径；其余转发给原二进制。
 */
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REAL = path.join(__dirname, '..', 'node_modules', 'app-builder-bin', 'win', 'x64', 'app-builder.exe');
const CACHE = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache');
const args = process.argv.slice(2);
const cmd = args[0] || '';

function writeOut(text) {
  process.stdout.write(String(text || ''));
  process.exit(0);
}

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : '';
}

const ARTIFACT_DIRS = {
  'nsis-3.0.4.1': path.join(CACHE, 'nsis', 'nsis-3.0.4.1'),
  'nsis-resources-3.4.1': path.join(CACHE, 'nsis', 'nsis-resources-3.4.1'),
  'winCodeSign-2.6.0': path.join(CACHE, 'winCodeSign', 'winCodeSign-2.6.0'),
};

if (cmd === 'ksuid') {
  writeOut(crypto.randomBytes(20).toString('hex').slice(0, 27));
}

if (cmd === 'download-artifact') {
  const name = argValue('--name');
  const mapped = ARTIFACT_DIRS[name];
  if (mapped && fs.existsSync(mapped)) writeOut(mapped);
}

const forwarded = spawnSync(REAL, args, {
  encoding: 'buffer',
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (forwarded.stderr && forwarded.stderr.length) {
  process.stderr.write(forwarded.stderr);
}
const stdout = forwarded.stdout && forwarded.stdout.length ? forwarded.stdout : Buffer.alloc(0);
if (stdout.length) {
  process.stdout.write(stdout);
  process.exit(forwarded.status == null ? 0 : forwarded.status);
}

if (cmd === 'download-artifact') {
  const name = argValue('--name');
  process.stderr.write('[app-builder-shim] empty download-artifact for ' + name + '\n');
  process.exit(1);
}

process.exit(forwarded.status == null ? 1 : forwarded.status);
