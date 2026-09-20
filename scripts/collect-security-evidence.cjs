'use strict';

// Read-only sampling; writes only a new JSON evidence report into release/.
// Never executes sampled files, loads third-party packages or repairs the host.
const fs = require('node:fs');
const path = require('node:path');
const scanner = require('./preflight-security.cjs');
const { RELEASE_PACK_IDS } = require('../electron/security-policy.cjs');
const { assertPackSourceAllowed } = require('../electron/pack-source-policy.cjs');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'release');
if (!scanner.assertNoLinks(outputDir).isDirectory()) throw new Error('Expected release directory');
const startedAt = new Date().toISOString();
const inventory = scanner.scanPaths(['node_modules', 'packed-packs', 'release', 'release-final', 'release-next'].map(p => path.join(root, p)));
const preflight = scanner.runPreflight({ root });
const sourceChecks = RELEASE_PACK_IDS.map(id => {
  try {
    assertPackSourceAllowed(id, path.join(root, 'packed-packs', id));
    return { id, result: 'known-source-quarantine-check-passed', antivirusVerdict: 'not-assessed' };
  } catch (error) {
    return { id, result: 'blocked', error: error.message };
  }
});
const report = {
  schemaVersion: 1, startedAt, finishedAt: new Date().toISOString(),
  releaseVersion: '1.5.5', executableBuilt: false, hostCleaned: false,
  limitation: scanner.LIMITATION, inventory, preflight, sourceChecks,
};
const filename = path.join(outputDir, `security-audit-1.5.5-${Date.now()}.json`);
fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', encoding: 'utf8' });
for (const [label, result] of [['inventory', inventory], ['build-preflight', preflight]]) {
  console.log(`${label}: status=${result.status}; binaries=${result.filesScanned}; affectedFiles=${new Set(result.findings.map(f => f.path)).size}; errors=${result.errors.length}`);
  for (const error of result.errors) console.log(`  ERROR ${error.path || ''}: ${error.message}`);
}
for (const result of sourceChecks) console.log(`source ${result.id}: ${result.result}${result.error ? ': ' + result.error : ''}`);
console.log(`Evidence: ${filename}`);
process.exitCode = preflight.ok && inventory.ok && sourceChecks.every(r => r.result !== 'blocked') ? 0 : 1;
