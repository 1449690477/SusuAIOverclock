'use strict';
/**
 * resume-scrape.cjs —— 续抓缺失的详情（跳过已有文件）
 */
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const TOTAL = 3134;
const CONCURRENCY = 50;
const OUT = path.join(__dirname, '..', '.scrape', 'details');
fs.mkdirSync(OUT, { recursive: true });

let done = 0, skip = 0, fail = 0, bytes = 0;
const t0 = Date.now();

function fetchOne(id) {
  return new Promise((resolve) => {
    const req = https.get(
      'https://api.12300.top/prompt-admin/api/preset-prompt?id=' + id,
      { timeout: 15000 },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); fail++; return resolve(); }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const buf = Buffer.concat(chunks);
            fs.writeFileSync(path.join(OUT, id + '.json'), buf);
            done++; bytes += buf.length;
          } catch { fail++; }
          resolve();
        });
      }
    );
    req.on('error', () => { fail++; resolve(); });
    req.on('timeout', () => { req.destroy(); fail++; resolve(); });
  });
}

async function worker(queue) {
  while (queue.length) {
    const id = queue.shift();
    if (id === undefined) return;
    const target = path.join(OUT, id + '.json');
    if (fs.existsSync(target)) { skip++; continue; }
    await fetchOne(id);
    const total = done + fail;
    if (total % 200 === 0) {
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      process.stdout.write(`[${sec}s] done=${done} skip=${skip} fail=${fail} bytes=${(bytes / 1048576).toFixed(1)}MB\n`);
    }
  }
}

(async () => {
  const queue = [];
  for (let i = 0; i < TOTAL; i++) {
    if (!fs.existsSync(path.join(OUT, i + '.json'))) queue.push(i);
  }
  console.log('missing:', queue.length, 'of', TOTAL);
  if (queue.length === 0) return;
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
  console.log('finished:', { done, skip, fail, sec: ((Date.now() - t0) / 1000).toFixed(1) });
})();