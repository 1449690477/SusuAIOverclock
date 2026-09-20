'use strict';

// Verify the guest-produced archive in memory. NEVER write or execute its EXE
// on the incident host. Hashes are the values independently recorded in guest.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { scanBuffer, assertNoLinks } = require('./preflight-security.cjs');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'release', 'SusuAIOverclock-1.5.5-portable-electron44.4.3-isolated.zip');
const expectedZip = '81d0b280ffcc0765a139bab710f64cc794cdb5b6bb84ad4c1069cdf1bc01d883';
const expectedExe = '089657d058dd647ae350be8936de3d536c127b66ac1ecd728067ff565887eb7b';
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
assertNoLinks(filename);
const zip = fs.readFileSync(filename);
if (digest(zip) !== expectedZip) throw new Error('Delivery archive differs from guest SHA-256');
let end = -1;
for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
  if (zip.readUInt32LE(i) === 0x06054b50 && i + 22 + zip.readUInt16LE(i + 20) === zip.length) { end = i; break; }
}
if (end < 0 || zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6)) throw new Error('Unsupported ZIP layout');
const count = zip.readUInt16LE(end + 10);
let cursor = zip.readUInt32LE(end + 16);
const centralEnd = cursor + zip.readUInt32LE(end + 12);
if (centralEnd !== end || count === 65535) throw new Error('Invalid/ZIP64 central directory');
const entries = [];
for (let index = 0; index < count; index++) {
  if (cursor + 46 > centralEnd || zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid central directory entry');
  const flags = zip.readUInt16LE(cursor + 8);
  const method = zip.readUInt16LE(cursor + 10);
  const compressed = zip.readUInt32LE(cursor + 20);
  const size = zip.readUInt32LE(cursor + 24);
  const nameLength = zip.readUInt16LE(cursor + 28);
  const extraLength = zip.readUInt16LE(cursor + 30);
  const commentLength = zip.readUInt16LE(cursor + 32);
  const offset = zip.readUInt32LE(cursor + 42);
  const next = cursor + 46 + nameLength + extraLength + commentLength;
  if (next > centralEnd || flags & 1) throw new Error('Invalid/encrypted member');
  const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
  if (/^[\/]|^[A-Za-z]:/.test(name) || name.split(/[\/]/).includes('..')) throw new Error('Unsafe archive path');
  entries.push({ name, size, compressed, method, offset });
  cursor = next;
}
if (cursor !== centralEnd) throw new Error('Central directory size mismatch');
const binaries = entries.filter(entry => /\.(exe|dll|pyd|node|com|scr)$/i.test(entry.name));
if (binaries.length !== 1 || path.posix.basename(binaries[0].name) !== 'SusuAIOverclock-1.5.5-portable.exe') throw new Error('Unexpected executable members');
const item = binaries[0];
const at = item.offset;
if (item.size !== 114047016 || at + 30 > zip.length || zip.readUInt32LE(at) !== 0x04034b50) throw new Error('Invalid executable entry');
const localNameLength = zip.readUInt16LE(at + 26);
const start = at + 30 + localNameLength + zip.readUInt16LE(at + 28);
if (zip.subarray(at + 30, at + 30 + localNameLength).toString('utf8') !== item.name || start + item.compressed > end) throw new Error('Local header mismatch');
const compressed = zip.subarray(start, start + item.compressed);
const exe = item.method === 0 ? compressed : item.method === 8 ? zlib.inflateRawSync(compressed, { maxOutputLength: item.size }) : null;
if (!exe || exe.length !== item.size || digest(exe) !== expectedExe) throw new Error('EXE bytes differ from verified guest artifact');
const ioc = scanBuffer(exe, `${filename}!/${item.name}`);
if (ioc.findings.length || ioc.errors.length) throw new Error('Known infection or inspection error in delivery EXE');
const report = {
  verifiedAt: new Date().toISOString(), archive: filename, archiveBytes: zip.length,
  archiveSha256: expectedZip, entries: entries.length, executable: item.name,
  executableBytes: exe.length, executableSha256: expectedExe,
  knownIocFindings: 0, inspectionErrors: 0, executableExtractedToHost: false,
  executableRunOnHost: false, antivirusClearance: false,
  limitation: 'Guest ClamAV still reports security-example/aggregate-library content signatures. This verifies transport integrity and known prepender absence, not all-malware absence or host disinfection.',
};
const reportPath = path.join(root, 'release', '1.5.5-DELIVERY-INTEGRITY.json');
if (fs.existsSync(reportPath)) assertNoLinks(reportPath);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
