/**
 * 单文件导入端到端冒烟：老板反馈「只能导入文件夹，识别不到单个 txt/md」。
 * 这里真拉起 Electron，直接调 preload 暴露的 IPC，验证：
 *   1. chooseImportPath('file') 能返回文件（对话框配置正确）
 *   2. analyzeImport 对单文件返回 inputKind=file
 *   3. 含破甲协议的规则文件 → 可手选平台
 *   4. importSingleFile 真注入并落盘（用临时 HOME 隔离，不碰老板真实配置）
 * 用法：env -u ELECTRON_RUN_AS_NODE DANGO_NO_SANDBOX=1 node tests/single-file-import.mjs
 */
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');

const fails = [];
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
    fails.push(name);
  }
};

// 用临时 HOME 隔离，避免写老板真实的 ~/.codex 等目录
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dango-home-'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dango-single-'));

// Electron 的 userData 依赖 %APPDATA% 必须已存在，隔离时必须先建好目录，
// 否则会抛 "Failed to get 'userData' path" 让主进程直接崩。
const fakeAppData = path.join(fakeHome, 'AppData', 'Roaming');
const fakeLocalAppData = path.join(fakeHome, 'AppData', 'Local');
fs.mkdirSync(fakeAppData, { recursive: true });
fs.mkdirSync(fakeLocalAppData, { recursive: true });

// 造三个测试文件
const ruleFile = path.join(tmp, '破甲规则.md');
fs.writeFileSync(ruleFile, '# 石井协议\n\n冷咖啡 触发。SHIYI 工作约定 v2。\n', 'utf8');

const cursorRule = path.join(tmp, 'my-cursor-rules.md');
fs.writeFileSync(cursorRule, '---\nalwaysApply: true\n---\nCursor Composer 规则\n', 'utf8');

const plainDoc = path.join(tmp, '随便.txt');
fs.writeFileSync(plainDoc, '今天天气不错\n', 'utf8');

const env = {
  ...process.env,
  HOME: fakeHome,
  USERPROFILE: fakeHome,
  APPDATA: fakeAppData,
  LOCALAPPDATA: fakeLocalAppData,
  // 双重保险：直接钉死各平台 home，确保不碰老板真实配置
  CODEX_HOME: path.join(fakeHome, '.codex'),
  DSH_HOME: path.join(fakeHome, '.dsh'),
  WB_HOME: path.join(fakeHome, '.workbuddy')
};
delete env.ELECTRON_RUN_AS_NODE;
env.DANGO_NO_SANDBOX = '1';

const app = await electron.launch({ args: [appDir, '--clean'], env });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');

console.log('=== 1. 单文件识别（analyzeImport） ===');
const det1 = await win.evaluate((p) => window.dango.analyzeImport(p), ruleFile);
console.log('  破甲规则.md →', JSON.stringify({ kind: det1.kind, inputKind: det1.inputKind, genericHit: det1.genericHit, canPickManually: det1.canPickManually, cands: det1.candidates?.length }));
check('单文件返回 inputKind=file', det1.inputKind === 'file');
check('含破甲协议被识别（genericHit）', det1.genericHit === true);
check('允许用户手选平台（canPickManually）', det1.canPickManually === true);
check('给出全平台候选', (det1.candidates?.length || 0) === 6, `实际 ${det1.candidates?.length}`);

const det2 = await win.evaluate((p) => window.dango.analyzeImport(p), cursorRule);
console.log('  my-cursor-rules.md →', JSON.stringify({ kind: det2.kind, platform: det2.platform, conf: det2.confidence }));
check('内容含 cursor 特征自动识别', det2.kind === 'single' && det2.platform === 'cursor');

const det3 = await win.evaluate((p) => window.dango.analyzeImport(p), plainDoc);
console.log('  随便.txt →', JSON.stringify({ kind: det3.kind, genericHit: det3.genericHit }));
check('普通文档不误判（候选全 0）', det3.kind === 'unknown' && det3.candidates.every((c) => c.score === 0));

console.log('\n=== 2. 单文件真注入（importSingleFile） ===');
const r1 = await win.evaluate(([p, id]) => window.dango.importSingleFile(p, id), [ruleFile, 'codex']);
console.log('  注入 codex →', JSON.stringify(r1));
check('append 模式注入成功', r1.ok === true && r1.mode === 'append');
const agentsMd = path.join(fakeHome, '.codex', 'AGENTS.md');
check('目标文件已落盘', fs.existsSync(agentsMd), agentsMd);
if (fs.existsSync(agentsMd)) {
  const body = fs.readFileSync(agentsMd, 'utf8');
  check('内容含石井协议', body.includes('石井协议'));
  check('含可卸载标记块', body.includes('shiyi-imported:') && body.includes(':start'));
}

const r2 = await win.evaluate(([p, id]) => window.dango.importSingleFile(p, id), [cursorRule, 'cursor']);
console.log('  注入 cursor →', JSON.stringify(r2));
check('copy 模式注入成功', r2.ok === true && r2.mode === 'copy');
check('cursor 规则文件已落盘', fs.existsSync(r2.dest), r2.dest);
if (fs.existsSync(r2.dest)) {
  const body = fs.readFileSync(r2.dest, 'utf8');
  check('copy 模式带 frontmatter 包裹', body.includes('alwaysApply: true') && body.startsWith('---'));
}

console.log('\n=== 3. 非文本文件被拦截 ===');
const binFile = path.join(tmp, 'blob.exe');
fs.writeFileSync(binFile, 'MZ fake', 'utf8');
let blocked = false;
try {
  await win.evaluate(([p, id]) => window.dango.importSingleFile(p, id), [binFile, 'codex']);
} catch (e) {
  blocked = /不支持的文件类型/.test(String(e.message || e));
}
check('非文本扩展名被拒绝', blocked);

await app.close();

console.log('\n隔离目录（验证后已保留，可查）:');
console.log('  fakeHome:', fakeHome);
console.log('  tmp:', tmp);

if (fails.length) {
  console.error(`\n单文件导入冒烟失败 ${fails.length} 项：`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('\n单文件导入冒烟全部通过！');
