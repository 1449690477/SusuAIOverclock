'use strict';

/**
 * Read-only, builtin-only known-IOC preflight. No child processes, native
 * modules, network, deletion, process killing, AV exclusions or repair actions.
 * Importing this module does not scan or build; helpers are exported for audit.
 *
 * Evidence: node scripts/preflight-security.cjs --scan <file-or-dir> --json
 * Build gate: node scripts/preflight-security.cjs [--json]
 * Repeated --scan selects ONLY those evidence paths (no build is launched).
 * Build hooks always use the full default scope, never the evidence CLI scope.
 *
 * CLEAN BUILD BOUNDARY: This incident host is for reviewed source edits and
 * read-only evidence only. Build on a newly provisioned, independently trusted
 * host or a newly created clean guest isolated from this host (the user-approved
 * incident boundary). Never build in the infected host OS. Transfer reviewed
 * source, not node_modules, scripts/bin executables,
 * Electron/NSIS/7zip caches, old releases or quarantined packs. Reinstall locked
 * dependencies and verify tool distributions against trusted upstream hashes/
 * signatures there. A missing known IOC is NOT a clean-host attestation. There
 * is no skip/bypass environment variable. A preflight cannot stop reinfection
 * or close filesystem races on a host with an active infector.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const RELEASE_PACK_IDS = Object.freeze(['cursor', 'dsh', 'claude', 'opencode', 'workbuddy', 'workbuddy-ai']);
const QUARANTINED_PACK_IDS = Object.freeze(['codex', 'codex-panghu', 'anti-gravity']);
const BINARY_EXTENSIONS = Object.freeze(['.exe', '.dll', '.pyd', '.node', '.scr', '.com', '.dat']);
const TEXT_SHA256 = 'dd25f3ed5d8024e7712dedb739ba9601a22fa1c088db9fbb10e5e47faa4c9932';
const TEXT_OFFSET = 0x1000;
const TEXT_LENGTH = 0x7f000;
const MALICIOUS_FILE_HASHES = Object.freeze({
  bc29f2022ab3b812e50c8681ff196f090c038b5ab51e37daffac4469a8c2eb2c: 'R.exe',
  '3de6c02f52a661b8f934f59541d0cf297bb489eb2155e346b63c7338e09aeaf8': 'N.exe',
});
const PACK_EXCLUSIONS = Object.freeze([
  '!**/_deprecated-omen-bridge/**',
  '!**/backups/**',
  '!**/evidence/**',
  '!**/__pycache__/**',
  '!**/_quarantine/**',
  '!**/_cli-layer-state.json',
  '!**/_inject-layer-state.json',
  '!**/*.pyc',
]);
const RELEASE_RESOURCE_FILTER = Object.freeze([
  ...RELEASE_PACK_IDS.map(id => `${id}/**`), 'NOTICE.txt', ...PACK_EXCLUSIONS,
]);
const CLEAN_BUILD_GUIDANCE = 'Do not build in the known-infected incident host OS. Use an independently trusted build host or a new clean guest with no shared folders/clipboard (user-approved isolation boundary), reviewed source, freshly installed lockfile dependencies and independently verified Node/Electron/NSIS/7zip distributions. Host malware can still compromise the hypervisor/transfer: this is not equivalent to separate trusted hardware. Do not transfer old executable tools, node_modules, caches, releases or quarantined packs. No bypass flag exists; an IOC-negative scan is not permission to build in the infected host OS.';
const LIMITATION = 'Only the listed known IOCs are checked; this is not an antivirus verdict, signature verification, or a clean-host attestation. Archives are not unpacked and sampled files are never executed.';
// These are the only unconsumed platform trees in the audited Windows signing
// cache layout. Do not generalize to directory basenames or other tool versions.
const WINDOWS_CACHE_EXCLUDED_TREES = Object.freeze([
  Object.freeze({ relativePath: 'winCodeSign/winCodeSign-2.6.0/darwin', reason: 'macOS signing tools/libraries are not consumed by this Windows build' }),
  Object.freeze({ relativePath: 'winCodeSign/winCodeSign-2.6.0/linux', reason: 'Linux signing tools/libraries are not consumed by this Windows build' }),
]);
const WINDOWS_CACHE_LIMITATION = 'Default unsigned Windows-target builder-cache scope (Windows or Linux cross-build) omits only winCodeSign/winCodeSign-2.6.0/darwin and winCodeSign/winCodeSign-2.6.0/linux beneath each configured builder cache. These excluded trees are NOT inspected or cleared. Other cache entries remain in scope; explicit --scan and directly selected tool overrides have no platform exclusions.';

function checkedRange(offset, length, size) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > size || length > size - offset) {
    throw new Error(`Out-of-bounds binary range: offset=${offset}, length=${length}, size=${size}`);
  }
}

function peSections(read, size) {
  if (size < 2 || read(0, 2).toString('ascii') !== 'MZ') return [];
  if (size < 64) throw new Error('Truncated MZ header');
  const peOffset = read(0, 64).readUInt32LE(0x3c);
  if (peOffset < 64) throw new Error('Invalid PE header offset');
  checkedRange(peOffset, 24, size);
  const coff = read(peOffset, 24);
  if (!coff.subarray(0, 4).equals(Buffer.from([0x50, 0x45, 0, 0]))) {
    throw new Error('MZ file has no valid PE signature; inspection incomplete');
  }
  const count = coff.readUInt16LE(6);
  const optionalSize = coff.readUInt16LE(20);
  if (count < 1 || count > 96 || optionalSize < 2) throw new Error('Invalid PE section count/optional header');
  checkedRange(peOffset + 24, optionalSize, size);
  const magic = read(peOffset + 24, 2).readUInt16LE(0);
  if (magic !== 0x10b && magic !== 0x20b && magic !== 0x107) throw new Error('Unsupported PE optional header');
  const tableOffset = peOffset + 24 + optionalSize;
  checkedRange(tableOffset, count * 40, size);
  const table = read(tableOffset, count * 40);
  const sections = [];
  for (let i = 0; i < count; i++) {
    const section = table.subarray(i * 40, (i + 1) * 40);
    const name = section.subarray(0, 8).toString('ascii').replace(/\0.*$/, '');
    const virtualSize = section.readUInt32LE(8);
    const rawSize = section.readUInt32LE(16);
    const rawOffset = section.readUInt32LE(20);
    if (rawSize) checkedRange(rawOffset, rawSize, size);
    sections.push({ name, rawOffset, rawSize, virtualSize });
  }
  return sections;
}

function parsePESections(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('Expected a Buffer');
  return peSections((offset, length) => {
    checkedRange(offset, length, buffer.length);
    return buffer.subarray(offset, offset + length);
  }, buffer.length);
}

function inspectBinary(size, read, hashRange, filePath) {
  const result = { path: filePath, size, sha256: hashRange(0, size), sections: [], findings: [], errors: [] };
  if (size >= 20) {
    const header = read(0, 20);
    result.format = header.subarray(0, 2).toString('ascii') === 'MZ' ? 'pe' :
      header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && header[4] === 2 && header[5] === 1 && header.readUInt16LE(18) === 62 ? 'elf64-x64' : 'other';
  }
  const knownFile = MALICIOUS_FILE_HASHES[result.sha256];
  if (knownFile) result.findings.push({ kind: 'full-file-sha256', knownFile, sha256: result.sha256 });
  // Check the known prepender's raw range even if it hides/damages PE headers.
  if (size >= TEXT_OFFSET + TEXT_LENGTH) {
    const sha256 = hashRange(TEXT_OFFSET, TEXT_LENGTH);
    if (sha256 === TEXT_SHA256) result.findings.push({ kind: 'fixed-text-sha256', offset: TEXT_OFFSET, length: TEXT_LENGTH, sha256 });
  }
  try {
    result.sections = peSections(read, size);
    for (const section of result.sections) {
      if (section.name !== '.text' || !section.rawSize) continue;
      // Full raw section, unpadded virtual bytes, and known-length prefix cover
      // relocated .text and additional alignment padding/extended raw sections.
      const lengths = new Set([section.rawSize]);
      if (section.virtualSize > 0 && section.virtualSize <= section.rawSize) lengths.add(section.virtualSize);
      if (section.rawSize >= TEXT_LENGTH) lengths.add(TEXT_LENGTH);
      for (const length of lengths) {
        const sha256 = hashRange(section.rawOffset, length);
        if (sha256 === TEXT_SHA256) result.findings.push({ kind: 'pe-text-sha256', section: '.text', offset: section.rawOffset, length, sha256 });
      }
    }
  } catch (error) {
    // Keep hash findings even when the PE is malformed; malformed PE is itself
    // an inspection error and therefore blocks the build.
    result.errors.push({ code: 'PE_INSPECTION_ERROR', message: error.message });
  }
  return result;
}

function scanBuffer(buffer, filePath = '<buffer>') {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('Expected a Buffer');
  const read = (offset, length) => {
    checkedRange(offset, length, buffer.length);
    return buffer.subarray(offset, offset + length);
  };
  return inspectBinary(buffer.length, read, (offset, length) => crypto.createHash('sha256').update(read(offset, length)).digest('hex'), filePath);
}

function normalizedPath(value) {
  let normalized = path.normalize(value);
  if (process.platform === 'win32') {
    normalized = normalized.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '');
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

function rejectLink(entry, stat) {
  // lstat identifies Windows junctions/symlinks without following them. Resolve
  // only after that check, rejecting other canonical redirects/reparse aliases.
  if (stat.isSymbolicLink()) throw new Error(`Symlink/junction/reparse traversal rejected: ${entry}`);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error(`Non-regular build input rejected: ${entry}`);
  const real = fs.realpathSync.native(entry);
  if (normalizedPath(real) !== normalizedPath(entry)) throw new Error(`Redirected/reparse build input rejected: ${entry} -> ${real}`);
}

function assertNoLinks(input) {
  const absolute = path.resolve(input);
  const anchor = path.parse(absolute).root;
  if (process.platform === 'win32' && (anchor.startsWith('\\\\') || absolute.slice(anchor.length).includes(':'))) {
    throw new Error(`Device/UNC/alternate-stream path rejected; use local build inputs: ${absolute}`);
  }
  let entry = anchor;
  let stat = fs.lstatSync(entry);
  rejectLink(entry, stat);
  for (const component of absolute.slice(anchor.length).split(path.sep).filter(Boolean)) {
    entry = path.join(entry, component);
    stat = fs.lstatSync(entry);
    rejectLink(entry, stat);
  }
  return stat;
}

function sameSnapshot(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

function scanFile(filename) {
  const absolute = path.resolve(filename);
  const before = assertNoLinks(absolute);
  if (!before.isFile()) throw new Error(`Expected a regular file: ${absolute}`);
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || !sameSnapshot(before, opened)) throw new Error(`File changed before inspection: ${absolute}`);
    const read = (offset, length) => {
      checkedRange(offset, length, opened.size);
      const buffer = Buffer.alloc(length);
      let total = 0;
      while (total < length) {
        const n = fs.readSync(fd, buffer, total, length - total, offset + total);
        if (!n) throw new Error(`Unexpected EOF: ${absolute}`);
        total += n;
      }
      return buffer;
    };
    const hashRange = (offset, length) => {
      checkedRange(offset, length, opened.size);
      const hash = crypto.createHash('sha256');
      const buffer = Buffer.alloc(Math.min(1024 * 1024, length));
      let consumed = 0;
      while (consumed < length) {
        const n = fs.readSync(fd, buffer, 0, Math.min(buffer.length, length - consumed), offset + consumed);
        if (!n) throw new Error(`Unexpected EOF while hashing: ${absolute}`);
        hash.update(buffer.subarray(0, n));
        consumed += n;
      }
      return hash.digest('hex');
    };
    const result = inspectBinary(opened.size, read, hashRange, absolute);
    if (!sameSnapshot(opened, fs.fstatSync(fd)) || !sameSnapshot(opened, assertNoLinks(absolute))) {
      throw new Error(`File changed during inspection: ${absolute}`);
    }
    return result;
  } finally {
    fs.closeSync(fd);
  }
}

function isExcludedPackPath(relative) {
  const parts = relative.split(/[\\/]/);
  return parts.some(part => ['_deprecated-omen-bridge', 'backups', 'evidence', '__pycache__', '_quarantine', '_cli-layer-state.json', '_inject-layer-state.json'].includes(part)) || relative.endsWith('.pyc');
}

function getExcludedPlatformTree(filename, target) {
  const absolute = normalizedPath(path.resolve(filename));
  for (const tree of target.excludedPlatformTrees || []) {
    const excluded = normalizedPath(path.resolve(target.path, tree.relativePath));
    if (absolute === excluded || absolute.startsWith(excluded + path.sep)) return tree;
  }
  return null;
}

function getDefaultTargets(root = ROOT, env = process.env) {
  root = path.resolve(root);
  const targets = [];
  const add = (filename, kind, optional = false, pack = false) => {
    const target = { path: path.resolve(filename), kind, optional, pack };
    targets.push(target);
    return target;
  };
  const addCache = (filename, kind, optional = false) => {
    const target = add(filename, kind, optional);
    if (['win32', 'linux'].includes(process.platform)) target.excludedPlatformTrees = WINDOWS_CACHE_EXCLUDED_TREES;
  };
  for (const dir of ['node_modules', 'scripts', 'electron', 'src', 'build']) add(path.join(root, dir), 'build-input');
  add(path.join(root, 'dist-electron'), 'generated-input', true);
  for (const filename of ['package.json', 'package-lock.json']) add(path.join(root, filename), 'build-metadata');
  for (const id of RELEASE_PACK_IDS) add(path.join(root, 'packed-packs', id), 'release-pack', false, true);
  add(path.join(root, 'packed-packs', 'NOTICE.txt'), 'release-notice');
  add(process.execPath, 'node-runtime');
  // Whole dependency tree is scanned above; these must also actually exist.
  if (process.platform === 'win32') {
    for (const filename of ['7zip-bin/win/x64/7za.exe', 'app-builder-bin/win/x64/app-builder.exe', 'electron/dist/electron.exe']) {
      add(path.join(root, 'node_modules', filename), 'required-build-tool').requiredFormat = 'pe';
    }
  }
  if (process.platform === 'linux') {
    for (const filename of ['7zip-bin/linux/x64/7za', 'app-builder-bin/linux/x64/app-builder', '@esbuild/linux-x64/bin/esbuild', 'electron/dist/electron.exe']) {
      add(path.join(root, 'node_modules', filename), 'required-build-tool').requiredFormat = filename.endsWith('.exe') ? 'pe' : 'elf64-x64';
    }
  }
  // Never reuse host caches. Linux bootstrap passes a new guest-local cache.
  if (env.LOCALAPPDATA) addCache(path.join(env.LOCALAPPDATA, 'electron-builder', 'Cache'), 'builder-cache', true);
  if (env.ELECTRON_BUILDER_CACHE) addCache(env.ELECTRON_BUILDER_CACHE, 'builder-cache-override');
  for (const key of ['ELECTRON_BUILDER_NSIS_DIR', 'CUSTOM_APP_BUILDER_PATH', 'ESBUILD_BINARY_PATH', 'ELECTRON_OVERRIDE_DIST_PATH', 'ELECTRON_CACHE', 'SIGNTOOL_PATH']) {
    if (env[key]) add(env[key], key);
  }
  const tempDirs = new Set([env.TEMP, env.TMP, os.tmpdir(), env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Temp'), env.SystemRoot && path.join(env.SystemRoot, 'Temp')].filter(Boolean).map(dir => path.resolve(dir)));
  for (const dir of tempDirs) {
    for (const name of ['R.exe', 'N.exe', 'HD_X.dat']) add(path.join(dir, name), 'host-ioc', true);
  }
  return targets;
}

function createReport(scope) {
  return {
    schemaVersion: 1, scope, status: 'blocked', ok: false,
    limitation: LIMITATION, cleanBuildGuidance: CLEAN_BUILD_GUIDANCE,
    targets: [], filesScanned: 0, samples: [], findings: [], errors: [], excluded: [], exclusionDetails: [], absentOptional: [],
  };
}

function finishReport(report) {
  report.ok = report.findings.length === 0 && report.errors.length === 0;
  report.status = report.ok ? 'known-ioc-not-detected' : 'blocked';
  return report;
}

function scanTargets(targets, report = createReport('explicit-evidence')) {
  const seen = new Set();
  const recordError = (filename, error) => report.errors.push({ path: filename, code: error.code || 'INSPECTION_ERROR', message: error.message });
  function visit(filename, target, stat) {
    try {
      if (target.pack && isExcludedPackPath(path.relative(target.path, filename))) {
        report.excluded.push(filename);
        return;
      }
      const excludedTree = getExcludedPlatformTree(filename, target);
      if (excludedTree) {
        // Do not enter or resolve links in a tree that is not a Windows input.
        // Full evidence scans never receive these cache-only descriptors.
        report.excluded.push(filename);
        report.exclusionDetails.push({ path: filename, kind: 'unconsumed-platform-cache-tree', cacheRoot: target.path, ...excludedTree });
        return;
      }
      stat = stat || fs.lstatSync(filename);
      rejectLink(filename, stat);
      // A stricter overlapping target must not reuse a scoped-cache traversal.
      const key = `${normalizedPath(filename)}|${target.pack ? 'pack' : 'full'}|${JSON.stringify(target.excludedPlatformTrees || [])}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (stat.isDirectory()) {
        for (const name of fs.readdirSync(filename).sort()) visit(path.join(filename, name), target);
        if (!sameSnapshot(stat, fs.lstatSync(filename))) throw new Error(`Directory changed during inspection: ${filename}`);
      } else if (BINARY_EXTENSIONS.includes(path.extname(filename).toLowerCase()) || ['required-build-tool', 'node-runtime'].includes(target.kind)) {
        const result = scanFile(filename);
        if (target.requiredFormat && result.format !== target.requiredFormat) {
          result.errors.push({ code: 'BUILD_TOOL_PLATFORM_MISMATCH', message: `Expected ${target.requiredFormat} build tool, found ${result.format || 'unknown'}` });
        }
        report.filesScanned++;
        report.samples.push(result);
        for (const finding of result.findings) report.findings.push({ path: filename, ...finding });
        for (const error of result.errors) report.errors.push({ path: filename, ...error });
      }
    } catch (error) {
      recordError(filename, error);
    }
  }
  for (const raw of targets) {
    const target = typeof raw === 'string' ? { path: path.resolve(raw), kind: 'explicit-evidence' } : { ...raw, path: path.resolve(raw.path) };
    report.targets.push(target);
    if (target.excludedPlatformTrees?.length && !report.limitation.includes(WINDOWS_CACHE_LIMITATION)) {
      report.limitation += ` ${WINDOWS_CACHE_LIMITATION}`;
    }
    try {
      const stat = assertNoLinks(target.path);
      if ((target.kind === 'host-ioc' || target.kind === 'required-build-tool') && !stat.isFile()) throw new Error(`Expected file at ${target.kind} location: ${target.path}`);
      visit(target.path, target, stat);
    } catch (error) {
      // Only intentionally optional, absent roots/host IOCs may be skipped.
      // Access errors, broken links and anything lost mid-walk fail closed.
      if (target.optional && error.code === 'ENOENT') report.absentOptional.push(target.path);
      else recordError(target.path, error);
    }
  }
  return finishReport(report);
}

function scanPaths(paths) {
  if (!Array.isArray(paths) || !paths.length) throw new TypeError('Supply at least one evidence path');
  return scanTargets(paths);
}

function validateBuildPolicy(root, report) {
  const readJson = filename => {
    const stat = assertNoLinks(filename);
    if (!stat.isFile()) throw new Error(`Expected metadata file: ${filename}`);
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
  };
  const pkg = readJson(path.join(root, 'package.json'));
  const lock = readJson(path.join(root, 'package-lock.json'));
  if (pkg.version !== '1.5.6' || lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) throw new Error('Release package/lock versions must all be 1.5.6');
  if (pkg.devDependencies?.electron !== '44.4.3' || lock.packages?.['']?.devDependencies?.electron !== '44.4.3' || lock.packages?.['node_modules/electron']?.version !== '44.4.3') throw new Error('Final supported runtime must be pinned to official Electron 44.4.3 in package and lock');
  const resources = pkg.build?.extraResources;
  const packs = Array.isArray(resources) ? resources.filter(item => item && item.from === 'packed-packs') : [];
  if (packs.length !== 1 || packs[0].to !== 'packs' || JSON.stringify(packs[0].filter) !== JSON.stringify(RELEASE_RESOURCE_FILTER)) {
    throw new Error('packed-packs resource filter must exactly match the six-pack release allowlist and exclusions');
  }
  if (pkg.build?.nsis?.packElevateHelper !== false) throw new Error('The unused elevate helper must remain disabled');
  if (pkg.build?.beforePack !== './scripts/before-build.cjs' || pkg.build?.beforeBuild || pkg.build?.npmRebuild !== false) throw new Error('beforePack security gate and npmRebuild:false are mandatory');
  // Shared release policy is mandatory. Never accept a missing guard as a
  // reason to proceed with packaging.
  const policyFile = path.join(root, 'electron', 'security-policy.cjs');
  const policyStat = assertNoLinks(policyFile);
  report.policySource = policyFile;
  {
    if (!policyStat.isFile()) throw new Error('Shared security policy must be a regular file');
    const policy = require(policyFile);
    const sameIds = (actual, expected) => Array.isArray(actual) && actual.length === expected.length && new Set(actual).size === expected.length && expected.every(id => actual.includes(id));
    if (!sameIds(policy.RELEASE_PACK_IDS, RELEASE_PACK_IDS)) throw new Error('Shared RELEASE_PACK_IDS disagrees with the pinned resource allowlist');
    const quarantined = policy.QUARANTINED_PACKS;
    const ids = Array.isArray(quarantined) ? quarantined.map(item => typeof item === 'string' ? item : item.id) : quarantined && typeof quarantined === 'object' ? Object.keys(quarantined) : [];
    if (!sameIds(ids, QUARANTINED_PACK_IDS)) throw new Error('Shared QUARANTINED_PACKS disagrees with the quarantined release entries');
  }
}

function runPreflight({ root = ROOT } = {}) {
  root = path.resolve(root);
  const report = createReport('default-build-inputs-and-host-iocs');
  try { validateBuildPolicy(root, report); } catch (error) {
    report.errors.push({ path: root, code: 'BUILD_POLICY_ERROR', message: error.message });
  }
  if (process.env.USE_SYSTEM_7ZA === 'true') report.errors.push({ code: 'UNSCOPED_BUILD_TOOL', message: 'USE_SYSTEM_7ZA=true is disallowed; use the freshly installed, verified 7zip-bin dependency on the clean host.' });
  for (const key of ['CUSTOM_APP_BUILDER_PATH', 'ELECTRON_BUILDER_NSIS_DIR']) {
    if (process.env[key]) report.errors.push({ code: 'UNSCOPED_BUILD_TOOL', message: `${key} is disallowed; use the fresh normal builder and checksum-verified downloads.` });
  }
  if (process.platform === 'linux' && !process.env.ELECTRON_BUILDER_CACHE) report.errors.push({ code: 'UNSCOPED_BUILD_CACHE', message: 'Linux cross-build requires an explicit guest-local ELECTRON_BUILDER_CACHE.' });
  try { scanTargets(getDefaultTargets(root), report); } catch (error) {
    report.errors.push({ path: root, code: 'PREFLIGHT_ERROR', message: error.message });
  }
  return finishReport(report);
}

function formatReport(report) {
  const lines = [`[security] ${report.status}; binaries scanned=${report.filesScanned}; findings=${report.findings.length}; errors=${report.errors.length}`];
  for (const finding of report.findings) lines.push(`[security] IOC ${finding.path}: ${finding.kind} ${finding.sha256}`);
  for (const error of report.errors) lines.push(`[security] ERROR ${error.path || ''}: ${error.message}`);
  for (const exclusion of report.exclusionDetails || []) lines.push(`[security] EXCLUDED (not inspected): ${exclusion.path}: ${exclusion.reason}`);
  lines.push(`[security] ${report.limitation}`, `[security] ${report.cleanBuildGuidance}`);
  return lines.join('\n');
}

function assertBuildInputsSafe(options) {
  const report = runPreflight(options);
  if (!report.ok) {
    const error = new Error(formatReport(report));
    error.code = 'SECURITY_PREFLIGHT_BLOCKED';
    error.report = report;
    throw error;
  }
  console.log(formatReport(report));
  return report;
}

function assertPortableBuilderPatched(root = ROOT) {
  const filename = path.join(root, 'node_modules', 'app-builder-lib', 'out', 'targets', 'nsis', 'NsisTarget.js');
  const stat = assertNoLinks(filename);
  if (!stat.isFile()) throw new Error(`Expected builder source file: ${filename}`);
  const source = fs.readFileSync(filename, 'utf8');
  if (!/targetName === "portable"\r?\n\s*\? \{ packElevateHelper: false \} \/\* dango: portable needs no elevate helper \*\//.test(source)) {
    throw new Error('Portable elevate-helper guard missing. On the clean build host, run the preflight-gated patch:portable step against freshly installed dependencies before invoking the builder.');
  }
}

function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  let report;
  try {
    const scans = [];
    let help = false;
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--json') continue;
      if (argv[i] === '--help') { help = true; continue; }
      if (argv[i] === '--scan' && argv[i + 1] && !argv[i + 1].startsWith('--')) { scans.push(argv[++i]); continue; }
      throw new Error(`Unknown/incomplete argument: ${argv[i]}`);
    }
    if (help) {
      const usage = 'node scripts/preflight-security.cjs [--scan <path> ...] [--json]';
      process.stdout.write(json ? JSON.stringify({ usage, limitation: LIMITATION, cleanBuildGuidance: CLEAN_BUILD_GUIDANCE }) + '\n' : `${usage}\n${LIMITATION}\n${CLEAN_BUILD_GUIDANCE}\n`);
      return 0;
    }
    report = scans.length ? scanPaths(scans) : runPreflight();
  } catch (error) {
    report = createReport('cli-error');
    report.errors.push({ code: error.code || 'CLI_ERROR', message: error.message });
    finishReport(report);
  }
  process.stdout.write(json ? JSON.stringify(report, null, 2) + '\n' : formatReport(report) + '\n');
  return report.ok ? 0 : 1;
}

module.exports = {
  RELEASE_PACK_IDS, QUARANTINED_PACK_IDS, RELEASE_RESOURCE_FILTER, PACK_EXCLUSIONS,
  BINARY_EXTENSIONS, TEXT_SHA256, TEXT_OFFSET, TEXT_LENGTH, MALICIOUS_FILE_HASHES,
  CLEAN_BUILD_GUIDANCE, LIMITATION, parsePESections, scanBuffer, scanFile,
  WINDOWS_CACHE_EXCLUDED_TREES, WINDOWS_CACHE_LIMITATION, getExcludedPlatformTree,
  assertNoLinks, isExcludedPackPath, getDefaultTargets, scanTargets, scanPaths,
  runPreflight, assertBuildInputsSafe, assertPortableBuilderPatched, formatReport, main,
};

if (require.main === module) process.exitCode = main();
