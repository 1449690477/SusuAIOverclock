# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [1.2.0] — 2026-09-08

首个公开版本。

### 新增

- **导入引擎**：支持导入整个破甲包目录，或单个规则文件（`.md` / `.mdc` / `.txt` / `.json` / `.yaml` / `.ps1` / `.py` …）
- **单文件识别打分**：新增 `RULE_FILE_SIGNATURES` 六平台规则文件特征 + 协议兜底正则，文件名与内容双维度打分
- **两种落地模式**：`copy`（cursor → `~/.cursor/rules/shiyi-imported-*.mdc` + frontmatter 包装）/ `append`（`<!-- shiyi-imported:name:start/end -->` 标记块追加，追加前备份）
- **内嵌包**：`packed-packs/` 通过 electron-builder `extraResources` 打入 `resources/packs`，首次启动开箱即用
- **三级路径解析**：`resolvePackDir()` → `imported > external > embedded`，卡片标注来源徽章
- 打包产物真机验证脚本 `verify-single-packed.mjs`

### 修复

- **单文件导入无法选择**：Windows 下 `dialog.showOpenDialog` 的 `properties: ['openFile','openDirectory']` 不能同时生效，退化为纯目录选择器 → 拆分为「选择单个规则文件」与「选择包目录」两个入口，IPC 增加 `kind` 参数
- **单文件识别失败**：单文件打分普遍为 0 或 13，低于阈值 18 → 规则文件阈值降至 10，识别不了时返回全平台候选供手选
- **主进程崩溃** `Error: Failed to get 'userData' path`：新增 `resolveUserDir()` 三级降级（`userData` → `~/.dango-desk` → `os.tmpdir()/dango-desk`）
- **导入误注入**：候选同分或 0 分时不预选平台
- 非文本文件导入拦截（扩展名白名单校验）

### 变更

- 品牌更名为「苏苏 AI超频 · Susu AI Overclock」
- 便携版产物名 `SusuAIOverclock-${version}-portable.exe`
- 冒烟测试新增阶段 1.5：内嵌包开箱即用验证

### 测试

- core 单元测试 31 → **38**（新增 7 个单文件识别用例）
- 新增 `probe-single.cjs`（8 种单文件打分探针）、`single-file-import.mjs`（隔离 HOME 端到端）、`dialog-config.mjs`（断言 dialog properties）

---

## [1.1.0] — 2026-09-08

### 新增

- **四层穿透验证**：L1 文件层 / L2 配置层 / L3 进程层 / L4 会话层，失败即停并定位
- CLI 通道（codex）：`codex exec` 非交互发口令抓 stdout（`approval_policy=never` + `sandbox_mode=read-only`）
- GUI 通道（cursor / workbuddy / anti-gravity / opencode）：playwright 拉起客户端抓回复
- 回复分析维度：石井特征 / ROUTE 标记 / 思考过程 / 模型拒绝 / AI 声明残留
- 基线快照 SHA-256 比对与明细展示
- Markdown 检查报告导出

---

## [1.0.0] — 2026-09-08

### 新增

- 六大工具包（codex / cursor / dsh / opencode / workbuddy / anti-gravity）统一管理
- 安装路径自动识别 + 手动指定兜底
- 真实平台图标（从各客户端 exe 提取）
- 一键安装 / 卸载（调用包内自带脚本）
- 配置备份
- 活动记录与设置页
- `contextIsolation` + preload 白名单 IPC
