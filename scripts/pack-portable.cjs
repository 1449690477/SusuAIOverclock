'use strict';

const { assertBuildInputsSafe, assertPortableBuilderPatched } = require('./preflight-security.cjs');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
// FIRST: fail before executing electron-builder or touching dependency files.
assertBuildInputsSafe({ root });
assertPortableBuilderPatched(root);

const env = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  // Resolve 7za from the freshly installed 7zip-bin package, never old cache/PATH.
  USE_SYSTEM_7ZA: 'false',
  // Only the freshly installed dependency tools may be resolved by the builder.
  PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH || ''),
};
for (const key of ['CUSTOM_APP_BUILDER_PATH', 'ELECTRON_BUILDER_NSIS_DIR']) delete env[key];

const eb = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
if (!fs.existsSync(eb)) {
  console.error('[pack] missing local electron-builder: ' + eb);
  process.exit(1);
}

const r = spawnSync(process.execPath, [eb, '--win', 'portable', '--x64', '--publish', 'never'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
process.exit(r.status == null ? 1 : r.status);
