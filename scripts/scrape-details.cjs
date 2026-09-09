'use strict';
/**
 * scrape-details.cjs —— 并行抓 api.12300.top 全部详情，写到 .scrape/details/<id>.json
 */
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const TOTAL = 3134;
const CONCURRENCY = 30;
const OUT = path.join(__dirname, '..', '.scrape', 'details');
fs.mkdirSync(OUT, { recursive: true });

let done = 0, fail = 0, bytes = 0;
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
    await fetchOne(id);
    const total = done + fail;
    if (total % 200 === 0 || total === TOTAL) {
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      const eta = done === 0 ? '?' : ((TOTAL - total) * (Date.now() - t0) / total / 1000).toFixed(1);
      process.stdout.write(`[${sec}s eta=${eta}s] done=${done} fail=${fail} bytes=${(bytes / 1048576).toFixed(1)}MB\n`);
    }
  }
}

(async () => {
  const queue = Array.from({ length: TOTAL }, (_, i) => i);
  console.log('start: total=' + TOTAL + ' concurrency=' + CONCURRENCY);
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
  console.log('finished:', { done, fail, bytes, sec: ((Date.now() - t0) / 1000).toFixed(1) });
})();