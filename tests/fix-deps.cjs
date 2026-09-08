'use strict';
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const nm = path.join(ROOT, 'node_modules');

function get(p) {
  return new Promise((resolve, reject) => {
    https
      .get(p, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) return get(res.headers.location).then(resolve, reject);
        if (res.statusCode !== 200) return reject(new Error(`${res.statusCode} ${p}`));
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

function parseMissing(msg) {
  const m = msg.match(/node_modules[\\/]([^\\/]+)[\\/](.+?\.[mc]?js)/);
  if (m) return { pkg: m[1], file: m[2].replace(/\\/g, '/') };
  return null;
}

async function fetchPackageVersion(pkg) {
  try {
    return JSON.parse(fs.readFileSync(path.join(nm, pkg, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

async function fix(missing) {
  const ver = await fetchPackageVersion(missing.pkg);
  if (!ver) return false;
  const url = `https://unpkg.com/${missing.pkg}@${ver}/${missing.file}`;
  const buf = await get(url);
  const full = path.join(nm, missing.pkg, ...missing.file.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  process.stdout.write(`  fixed ${missing.pkg}/${missing.file} <- ${url}\n`);
  return true;
}

function runCmd(cmd, args, env) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env, encoding: 'utf8' });
  return r;
}

function extractError(r) {
  const out = (r.stderr || '') + (r.stdout || '');
  return parseMissing(out);
}

async function main() {
  const cmd = process.argv[2] || 'node';
  const args = process.argv.slice(3);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  console.log(`probing: ${cmd} ${args.join(' ')}`);
  for (let i = 0; i < 30; i += 1) {
    const r = runCmd(cmd, args, env);
    if (r.status === 0) {
      console.log('OK');
      return;
    }
    const missing = extractError(r);
    if (!missing) {
      console.log('non-fixable error');
      console.log('stdout:', r.stdout);
      console.log('stderr:', r.stderr);
      return;
    }
    console.log(`[${i}] missing: ${missing.pkg}/${missing.file}`);
    const ok = await fix(missing);
    if (!ok) {
      console.log('cannot fix');
      return;
    }
  }
  console.log('gave up');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});