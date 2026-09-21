'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertPackAllowed, getSourceNameMatchId, hasQuarantineConsent, QUARANTINED_PACKS } = require('./security-policy.cjs');

// 来源名命中隔离名单时的判定：只有"命中的隔离 id 正是本次请求的 id，且该 id
// 已登记知情同意"才放行。拿 A 包的同意去部署 B 包的来源目录仍然拒绝。
function sourceNameReason(id, name) {
  const matched = getSourceNameMatchId(name);
  if (!matched) return null;
  if (matched === id && hasQuarantineConsent(id)) return null;
  return QUARANTINED_PACKS[matched];
}

function sourceError(code, source, message) {
  const error = new Error(`${message} [来源: ${source}]`);
  error.code = code;
  error.path = source;
  return error;
}

// lstat(source) alone does not expose links in its parents. Inspect from the
// filesystem root down, stopping before traversing a Node-reported link/junction.
function assertNoLinkAncestors(absolute) {
  const ancestors = [];
  for (let current = absolute; ; current = path.dirname(current)) {
    ancestors.push(current);
    if (path.dirname(current) === current) break;
  }
  for (const name of ancestors.reverse()) {
    if (fs.lstatSync(name).isSymbolicLink()) {
      throw sourceError('ERR_PACK_SOURCE_LINK', name, '来源或祖先包含链接或联接点，禁止部署或复制');
    }
  }
}

// Recheck every use, including historical state; never cache a source as trusted.
// Metadata checks are point-in-time, not atomic with a later copy/spawn. They do
// not detect all malware, hard-link aliases or every Windows reparse-point type,
// and do not prevent a concurrently infected host from swapping checked files.
function assertPackSourceAllowed(id, source) {
  assertPackAllowed(id);
  if (typeof source !== 'string' || !source.trim()) throw new Error('包来源路径为空');
  // Lexical normalization must not erase a link/.. component before inspection.
  if (source.split(/[\\/]+/).includes('..')) {
    throw sourceError('ERR_PACK_SOURCE_PARENT', source, '来源含父级跳转，禁止部署或复制');
  }
  const absolute = path.resolve(source);
  assertNoLinkAncestors(absolute);
  for (const name of [absolute, fs.realpathSync(absolute)]) {
    const reason = sourceNameReason(id, name);
    if (reason) throw sourceError('ERR_PACK_SOURCE_QUARANTINED', name, reason);
  }
  const pending = [{ name: absolute, depth: 0 }];
  // A pack organises its content by target product, so a consented pack's own
  // tree legitimately contains sub-directories named after other packs:
  // codex/breaker-tx/skills/packs/anti-gravity/ is a skill catalogue, not the
  // anti-gravity payload. Re-matching every descendant against every quarantined
  // id made that a permanent false positive — consent unlocked the policy gate
  // but the walk still refused codex's own embedded directory, so install stayed
  // dead. Directory names are therefore exempt inside a consented pack's own
  // tree; any matching FILE name still blocks, and reuse of another pack's tree
  // is still rejected by the root check above.
  const consentedOwnTree = hasQuarantineConsent(id);
  let count = 0;
  while (pending.length) {
    const { name, depth } = pending.pop();
    if (++count > 100000 || depth > 64) throw new Error('来源检查超过范围，未确认的来源禁止部署或复制');
    const stat = fs.lstatSync(name);
    // Junctions/symlinks could redirect copies or scripts outside the checked tree.
    if (stat.isSymbolicLink()) throw sourceError('ERR_PACK_SOURCE_LINK', name, '来源包含链接或联接点，禁止部署或复制');
    if (!(consentedOwnTree && depth >= 1 && stat.isDirectory())) {
      const reason = sourceNameReason(id, path.basename(name));
      if (reason) throw sourceError('ERR_PACK_SOURCE_QUARANTINED', name, reason);
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(name)) pending.push({ name: path.join(name, entry), depth: depth + 1 });
    } else if (!stat.isFile()) {
      throw new Error('来源包含非普通文件，禁止部署或复制');
    }
  }
}

// Expected entries may be nested paths. Comparing them with a root-only readdir
// incorrectly reports existing materials/rules and materials/IDENTITY.md missing.
function missingExpectedEntries(source, expected) {
  return expected.filter(entry => {
    const parts = entry.replace(/\\/g, '/').split('/');
    if (path.isAbsolute(entry) || parts.some(part => !part || part === '..' || part === '.')) return true;
    const basename = parts.pop();
    try {
      const names = fs.readdirSync(path.join(source, ...parts));
      const prefix = basename.includes('*') ? basename.split('*')[0] : null;
      return !names.some(name => prefix === null ? name === basename : name.startsWith(prefix));
    } catch {
      return true;
    }
  });
}

module.exports = Object.freeze({ assertPackSourceAllowed, missingExpectedEntries });
