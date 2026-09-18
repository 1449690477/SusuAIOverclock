import { build } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const log = path.join(root, 'release', 'vite-force-build.log');
const pinned = path.join(here, 'bin', 'esbuild-0.21.5.exe');
const dest = path.join(root, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe');
const live = path.join(os.tmpdir(), 'esbuild-0215-live.exe');

fs.mkdirSync(path.dirname(log), { recursive: true });
if (fs.existsSync(pinned)) {
  fs.copyFileSync(pinned, live);
  fs.copyFileSync(pinned, dest);
  process.env.ESBUILD_BINARY_PATH = live;
}

fs.writeFileSync(
  log,
  `start ${new Date().toISOString()}\nroot=${root}\nesbuild=${process.env.ESBUILD_BINARY_PATH || dest}\n`,
);

const keep = setInterval(() => {}, 250);

try {
  const result = await build({
    configFile: path.join(root, 'vite.config.mjs'),
    root: path.join(root, 'src'),
    logLevel: 'info',
  });
  const keys = result
    ? Array.isArray(result)
      ? `array:${result.length}`
      : Object.keys(result).join(',')
    : 'null';
  fs.appendFileSync(log, `ok ${keys}\n`);
} catch (e) {
  fs.appendFileSync(log, `ERR ${e && e.stack ? e.stack : e}\n`);
  process.exitCode = 1;
} finally {
  clearInterval(keep);
}
