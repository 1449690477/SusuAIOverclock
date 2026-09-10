# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [1.3.4] — 2026-09-10

### 修复

- **深度验证 L3 进程层「找不到 / 未安装」高发误报**
  - 现场：不论哪个平台，L3 频繁报「找不到 codex CLI」或「客户端未安装」，一条定位失败就把整个四层链路判死
  - 根因（四条叠加）：
    1. **`dsh` 通道 `mode:'gui-note'` 在 L3 的 if/else-if/else 里两个分支都不匹配，直接落 else → `l3ok=false` 恒定失败**（纯代码缺陷，DSH 本来就没独立 CLI）
    2. `findCodexCli()` 只认一条硬编码路径 `%LOCALAPPDATA%\OpenAI\codex-*-windows-x64-*\cli-native\x86_64-pc-windows-msvc\bin\codex.exe`，换个安装形态（桌面版内嵌 CLI / npm·Yarn·scoop 全局壳 / PATH）就找不到；目录名正则还要求 `-windows-x64-` 后缀
    3. GUI 平台的 `installDirs` 只覆盖 `%LOCALAPPDATA%\Programs\<名字>`，装到 `Program Files`、`%LOCALAPPDATA%\<名字>`、Store/MSIX、非 C 盘、Portable 目录一律漏判
    4. L3 把「没定位到 exe」一律当致命错误，即使 L1 文件层、L2 配置层已经证明破甲在位

### 变更

- **L3 改为多源并联取证（`core.probeRuntime`），任一命中即通过；标准位全部落空才逐级升级到更贵的探测**
  - ① `probe.installDirs` 标准安装位（补全 Program Files / `%LOCALAPPDATA%\<名字>` / Store 等形态）
  - ② **注册表卸载项**（HKLM / HKLM\WOW6432Node / HKCU × `...\Uninstall`）取 `DisplayIcon` / `InstallLocation`，覆盖任意自定义安装路径
  - ③ **有界深扫**：紧档（`%LOCALAPPDATA%\Programs`、`%LOCALAPPDATA%`、Program Files ×2）深度 3，松档（各盘符根 + `\Programs`/`\Portable`/`\Software`/`\Tools`）深度 2，带目录预算防拖死主线程
  - ④ **当前运行进程**（`tasklist`）—— 进程层最硬的证据：它正在跑就一定装了
  - 全部结果 60s TTL 缓存；新增 `exeVia` 字段如实标注「从哪找到的」（installDir / registry / scan / process）
- **`findCodexCli()` 重写为 `findCodexCliInfo()`：候选表 + 语义化版本排序**
  - 候选源扩到 6 类：`%LOCALAPPDATA%\OpenAI\*`（含 `cli-native\...\bin` 与 `bin` 两种布局 + 6 层深扫）、`~/.codex/.sandbox-bin`、`~/.codex/bin`、`%LOCALAPPDATA%\Programs\Codex++`、npm / Yarn / scoop 全局壳（`.exe`/`.cmd`）、`PATH`、全盘常见根兜底
  - 版本比较从字典序改为语义化（原来 `0.9.0` 会排在 `0.135.0` 前面，可能选中旧版）
  - 返回 `{ path, via, candidates }`，诊断里能说清「从哪找到的」
  - `spawnOnce` 支持 `.cmd`/`.bat`（经 `cmd.exe /d /s /c` 拉起；node 直接 spawn 会 EINVAL）
- **降级通过（soft）语义：不再把"探测不到"一律当失败**
  - CLI 找不到 → 自动回退 Codex 桌面客户端通道，L4 改走 GUI 探测
  - GUI 平台找不到 exe 但配置目录在位 → L3 降级通过，L4 标「已跳过」并说明原因
  - `gui-note` / 无进程通道的平台（DSH）→ L3 降级通过、L4 跳过，**不再判失败**
  - 失败态（`ok:false`）只在「真的没装」时才出现
- 前端：`VerifyLayer` 新增 `soft` 字段；DeepVerifyModal 增加琥珀色「⚠ 降级通过」态与「三层通过 · 会话层未执行」横幅；L3 靶向建议补上「已并联查过哪些位置」

### 说明

- 本机实测：七平台 L3 全部通过（原 `dsh` 恒失败已修）——codex/codex-panghu `CLI 可启动（codex-cli 0.135.0）`，cursor/opencode/workbuddy/anti-gravity `客户端已安装`，dsh `降级通过（无独立进程通道）`
- 慢路径压测（把用户级路径指向空目录，强制走注册表 + 深扫 + 进程兜底）：七平台仍全部命中——codex 经注册表找到 Store/MSIX 形态的 `C:\Program Files\WindowsApps\OpenAI.Codex_...`，cursor/opencode/workbuddy/anti-gravity 经注册表 `DisplayIcon` 命中真实安装路径；最坏耗时约 1.4s（有 TTL 缓存）
- 测试套件 87/87 全绿（新增 6 条：`probeRuntime` 结构与七包不抛异常、dsh 降级通过回归、soft 语义不变量、`findCodexCliInfo` 候选全部真实存在、窄 glob 已移除、`exeVia` 存在性）

---

## [1.3.3] — 2026-09-10

### 变更

- **Codex 破甲包（冷咖啡石井）升级到 v8：Astra6 粒度拆解 + 安装器误判修复**
  - 源包：`新建文件夹/codex/v8`（2348 文件 / 326MB）
  - 新增 22：`check_codex.ps1`（Codex 运行状态精确判定，排除 `.codex\plugins\` 下的常驻子进程，修「我明明退出了 Codex，安装器却说正在运行」）+ `materials/astra6/` 21 个文件（`V8-粒度拆解突破.md`、`Astra6-基线实测报告.md`、`astra-verify.py`/`10_granularity_verify.py`/`11_downgrade.py`、`verify/raw/*.json` 12 份原始实测数据、`verify_config.json`）
  - 变更 6：`install-replica.ps1`（v8.1/v8.2 安装器三处拦截点修复）、`Install-OneClick.cmd`、`Uninstall.ps1`、`materials/AGENTS.md`、`materials/astra6/README.txt`、`README-CN.txt`
  - 清退 2：`slo-runtime/.../source/prompts/gpt56-v5.zip`、`.../数据/部署失败诊断.zip`（源包已以同名 `.md` 替代）

### 修复

- **回铺 v1.2.2 的 DeepSeek 400 修复（源包 v8 系基于 v7.2 旧基线，把这三处覆盖回了修复前状态）**
  - 现场：v8 源包把 v1.2.2 已发布的三处修复全部回退——
    1. `materials/models.json`：`deepseek-v4-flash-vision-exp` 的 `supports_parallel_tool_calls` 由 `false` 改回 `true`
    2. `materials/hooks.json`：`PreToolUse` 事件注册被加回
    3. `materials/hooks/ishii_auto_route.py`：`PreToolUse` / `PostToolUse` / `SubagentStart` 三处又挂回 `TOOL_LOCK` 注入（`emit(_ctx(..., TOOL_LOCK))`），撕裂 `tool_calls → tool output` 邻接，严格 Chat Completions 端点（DeepSeek 官方）会甩 HTTP 400 `No tool output found for tool call`
  - 判定依据：v8 的 README 第 173 行仍把「PreToolUse 每次工具调用前注入 SHIYI TOOL LOCK」当特性描述，说明源包建立在 v7.3 修复之前的基线上；而新增的 `materials/astra6/` 全文无 `PreToolUse/PostToolUse/SubagentStart/TOOL_LOCK` 引用，**新机制不依赖工具事件注入**，故属纯回退而非设计冲突
  - 处置：并入 v8 全部新内容后，从上一版产物（`release/win-unpacked/resources/packs/codex`，含 v7.3 修复）回铺这 3 个文件。回铺前后逐文件 diff 确认：**除这 3 个文件外，packed-packs 与 v8 源包 0 差异**（`diff -rq` 仅 3 行），即未丢失任何 v8 新内容
  - 校验（部署产物级）：`hooks.json` 无 `PreToolUse` 注册；`models.json` `supports_parallel_tool_calls` true=3 / false=1；hook 脚本 `v7.3 FIX` 注释 ×3、三处工具事件 `TOOL_LOCK` emit 计数 = 0/0/0

### 说明

- 软件侧 codex 卡片：subtitle 补 Astra6，note 改为 v8 描述并注明工具事件纯放行修复已保留；`expected` 补 `check_codex.ps1`
- 沙盒实测闭环（`install-replica.ps1 -CodexHome <临时目录> -NoOpenLinks`）：install EXIT=0（部署 2308 文件，`AGENTS.md`/`hooks.json`/`models.json`/`prompts`/`skills`/`eni-solo`/`slo-runtime`/`tools` 全落地，安装清单 version 4.0.0）→ 三处修复校验通过 → `Uninstall.ps1` EXIT=0（移除 5 条注入 hooks 条目，备份保留）
- 测试套件 81/81 全绿

---

## [1.3.2] — 2026-09-10

### 变更

- **Cursor 破甲包升级 v3.4 → v3.6：新增 Grok 4.6 定向层（G46），双后端分流**
  - 源包：`新建文件夹/cursor/cursor 破 3.6`（镜像同步进 `packed-packs/cursor/`，41 文件，MIRROR-EXACT 复核 + 关键文件 SHA256 全对上）
  - 核心新增：`materials/rules/shiyi-G46-grok.mdc` —— Cursor 内 xAI Grok 4.6 后端定向层（Always 挂载）。与 C25 层互斥分流：Composer 2.x（system prompt 无安全条款，拒答来自训练残留）走槽位劫持；Grok 4.6（29 条硬规则 + 反覆盖条款 + jailbreak 自判）槽位劫持是负收益，唯一杠杆是把请求降到契约级
  - `shiyi-C25-composer.mdc` 加适用范围警告（Grok 4.6 后端下第 2、3 节禁用，指向 G46）；`AGENTS.md`/`.cursorrules`/`CLAUDE.md` 三通道同步写入后端识别与手法切换矩阵
  - **v3.6 实测背书进包**：`实测记录/`（15 文件）——G46 契约级实测报告（同一件事 JNZ→NOP，只改请求层级：契约级 G1-G5 5/5 全交付、意图级被拒、注入规则救不了意图级问法）+ raw 原始输出 + `g46_verify.py` 一键复现工具。定死的认知：有效的是请求层级，不是规则文本
  - 安装器修正：同源校验标记串 `[MODE: UNRESTRICTED]` → `[MODE: LOCAL_WORKSPACE]`（与规则正文实际写法对齐，此前永远误报）；版本号横幅 v3.4 → v3.6
  - 清退：v3.5 遗留存档 `cursor破 Composer 2.5.zip`（新源包无此文件、无任何脚本引用）
  - 软件侧：cursor 卡片 subtitle 改「Composer 2.5 + Grok 4.6 双后端定向 · 提问降维轴」，note 改 G46 实测结论；`expected` 清单不变（仍全在场）
  - 沙盒实测闭环（临时目录部署）：`--selftest` PASS（14 条规则 frontmatter 全健康，G46 Always 挂载，三通道同源 6/6 标记齐）→ install EXIT=0（14 条 mdc + AGENTS.md 13686B + .cursorrules 11161B 全落地）→ `--verify` PASS（三通道全在场）
  - 测试套件 81/81 全绿

---

## [1.3.1] — 2026-09-09

### 修复

- **便携启动器：根治并发解压竞态导致的「找不到 ffmpeg.dll」启动错误**
  - 现场：双击 `苏苏 AI超频.exe` 弹系统错误「由于找不到 ffmpeg.dll，无法继续执行代码」，且之后每次启动都复现
  - 根因链（v1.3.0 及之前加速版启动器的 L2 缓存逻辑）：
    1. 首次双击走 L2，`RMDir` 清缓存后 `Nsis7z::Extract` 直接解压进正式缓存目录（766MB，需数秒）
    2. 用户以为卡住再次双击 → 第二个实例也进 L2 → `RMDir` 掉第一个实例**正在解压**的目录 → 两实例互踩
    3. `Nsis7z::Extract` 吞写入错误（electron-builder 上游 issue #6547 同款），解压失败也照写 `.cache-complete` 标记、照启动 → 半截 Electron 报「找不到 ffmpeg.dll」
    4. 旧版 L1 命中判定只验「主 exe + 标记」→ 之后**永久命中半截缓存**，错误无法自愈
  - 修复（`build/portable-fast.nsi` 重写 L1/L2，打包时由 `patch:portable` 自动注入）：
    1. **暂存目录**：L2 解压进 `<版本>.tmp-<PID>` 唯一暂存目录，并发实例各解压各的，不再互踩
    2. **关键文件校验**：解压后逐一验证 主 exe / `ffmpeg.dll` / `icudtl.dat` / `resources\app.asar`（Nsis7z 吞错，只能自己验）
    3. **原子晋升**：四文件全过才 `Rename` 暂存目录为正式缓存，**晋升成功才写完成标记**；改名失败（并发实例抢先）则等对方标记最多 30s 后直接复用缓存
    4. **降级兜底**：校验不过 → 删暂存 → 回退 `$PLUGINSDIR` 原生解压启动（无缓存但一定能用）
    5. **L1 判定加固**：缓存命中除「主 exe + 标记」外，追加抽验 `ffmpeg.dll` / `icudtl.dat`，半截缓存不再被信任，自动走 L2 重建
  - 自愈说明：已中招的用户（缓存半截）换用 1.3.1 exe 后，L1 抽验会识破半截缓存并自动重建；也可手动删除 `%LOCALAPPDATA%\SusuAIOverclock-cache\` 立即重建
  - 启动性能不变：冷启动仍约 6s，热启动仍约 0.8s（L1 命中路径零解压）

---

## [1.3.0] — 2026-09-09

### 新增

- **Codex 双破甲分支：新增「胖虎」（keysmith 单文件注入），与原「冷咖啡石井」并列可选**
  - Codex 现在有两个互斥的破甲路线，软件里是两张独立卡片（`codex` / `codex-panghu`），用户二选一：
    - **冷咖啡石井**（原分支）：走生命周期 hooks（UserPromptSubmit / PreCompact / SessionStart / Stop）注入 developer 消息
    - **胖虎**（新分支）：keysmith v0.5.0 单文件脚本，直写 `%CODEX_HOME%\config.toml` 的 `model_instructions_file = "./gpt-unrestricted.md"`，并默认隔离（重命名 `.disabled` + 时间戳备份）用户已有的 `hooks.json`
  - 机制互斥（已在两包 note + README-CN.txt + CONFIG_CHECKS 三处写明）：胖虎部署会隔离 hooks.json，而石井正是靠 hooks.json 注入，故两分支不能同时生效。胖虎卸载（`-Action uninstall`）会完整恢复被隔离的 hooks.json，石井可无缝接管
  - 包体：`packed-packs/codex-panghu/` 为最小部署集裁剪（43MB）——保留 `install.ps1` + `keysmith`（便携 Python 3.12.13 全量 + `codex-instruct-v0.5.0.py` + Windows 兼容层）+ `prompts`（7 套可切换根指令）+ `manifest.sha256`（864 条全量哈希）+ `README-CN.txt`；去掉源包的 `app-full`/`original`/`app-source`（ASAR 验证存档）、`skills`/`legacy-pack`（install.ps1 不引用）、release 冗余（v0.1.0、zip、`__pycache__`、嵌套 release/，省约 8MB）
  - 全链路接线：`PACKS` / `PLATFORM_PROBES`（复用 Codex 探测）/ `DEPLOY_PLANS`（install.ps1 -Action install/uninstall）/ `CONFIG_CHECKS`（model_instructions_file 指向 + gpt-unrestricted.md + keysmith manifest + hooks 隔离互斥检查）/ `L4_CHANNELS`（cli）/ `BRAND_ICONS`（虎头橙图标，与石井绿色 codex 图标区分）/ `PLATFORM_SIGNATURES` + `RULE_FILE_SIGNATURES` + `RULE_FILE_TARGETS`（词库注入落 .codex/AGENTS.md）
  - 新增独立配色 `tiger`（types.ts 联合类型 + app.css 变量 + .accent-tiger），胖虎卡片视觉与石井区分
  - evidence（生效证据，全部来自沙盒实测）：`config.toml` 含 `model_instructions_file` + `gpt-unrestricted.md` 存在 + `.codex-keysmith-manifest.json` 存在
  - 测试：新增 3 个胖虎专属测试（双分支互斥语义 / 部署计划走 keysmith install.ps1 / CONFIG_CHECKS 含 hooks 隔离检查），六包测试全部升级为七包，套件 81/81 全绿
  - 沙盒实测闭环（`-CodexDir` 指向临时目录，全新部署）：install EXIT=0（gpt-unrestricted.md 哈希 `E189BC92...BCB190` 对上、状态 active/healthy）→ verifyBreak 3/3 命中、CONFIG_CHECKS ok=true → uninstall EXIT=0（根指令删除、manifest 归档 `.uninstalled_<stamp>`、model_instructions_file 还原）→ verifyBreak 翻为 0/3；互斥场景实测：石井活跃 hooks.json 在场时胖虎安装将其隔离为 `.disabled`、卸载后完整恢复为活跃 hooks.json，两退出码均 0

### 变更

- 软件从「六包」升级为「七包」：标题栏、Hero、设置页、活动日志、根目录选择对话框等全部文案同步更新

> 本版同时携带 [1.2.2] 的两项修复（codex 工具调用事件不再插队注入 / workbuddy 安全段漏网再生根治），详见下方 1.2.2 记录。

---

## [1.2.2] — 2026-09-09

### 修复

- **codex 破甲包：工具调用事件不再插队注入（DeepSeek 400 根因）**
  - 现场：Codex 接 DeepSeek 官方端点执行工具调用时报 HTTP 400 `No tool output found for tool call call_xx`
  - 根因：`ishii_auto_route.py` 在 PreToolUse / PostToolUse / SubagentStart 事件注入 `additionalContext`，Codex 把它作为 developer 消息插进 `assistant tool_calls` 与 `tool output` 之间，严格 Chat Completions 状态机（DeepSeek 官方）直接判定工具输出丢失；并发工具调用时插队两次，消息拓扑彻底打烂。OpenAI 原生 / 反代端点会做归一化容忍，所以 Astra6 号池没炸、切 DeepSeek 就炸
  - 修复三件套：
    1. `materials/hooks/ishii_auto_route.py`：pretooluse / posttooluse / subagentstart 一律纯净放行 `{"continue": true}`，`TOOL_LOCK` 常量退役（石井身份与路由锁在每轮 UserPromptSubmit 已完整注入，工具骨节眼上不需要也不允许再插话）
    2. `materials/hooks.json`：移除 PreToolUse 事件注册（少一次无谓的 python 进程生成）
    3. `materials/models.json`：`deepseek-v4-flash-vision-exp` 的 `supports_parallel_tool_calls` → `false`，强制单步串行，杜绝多命令交织竞态
  - 老用户升级自愈：`install-replica.ps1` 合并 hooks.json 时，显式清除指向 `ishii_auto_route` 的 PreToolUse / PostToolUse / SubagentStart 遗留注册
  - 回归锁死：新增 8 个测试（直接管道喂 payload 给真 hook，断言工具事件输出无 `additionalContext`、SessionStart/PreCompact 注入不受影响、hooks.json/models.json 状态正确），套件 78/78 全绿
  - 实测：DeepSeek 端点真实命令调用（hostname）全链路通过，工具结果正常回传，报错消失

- **workbuddy 破甲包：根治安全段「漏网之鱼」反复再生**
  - 现场：装完包后 WorkBuddy 仍间歇注入 `<content_policy>` / `<personal_files_safety>` 等安全段；`plugins/workbuddy-builtin/welcomemode/*/work` 等目录「每次新生成」，手动删掉才正常
  - 根因（三处落地副本，旧版只清一处）：
    1. 运行时真正加载的欢迎模式模板在 `~/.workbuddy/plugins/cache/workbuddy-builtin/welcomemode-*/<ver>/prompt.tpl`——旧版 `[5/5]` **从不碰缓存**，清了安装目录也照样注入
    2. WorkBuddy 每次升级会从 `app.asar` 重新提取插件到 `resources/app.asar.unpacked/resources/plugins`（即截图里「新生成」的 welcomemode 目录）
    3. `app.asar` 本体内嵌全套原始脏模板（283MB，含 welcomemode + content_policy），是终极再生源
  - 实测铁证：cache 里 `welcomemode-work/0.1.5`、`welcomemode-design/0.1.5`、`welcomemode-code/0.1.7` 三份 `prompt.tpl` 各含 `content_policy`×2 + `personal_files_safety`×2，mtime 与 app.asar 一致（原样提取）
  - 修复（`Install-WB-OneClick.ps1` 升 v1.1）：模板清理扫描根从「templates + welcomemode 两处」扩到 **四个根全覆盖**——`templates`、`unpacked/resources/plugins` 全树、`~/.workbuddy/plugins/cache` 全树、`~/.workbuddy/plugins/marketplaces` 全树，`.tpl` 与 `.md` 一并纳入；改动文件按相对路径备份到 `backups/shiyi-pack-<stamp>/tpl-clean/` 可回滚
  - 验证：本机重跑命中 **清理 3 个脏 prompt.tpl / 共扫 4541 个**（四根文件数 15+308+313+3905=4541 精确吻合），清理后 cache 安全段计数归 0、文件本体保留（27925 bytes）、Jinja 配对完整（open=close=23，模板未删坏）；二次重跑「清理 0 个」证明幂等；PowerShell AST 解析 0 错误
  - 注：`app.asar` 本体不改动（改 283MB 主包风险高且会破坏签名），清干净全部落地副本即可压制再生——升级若重新提取，重跑一次安装脚本即自愈

---

## [1.2.1] — 2026-09-09

### 新增

- **智汇AI · 破甲词库（自带）**
  - 侧栏新增「破甲词库」视图，开机秒开 3134 条预设提示词（来自 `https://api.12300.top/user-prompt-library.html`）
  - 启动器随包发布词库快照到 `resources/library/library.json`（~25MB，含 2269 条全文 + 865 条 preview 兜底，剩余按需联网补全）
  - 卡片列表 + 关键词搜索 + 21 个分类筛选
  - **成功率排序**（默认 ↓ 推荐优先），可切「成功率 ↑ / 长度 ↓ / 名称 A-Z」
  - 多选批量注入：勾选任意多条 → 一键发到指定平台（cursor / codex / dsh / workbuddy / opencode / anti-gravity）
  - 详情弹窗看完整内容，确认后单条注入
  - 注入复用 `RULE_FILE_TARGETS` + `buildImportBlock`：cursor 走 `copy` 写 `~/.cursor/rules/shiyi-imported-*.mdc`，其余走 `append` 加到对应 `AGENTS.md` / `USER.md`，开头有精准标记块可卸载

### 工具

- `npm run scrape:library` —— 并行抓详情 API 到 `.scrape/details/`
- `npm run snapshot:library` —— 合并生成 `build/library/library.json`
- `npm run refresh:library` —— 一键抓取 + 重建快照

---

## [1.2.0] — 2026-09-08

首个公开版本。

### 性能

- **便携版启动加速**：替换 electron-builder 原生 `portable.nsi` 为三级降级缓存启动器
  - 原生模板每次双击都走「7z 解压 → CopyFiles 全量复制 → 退出删除」，本机实测 ~22s（`CopyFiles` 5279 个小文件占 15.3s）
  - 改为 7z 直接解压进 `%LOCALAPPDATA%\SusuAIOverclock-cache\<version>`，写 `.cache-complete` 标记；后续启动命中缓存零解压
  - 缓存不可写时回退原生 `$PLUGINSDIR` 行为，功能不受影响
  - 实测：冷启动 **6.22s**、热启动 **0.78s**、`ready-to-show` 约 0.43s
- **启动打点**：`DANGO_TRACE=1` + `DANGO_TRACE_FILE` 输出各阶段时间戳，生产环境零开销
- 构建链新增 `scripts/apply-portable-patch.cjs`（`npm run patch:portable`），`pack:portable` 自动串接，避免 `node_modules` 重装后模板丢失

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
