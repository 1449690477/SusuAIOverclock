# v1.2.0 — 首个公开版本

**苏苏 AI超频 · Susu AI Overclock** 第一个正式发布。Windows x64 免安装单文件便携版。

---

## 下载

| 文件 | 大小 | 说明 |
| :-- | :-- | :-- |
| `SusuAIOverclock-1.2.0-portable.exe` | ~123 MB | 免安装便携版，双击即用，**已内嵌六个工具包** |

> 首次运行 Windows 提示「已保护你的电脑」→ 点 **更多信息 → 仍要运行**。无代码签名证书所致，非软件问题。
> 若杀软拦截，请将 exe 与包目录加入白名单。

**SHA-256 校验**（可选，验证下载完整）：

```
1AC7F0666CE6A7430CDA1716D2CE82A299335FCF156E9CEE69A84D70ABB33289
```

```powershell
Get-FileHash .\SusuAIOverclock-1.2.0-portable.exe -Algorithm SHA256
```

---

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
