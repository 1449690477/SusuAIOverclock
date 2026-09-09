'use strict';
/**
 * build-library-snapshot.cjs —— 把 .scrape/list.json + .scrape/details/<i>.json
 * 合并成 build/library/library.json，供 core.loadBuiltinLibrary() 读取。
 *
 * 运行：node scripts/build-library-snapshot.cjs
 * 输出：
 *   build/library/library.json  —— 完整快照（含全文），~15MB
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIST = path.join(ROOT, '.scrape', 'list.json');
const DETAILS = path.join(ROOT, '.scrape', 'details');
const OUT_DIR = path.join(ROOT, 'build', 'library');
const OUT = path.join(OUT_DIR, 'library.json');

if (!fs.existsSync(LIST)) {
  console.error('缺少', LIST, '—— 先跑 node scripts/scrape-details.cjs');
  process.exit(1);
}
if (!fs.existsSync(DETAILS)) {
  console.error('缺少', DETAILS);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const list = JSON.parse(fs.readFileSync(LIST, 'utf8'));
const prompts = list.prompts || [];

let withContent = 0;
let previewOnly = 0;
let failed = 0;

const merged = prompts.map((m, i) => {
  const f = path.join(DETAILS, i + '.json');
  let content = null;
  if (fs.existsSync(f)) {
    try {
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      content = d.content || null;
    } catch { failed++; }
  }
  if (content && content.trim()) withContent++;
  else previewOnly++;
  return {
    ...m,
    content: content || (m.content_preview || '') + (m.content_length > (m.content_preview || '').length ? '\n\n<!-- preview only，联网时可补全 -->' : ''),
  };
});

const snap = {
  schemaVersion: 1,
  fetchedAt: new Date().toISOString(),
  source: 'https://api.12300.top/prompt-admin/',
  total: merged.length,
  prompts: merged,
};

fs.writeFileSync(OUT, JSON.stringify(snap), 'utf8');
const sz = (fs.statSync(OUT).size / 1048576).toFixed(2);
console.log(`✅ 写出 ${OUT}`);
console.log(`   prompts=${merged.length}  with_content=${withContent}  preview_only=${previewOnly}  failed=${failed}`);
console.log(`   size=${sz} MB`);