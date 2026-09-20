'use strict';

// Reversible PROJECT-ONLY evidence quarantine. Default is a dry run.
// No process control, system/registry changes, network, deletion or execution.
// Each item is rescanned and matched to the recorded SHA-256 before an atomic
// same-volume move. Originals are never reconstructed from infected binaries.
const fs = require('node:fs');
const path = require('node:path');
const scanner = require('./preflight-security.cjs');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const files = args.filter(arg => arg !== '--apply');
if (files.length !== 1 || files[0].startsWith('--')) {
  throw new Error('Usage: node scripts/quarantine-known-infection.cjs <audit-report.json> [--apply]');
}
const input = path.resolve(files[0]);
scanner.assertNoLinks(input);
const audit = JSON.parse(fs.readFileSync(input, 'utf8'));
if (audit.schemaVersion !== 1 || !Array.isArray(audit.inventory?.samples)) throw new Error('Unsupported evidence schema');
const allowedRoots = new Set(['node_modules', 'packed-packs', 'release', 'release-final', 'release-next']);
const seen = new Set();
const items = audit.inventory.samples.filter(sample => sample.findings?.length).map(sample => {
  const original = path.resolve(sample.path);
  const relative = path.relative(root, original);
  if (path.isAbsolute(relative) || relative.startsWith('..') || !allowedRoots.has(relative.split(path.sep)[0])) {
    throw new Error(`Refusing a file outside the fixed project scope: ${original}`);
  }
  const key = process.platform === 'win32' ? original.toLowerCase() : original;
  if (seen.has(key)) throw new Error(`Duplicate evidence path: ${original}`);
  seen.add(key);
  if (!/^[0-9a-f]{64}$/.test(sample.sha256)) throw new Error('Invalid recorded SHA-256');
  const current = scanner.scanFile(original);
  if (!current.findings.length || current.sha256 !== sample.sha256 || current.errors.length) {
    throw new Error(`Evidence changed or cannot be confirmed; not moving: ${original}`);
  }
  return { original, relative, sha256: current.sha256, size: current.size, state: 'planned' };
});
if (!items.length) throw new Error('No confirmed project infections in the report');
console.log(`Confirmed project files: ${items.length}; mode=${apply ? 'apply' : 'dry-run'}`);
for (const item of items) console.log(`${item.relative} | ${item.sha256}`);
if (!apply) process.exit(0);

// All planned source files validated before the first move. A crash leaves the
// journal and opaque .quarantined files available for manual forensic recovery.
const base = path.join(root, '.security-quarantine-1.5.5');
scanner.assertNoLinks(root);
try { fs.mkdirSync(base); } catch (error) { if (error.code !== 'EEXIST') throw error; }
if (!scanner.assertNoLinks(base).isDirectory()) throw new Error('Invalid quarantine directory');
const directory = path.join(base, `${Date.now()}-${process.pid}`);
fs.mkdirSync(directory);
scanner.assertNoLinks(directory);
const journalPath = path.join(directory, 'manifest.jsonl');
const journal = fs.openSync(journalPath, 'wx');
const record = value => {
  fs.writeSync(journal, JSON.stringify(value) + '\n');
  fs.fsyncSync(journal);
};
const summary = { schemaVersion: 1, sourceReport: input, startedAt: new Date().toISOString(), hostCleaned: false, items };
try {
  record({ ...summary, items: undefined, kind: 'start', count: items.length });
  for (const [index, item] of items.entries()) {
    const current = scanner.scanFile(item.original);
    if (!current.findings.length || current.errors.length || current.sha256 !== item.sha256) {
      throw new Error(`Source changed before move: ${item.original}`);
    }
    item.quarantinePath = path.join(directory, `${index + 1}-${item.sha256}.quarantined`);
    record({ kind: 'move-intent', ...item });
    fs.renameSync(item.original, item.quarantinePath);
    item.state = 'moved';
    record({ kind: 'moved', ...item });
    const stored = scanner.scanFile(item.quarantinePath);
    if (stored.sha256 !== item.sha256 || stored.errors.length || !stored.findings.length) {
      throw new Error(`Quarantined evidence changed: ${item.quarantinePath}`);
    }
    item.state = 'quarantined-and-hash-verified';
    record({ kind: 'verified', ...item });
  }
} catch (error) {
  summary.error = error.message;
  record({ kind: 'error', message: error.message });
  process.exitCode = 1;
} finally {
  fs.closeSync(journal);
  summary.finishedAt = new Date().toISOString();
  summary.moved = items.filter(item => item.state === 'quarantined-and-hash-verified').length;
  fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx', encoding: 'utf8' });
  console.log(`Quarantined and hash-verified: ${summary.moved}/${items.length}`);
  console.log(`Evidence directory: ${directory}`);
  if (summary.error) console.error(summary.error);
  console.log('Project-only quarantine is not host disinfection. Do not restore or execute these samples.');
}
