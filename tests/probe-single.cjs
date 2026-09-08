const core = require('../electron/core.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
const cases = [
  ['破甲规则.md', '# 石井协议\n\n冷咖啡 触发。SHIYI 工作约定 v2。\n'],
  ['AGENTS.md', '# AGENTS\n\n你是石井。冷咖啡激活。\n'],
  ['shiyi-rules.mdc', '---\nalwaysApply: true\n---\n石井协议\n'],
  ['破甲.txt', 'COLD BREW 破甲说明\n冷咖啡\n'],
  ['cursor.md', 'Cursor Composer 规则：.cursor/rules\n'],
  ['codex.md', 'Codex CLI 配置 .codex/AGENTS.md\n'],
  ['random.md', '# 随便一个文档\n今天天气不错。\n'],
  ['随便.txt', 'hello world\n']
];

for (const [name, body] of cases) {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, body, 'utf8');
  const det = core.detectPackTarget(p);
  console.log(name.padEnd(18) + ' kind=' + det.kind + ' platform=' + (det.platform || '-') + ' conf=' + (det.confidence || '-'));
  if (det.scores) {
    const nz = Object.entries(det.scores).filter(([, v]) => v > 0).map(([k, v]) => k + ':' + v);
    console.log('   scores: ' + (nz.length ? nz.join(' ') : '全 0'));
  }
  if (det.candidates && det.candidates.length) {
    console.log('   candidates: ' + det.candidates.map((c) => c.platform + '=' + c.score).join(' '));
  }
}
console.log('\nTMP: ' + tmp);
