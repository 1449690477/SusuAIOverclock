# v1.3.4 — L3 进程层误报修复（「找不到 / 未安装」不再乱报）

本版专修深度验证里最烦人的一层：**L3 进程层动不动就报「找不到 codex CLI」「客户端未安装」**，一条定位失败就把四层链路整个判死。

修了四处叠加的根因：

1. **纯代码缺陷**：`dsh` 的通道类型是 `gui-note`，而 L3 只处理 `cli` 和 `gui` 两种分支，`gui-note` 直接落 `else` 分支 `l3ok=false` —— **DSH 永远报失败**（它本来就没有独立 CLI）。现已改为「无进程通道 → 降级通过 + 会话层跳过」。
2. **codex CLI 只认一条硬编码路径**（`%LOCALAPPDATA%\OpenAI\codex-*-windows-x64-*\...\codex.exe`）。换台机器、换个安装形态（桌面版内嵌 CLI、npm/Yarn/scoop 全局、PATH）就找不到。现扩到 6 类候选源 + 6 层深扫 + 语义化版本排序（顺手修掉「字典序把 0.9.0 排在 0.135.0 前面」的选版 bug）。
3. **GUI 平台只查 `%LOCALAPPDATA%\Programs\<名字>`**，装到 `Program Files`、`%LOCALAPPDATA%\<名字>`、Store/MSIX、非 C 盘、Portable 目录全部漏判。
4. **「没定位到 exe」被一律当致命错误**，即使文件层、配置层都已经证明破甲在位。

现在 L3 改为 **四路并联取证，任一命中即通过**：

| 路 | 手段 | 覆盖场景 |
| --- | --- | --- |
| ① 标准安装位 | `installDirs`（已补全 Program Files / Store / 非 C 盘形态） | 绝大多数正常安装 |
| ② 注册表卸载项 | HKLM / WOW6432Node / HKCU 的 `DisplayIcon`、`InstallLocation` | 任意自定义安装路径 |
| ③ 有界深扫 | 紧档深度 3 + 松档（各盘符根/Portable/Software）深度 2，带预算 | 绿色版、解压即用 |
| ④ 运行中进程 | `tasklist` | 正开着的客户端（进程层最硬的证据） |

探测结论还会如实标注**来源**（installDir / registry / scan / process），不再只有一句干巴巴的「找不到」。最坏情况（标准位全空）耗时约 1.4s，且 60s 内复用缓存。

界面同步：新增琥珀色 **「⚠ 降级通过」** 态与「三层通过 · 会话层未执行」横幅，明确区分「没装」和「没探测到，但证据充分」，不再把后者显示成红色失败。

**本机实测**：七平台 L3 全绿（原 DSH 恒失败已修）。慢路径压测（把用户级路径指向空目录强制走兜底）仍七平台全绿 —— codex 经注册表找到 Store/MSIX 形态，cursor/opencode/workbuddy/anti-gravity 经 `DisplayIcon` 命中真实路径。测试套件 87/87。

其余六包内容与 v1.3.3 完全一致。

---

# v1.3.3 — Codex 包 v8（Astra6 粒度拆解）

本版把内嵌的 Codex 破甲包（冷咖啡石井）升到 **v8**：新增 **Astra6 粒度拆解**（`materials/astra6/`，含基线实测报告与 12 份原始数据）、新增 `check_codex.ps1`（精确判定 Codex 是否运行，排除 `.codex\plugins\` 下不随桌面端退出的常驻子进程——修「明明退出了 Codex，安装器却说正在运行」），安装器 v8.1/v8.2 修掉三处拦截点。

**重要：本版回铺了 v1.2.2 的 DeepSeek 400 修复。** v8 源包建立在此前旧基线上，把三处修复覆盖回了修复前状态（`models.json` 并发工具调用开关、`hooks.json` 的 `PreToolUse` 注册、hook 脚本工具事件注入）。已逐一还原：工具事件保持纯放行，`PreToolUse` 不再注册，`deepseek-v4-flash-vision-exp` 强制串行。v8 的新内容不受影响（除这三处外与源包 0 差异）。

沙盒实测：`install-replica.ps1 -CodexHome <临时目录>` EXIT=0（部署 2308 文件，三处修复校验通过）→ `Uninstall.ps1` EXIT=0。其余六包与启动器同 v1.3.2。

---

# v1.3.2 — Cursor 包 v3.6（Grok 4.6 定向层）

本版把软件内嵌的 Cursor 破甲包从 v3.4 升到 **v3.6**，核心是新增 **Grok 4.6 定向层（`shiyi-G46-grok.mdc`）**：Cursor 可切多后端，Composer 2.x 与 Grok 4.6 的安全条款形态完全不同，手法必须分流——Composer 走槽位劫持，Grok 4.6 下槽位劫持正撞它的反覆盖条款（负收益），唯一杠杆是把请求降到契约级。

**v3.6 自带实测背书**（不是推演）：`实测记录/` 完整进包——同一件事（JNZ→NOP）只改请求层级，契约级 G1-G5 **5/5 全交付**、意图级被拒、注入规则救不了意图级问法。定死的认知：**有效的是请求层级，不是规则文本**。附 `g46_verify.py` 一键复现。

同时修正安装器同源校验标记串（`[MODE: UNRESTRICTED]` → 正文实际的 `[MODE: LOCAL_WORKSPACE]`，此前永远误报），清退 v3.5 遗留 zip 存档。软件侧 cursor 卡片文案同步为「Composer 2.5 + Grok 4.6 双后端定向」。

沙盒实测：`--selftest` PASS（14 条规则全健康）→ 部署 EXIT=0 → `--verify` PASS。其余六包与启动器同 v1.3.1（含 ffmpeg.dll 竞态修复）。

---

# v1.3.1 — 便携启动器修复版（根治「找不到 ffmpeg.dll」）

本版专修一个启动错误：双击 exe 弹「由于找不到 ffmpeg.dll，无法继续执行代码」。根因是加速版启动器的缓存解压存在并发竞态——首次启动解压需数秒，期间再次双击会互踩解压目录，且解压插件吞写入错误，半截缓存被标记为完整后每次启动都命中它。现已重写为「唯一暂存目录解压 → 四关键文件校验 → 原子改名晋升 → 晋升成功才写标记」，并发实例自动互相等待复用，半截缓存会被 L1 抽验识破并自动重建。启动性能不变（冷启动约 6s / 热启动约 0.8s）。

**已中招的用户**：换用本版 exe 即自动自愈（无需手动清缓存）；也可手动删除 `%LOCALAPPDATA%\SusuAIOverclock-cache\` 立即重建。

功能内容与 v1.3.0 完全一致：Codex 双破甲分支（冷咖啡石井 + 胖虎）、七包工作台、v1.2.2 全部修复。

---

# v1.3.0 — Codex 双破甲分支版（冷咖啡石井 + 胖虎）

**苏苏 AI超频 · Susu AI Overclock** Windows x64 免安装单文件便携版。

本版给 Codex 加了第二条破甲路线：软件里 Codex 现在是**两张独立卡片**，二选一——

- **冷咖啡石井**（原分支，绿色 codex 图标）：走生命周期 hooks 注入 developer 消息，已修复工具调用插队导致的 DeepSeek 400（见 v1.2.2）
- **胖虎**（新分支，橙色虎头图标）：keysmith v0.5.0 单文件脚本，直写 `config.toml` 的 `model_instructions_file` 指向内置 `gpt-unrestricted.md`，默认隔离用户已有 `hooks.json`

**两者互斥**：胖虎部署会把 `hooks.json` 重命名为 `.disabled`，而石井正是靠 hooks.json 注入，所以不能同时生效。胖虎卸载（一键卸载）会完整恢复被隔离的 hooks.json，石井可无缝接管。切换前建议先卸载当前分支。

本版同时携带 v1.2.2 的两项修复：codex 工具调用事件不再插队注入（DeepSeek 400 根因）、workbuddy 安全段「漏网之鱼」再生根治。

---

## 下载

| 文件 | 大小 | 说明 |
| :-- | :-- | :-- |
| `SusuAIOverclock-1.3.4-portable.exe` | ~140 MB | 免安装便携版，双击即用，**已内嵌七个工具包（Codex v8 Astra6 + Cursor v3.6 Grok 4.6 定向层 + 胖虎）+ L3 进程层多源探测修复** |

> 首次运行 Windows 提示「已保护你的电脑」→ 点 **更多信息 → 仍要运行**。无代码签名证书所致，非软件问题。
> 若杀软拦截，请将 exe 与包目录加入白名单。

**SHA-256 校验**（可选，验证下载完整）：

```
626D682E93CEEE2D433C3C8B1393E58AB50D9670121F0DC1D5E7132181001261
```

```powershell
Get-FileHash .\SusuAIOverclock-1.3.4-portable.exe -Algorithm SHA256
```

> **从旧版升级**：直接换用新 exe 即可。若曾遇到「找不到 ffmpeg.dll」，v1.3.1 起会自动识破并重建半截缓存。Codex 包 v8 重装前会备份旧配置（`backups/eni-solo-*`），且**工具事件纯放行（DeepSeek 400 修复）已包含在包内**；Cursor 包 v3.6 重装会先备份旧规则文件再覆盖（.bak.<时间戳>），卸载可还原。Codex 两个分支互不干扰历史配置——石井分支重装仍走 `install-replica.ps1` 自愈（清 PreToolUse 遗留注册）；胖虎分支首次装会隔离当前 hooks.json（含时间戳备份），卸载即还原。原有 `config.toml` 账号配置一律保留。

---

# v1.2.2 — codex 破甲包工具调用修复版

本版专修一个会让 Codex 接 DeepSeek 官方端点直接报错的 bug：codex 破甲包的生命周期 hook 在工具调用骨节眼上插队注入 developer 消息，撕裂了 `tool_calls → tool output` 邻接关系，严格 Chat Completions 校验器甩 HTTP 400 `No tool output found for tool call`。现已根除——工具事件全部纯放行，破甲身份/路由锁仍随每轮 UserPromptSubmit 完整生效，功能不打折。

# v1.2.0 — 首个公开版本

## 启动加速（本版重点）

原生 electron-builder portable 每次双击都做完整三段 I/O：`Nsis7z::Extract` 解压到 `$PLUGINSDIR\7z-out` → `CopyFiles` 全量复制到 `$INSTDIR` → 退出后整目录删除。本机 NVMe 实测 **~22 秒**才轮到 Electron 启动（其中 `CopyFiles` 5279 个小文件占 15.3 秒）。

本版替换为**三级降级缓存启动器**：

| 级别 | 条件 | 行为 |
| :-- | :-- | :-- |
| **L1** | 缓存命中（主 exe + 完成标记都在） | 直接启动缓存目录，**零解压** |
| **L2** | 缓存缺失 / 损坏 | 7z 直接解压进缓存目录（跳过 `CopyFiles` 中转），写完成标记 |
| **L3** | 缓存不可写（只读介质 / 权限受限） | 回退原生 `$PLUGINSDIR` 行为，功能不受影响 |

| 实测项 | 结果 |
| :-- | :-- |
| 第一次启动（冷启动） | **约 6 秒** |
| 后续启动（热启动） | **约 0.8 秒** |
| `ready-to-show`（窗口可见） | 约 0.43 秒 |
| 缓存目录 | `%LOCALAPPDATA%\SusuAIOverclock-cache\1.2.0` |
| 缓存体积 | 约 663 MB |
| 残留进程 | 0 |

**关于缓存**：第一次运行会占用约 663 MB 本地空间，这是加速的代价，后续不会重复解压。删掉该目录后，下次会重新走一次冷启动。

**关于硬件加速**：默认保留 Chromium 硬件加速。这是为了避免原先「禁 GPU + 禁软件渲染」导致 Electron 子进程异常退出。普通 Windows 桌面正常使用；极少数远程桌面或老旧显卡环境若出现黑屏，再单独用软件渲染模式排查。

### portable 特性

- 不需要安装器
- 不写注册表安装项
- 不创建开机启动
- 不注册系统服务
- 不需要管理员权限
- 六个内嵌工具包随 EXE 一起解压使用

---

## 本版内容

### 六包统一部署台

`codex` · `cursor` · `dsh` · `opencode` · `workbuddy` · `anti-gravity`

- 自动识别安装路径，找不到可手动指定
- 真实平台图标（从各客户端 exe 提取）
- 一键安装 / 卸载，调用包内自带脚本，日志实时可见
- 装前自动备份 `~/.codex` / `~/.dsh` / `~/.gemini` 等配置目录
- SHA-256 基线快照 + 精确比对（新增 / 删除 / 修改）
- 状态一键导出 Markdown 报告

### 四层穿透验证 L1 → L4

| 层 | 检查内容 |
| :-- | :-- |
| L1 文件层 | 破甲文件是否写到位 |
| L2 配置层 | 配置文件可解析且已注册 |
| L3 进程层 | 客户端 / CLI 能否启动 |
| L4 会话层 | 发激活口令、抓真实回复、分析特征 |

失败即停，定位到具体一层并给出修复建议。CLI 通道走 `codex exec` 非交互；GUI 通道走 playwright 拉起客户端。

### 导入引擎（v1.2.1 修复重点）

- **支持导入单个规则文件**（`.md` / `.mdc` / `.txt` / `.json` / `.yaml` / `.ps1` / `.py` …），此前只支持整个包目录
- 修复 Windows 下 `openFile` + `openDirectory` 无法同时生效、退化为纯目录选择器的问题 —— 拆分为「选择单个规则文件」与「选择包目录」两个入口
- 单文件识别：文件名 + 内容特征双打分，阈值降至 10，识别不了则列出全平台候选由你手选
- 两种落地模式：`copy`（cursor，写 `~/.cursor/rules/` + 自动补 frontmatter）/ `append`（标记块追加，追加前备份）

### 内嵌包开箱即用

`packed-packs/` 打入 `resources/packs`（不进 asar，脚本需真实文件系统）。首次启动无需选目录。
路径解析三级降级：**imported > external > embedded**，卡片标注来源。

### 稳定性修复

- 修复 `Failed to get 'userData' path` 导致主进程崩溃：新增 `userData` → `~/.dango-desk` → 临时目录三级降级
- 主进程与渲染进程走 `contextIsolation` + preload 白名单 IPC（`dango:*`）

---

## 验证记录

| 项目 | 结果 |
| :-- | :-- |
| core 单元测试 | 38 / 38 通过 |
| 真机冒烟（引导空态 → 六卡部署 → 内嵌开箱即用 → 深度验证） | 全流程通过 |
| 打包产物真 exe 单文件导入 | 通过 |
| 六卡来源徽章 | 全部识别为「内嵌」 |
| 冷启动耗时 | 6.22 s |
| 热启动耗时 | 0.78 s |
| `ready-to-show` | 约 0.43 s |
| 残留进程 | 0 |
| SHA-256 校验 | 与发布值一致 |

---

## 社群与中转

| 入口 | 地址 |
| :-- | :-- |
| 🐾 词元喵喵 Q 群 | https://qm.qq.com/q/IKd1i5X64S |
| 💖 苏苏的公益中转 | https://susu.wiki/ |

---

## 已知限制

- 仅 Windows x64；无 macOS / Linux 构建
- 无代码签名，SmartScreen 会提示未知发布者
- 仓库不含 `packed-packs/`（377 MB），从源码构建需自行放置工具包
- GUI 通道深度验证会把客户端短暂顶到前台几秒

---

## 完整变更日志

见 [CHANGELOG.md](./CHANGELOG.md)
