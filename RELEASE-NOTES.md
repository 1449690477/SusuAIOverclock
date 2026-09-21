# v1.5.7 — 隔离包载荷内置（修复勾选同意后仍无法安装）

> 状态：**源码、策略与隔离客体重建链路均已就绪**。本段以下全部内容为 v1.5.5 的历史发布记录，保留原文不改。

## 修复了什么

1.5.6 发布后收到用户反馈：**「反重力 / codex 冷咖啡 / codex 胖虎」三个包都勾选了「我知晓 同意」，安装按钮依然置灰、无法安装。**

**三个独立成因，只修一个或两个都仍然装不上：**

| # | 成因 | 修复 |
| :-- | :-- | :-- |
| 1 | 1.5.5 的清理把这三个包的二进制移出仓库，1.5.6 只补回了卡片与勾选框，载荷根本不在包里 → `resolvePackDir()` 返回 `{ dir: null, source: 'none' }` → `found=false` → `disabled` 永久为真、底部显示「未建立基线」 | 5 个载荷按**洁净字节基线**（`scripts/payload-dedetaint.json`，`entryPath` + `cleanSize` + `cleanSha256`）在归档时**按内容而非按路径**放行并内置进包；分发范围独立成轴（9 包），发布许可仍为 6 包 |
| 2 | 即使载荷就位，`assertPackSourceAllowed` 会把**每一个后代目录名**拿去和隔离 id 匹配，而 `packed-packs/codex/breaker-tx/skills/packs/anti-gravity/` 是 codex 自己的技能目录 → 误判为反重力载荷 → `ERR_PACK_SOURCE_QUARANTINED` | 已获同意的包**自身树内**（depth ≥ 1）的目录名豁免；根目录与文件名仍全量检查，跨包复用依旧拒绝 |
| 3 | 干净客体用 Ubuntu 的 **Info-ZIP `UnZip 6.00`** 解包源码，在 `LANG=C.UTF-8` 下把所有带 **bit-11 UTF-8 标记**的条目名改写成 CP437 字形 —— 566 个非 ASCII 条目里 **454 个**被改坏（`packed-packs/cursor/一键安装.bat` → `ф╕АщФохоЙшгЕ.bat`），导致 cursor 卡「缺 3 个预期文件」 | ①换成 `scripts/isolated-build-unpack.py`（`zipfile.ZipFile` 尊重 bit 11，拒绝符号链接/绝对路径/`..`，落盘逐文件复核 size+sha256）；②归档内写 `SOURCE-MANIFEST.json`（schemaVersion 2，**6,177 条**），客体校验器**第一件事**就是核对非 ASCII 名字与 `packed-packs/` 逐名一致；③客体准备阶段断言 CP437 残渣为 0，非 0 直接失败 |

第 2、3 条都是回归阶段才暴露的：第 2 条测试当时没覆盖，第 3 条更隐蔽 —— **parity 断言比对的是「产物里的树」与「客体自己解出来的树」，两侧被同一把刀改成同样的乱码，于是互证一致**。教训已写进技能库：比对对象必须是**「传输前由宿主写下、客体够不着」**的东西（本版即 `SOURCE-MANIFEST.json`）。

> 成因 1 为什么不再从隔离区恢复：隔离出来的那 5 个 blob 当时干净，但**同一目录随后被再次感染**。宿主有活体 PE 前置注入器（固定前置 2,592,798 字节 loader，每 60–120 秒轮询包裹新写入的 `.exe`），「恢复」等于把新注入的字节又请回产物。判据可机械复核：洁净文件 `size % 4096 == 30`，带 loader 的 `size == 原值 + 2592798` 且 `MOD 4096 != 30`。实测 `stripped` 全部为真，例如 `slo-runtime-hook.exe` 18,386,515 → **15,879,733**、`python.exe` 2,768,926 → **262,144**。

## 分发范围 vs 发布许可

| 轴 | 内容 | 作用 |
| :-- | :-- | :-- |
| 分发（`DISTRIBUTED_PACK_IDS`） | 9 包：6 发布 + `codex` / `codex-panghu` / `anti-gravity` | 决定**打不打包** |
| 发布许可（`RELEASE_PACK_IDS`） | 6 包：`cursor` / `dsh` / `claude` / `opencode` / `workbuddy` / `workbuddy-ai` | 决定**是否默认放行** |
| 知情同意（`CONSENTED_QUARANTINE_IDS`） | 运行时可变，存 `state.json.consents` | 决定隔离载荷**是否解锁** |

内置 ≠ 放行：三个旧载荷随包分发，未勾选时安装 / 卸载 / 备份 / 恢复 / 深度验证全部在策略层拒绝，勾选即解锁，撤销即回阻断。

## 构建范围

`package.json` 的 `extraResources[0].filter` 由 15 条扩到 **19 条**（新增三个包目录 glob，再加 `!**/.gitkeep`），与 `DISTRIBUTED_PACK_IDS` 在构建预检里交叉断言。客体校验器新增 parity 断言：产物 `resources/packs` 必须**逐个文件等于**过滤规则从源码目录选出的集合 —— 这是防止「卡片在、载荷不在」再次发生的永久闸门。

`!**/.gitkeep` 的来由：`builder-util` 的 `copyDir` 硬编码跳过 `.gitkeep`（而 `.gitignore` / `.github/` / `.travis.yml` / `.keep` / 零字节文件一律保留），过滤器必须显式声明才与产物同源。

## 本版产物（已在隔离客体构建完成）

| 对象 | 字节数 | SHA-256 |
| :-- | --: | :-- |
| `SusuAIOverclock-1.5.7-portable-electron44.4.3-isolated.zip` | 231724148 | `94ed18ca8100c088e7e857ddbc8b39cd29188ba4d40bf74b709d39350ed38913` |
| ZIP 内 `SusuAIOverclock-1.5.7-portable.exe` | 146966201 | `be9b7951b43364109c4d6b9608dab612ebb731e3beb50325de29f4b06df259ab` |

宿主以内置模块在内存核验：1205 个条目，归档与 EXE 哈希均匹配客体，`problems: []`，**未将 EXE 解压到宿主或在宿主运行**（`executableExtractedToHost: false`）。详见[交付完整性报告](./release/1.5.7-DELIVERY-INTEGRITY.json)。

客体链路（157e 源包）：解包 **6177/6177 零问题** → `verify tools` → `verify artifact`（产物 sha 与改动前一致）→ ClamAV **36,292 文件 / 2.24 GiB / 46 命中**（全部落在同一组内容签名，`unexpectedFindings: []`）→ `proof.py`（pack diff 全空、5 个 embedded 载荷全对）→ Linux ASAR GUI **176 项检查 0 失败** → `finalize` 出具 `PASS_LINUX_ASAR_GUI_ONLY`。

## 尚未验证

**Windows 原生 GUI、便携 EXE 自解压、Windows 平台探测与九个载荷的真实安装器仍未实机验证**。已验证的是 Linux Electron 44.4.3 下的 ASAR GUI 冒烟（`linux-no-sandbox` 模式，176 项），不等于 Windows 原生运行。本段不构成 AV 放行或安全认证。

---

# v1.5.5 / Electron 44.4.3 — 供应链污染处置与隔离重建

## 关于上一个版本被杀毒软件告警

**1.5.4 及更早版本发布后，多位用户反馈安装包被杀毒软件报毒、拦截。这不是我们有意为之。**

经排查，污染来源是随包分发的旧 Codex（王炸破甲）载荷中夹带的投放器外壳，不是本软件自身代码的问题。

已完成的处置：

- 旧 Codex 载荷不再随包发布，已从依赖与打包链整体移除；
- 与其同源的「胖虎」「反重力」两条独立分支一并停用（不是只把入口藏起来）；
- 51 个确认受污染文件已隔离保留（含旧发布 EXE 与打包工具），原始证据完整留存；
- 本版在全新虚拟磁盘内重新获取依赖、重新构建，升级到官方 Electron 44.4.3。

**同时如实说明：本版不是「杀毒全绿」。** ClamAV 仍报告 29 个文件命中，已定位为安全案例文档、示例代码与整合词库的**内容签名**，不是此前的 `R.exe` / `N.exe` 投放器。我们不冒称杀毒通过。

---

**2026-09-20：实际 ClamAV 扫描仍报告 29 个 Infected files、54 条告警；本版不是 AV 放行或无病毒认证。Windows 宿主仍受感染，虚拟机构建不等于宿主清理或可信宿主证明。**

只交付 ZIP，不把原生 EXE 解压到宿主或在宿主执行。本版已发布 GitHub Release `v1.5.5`。

- [本地最终 ZIP](./release/SusuAIOverclock-1.5.5-portable-electron44.4.3-isolated.zip)
- [交付完整性](./release/1.5.5-DELIVERY-INTEGRITY.json) · [最终构建 / AV 报告](./release/SusuAIOverclock-1.5.5-electron44.4.3-isolated-report.json)
- [安全详报](./docs/SECURITY-1.5.5.md) · [可直接阅读的摘要](./release/1.5.5-SECURITY-REPORT.md)

## 最终产物身份

| 对象 | 字节数 | SHA-256 |
| :-- | --: | :-- |
| `SusuAIOverclock-1.5.5-portable-electron44.4.3-isolated.zip` | 115161469 | `81d0b280ffcc0765a139bab710f64cc794cdb5b6bb84ad4c1069cdf1bc01d883` |
| ZIP 内 `SusuAIOverclock-1.5.5-portable.exe` | 114047016 | `089657d058dd647ae350be8936de3d536c127b66ac1ecd728067ff565887eb7b` |

宿主以内置模块在内存核验：67 个条目 / 1 个 EXE，归档和 EXE 哈希均匹配客体，0 已知 IOC / 0 错误，没有解压或运行 EXE。归档交付降低再感染暴露，不保证免疫；完整性报告明确 `antivirusClearance=false`。

## 隔离环境、运行时与源材料

- 用户后续明确批准在本机隔离打包后，使用专用 VirtualBox、Ubuntu 24.04 官方 20260911 镜像和全新虚拟磁盘；NAT / 回环转发，无共享剪贴板或共享目录。受感染宿主 / 虚拟化层仍是剩余风险。
- 固定官方 Electron **44.4.3**，移除 EOL 33 的最终运行时选择；旧 33 构建保留为已被替代的审计记录。完整官方运行时代码未改，打包 `.text` 与官方一致，仅正常品牌信息和 ASAR / 资源打包。
- 移除旧 builder 缓存 / shim 变通；Node 22.23.2、npm 10.9.8、builder 25.1.8，全新 registry 依赖 514 条 SRI 记录、456 包安装。缓存标识为 `1.5.5-electron44.4.3`，不复用旧 33 缓存；这是正常安全更新，不是杀毒规避。
- 真实 NSIS / 7z / ASAR 解包对比 3066 个文件，运行时与版本配置一致；实际资源包含 `cursor`、`dsh`、`opencode`、`workbuddy`、`workbuddy-ai` 五包，材料与 3134 条词库字节保持一致。
- 8 张卡片保留；`codex`（冷咖啡石井）、`codex-panghu`（胖虎独立分支）、`anti-gravity` 三条路线有意停用。新增 Cursor / WorkBuddy AI 嵌套预期路径修复，5 项错误缺失提示消失，不承诺全部原功能保留。

## 最终实测与未覆盖项

| 范围 | 结果 |
| :-- | :-- |
| 测试套件 | **31 项，29 通过、0 失败、2 条件跳过**：已退役胖虎载荷相关项及 Linux 上不适用的 Windows junction 项 |
| 编译检查 | 语法、TypeScript、Vite 通过 |
| 有界已知 IOC 扫描 | 最终输入工具 124 个二进制、最终产物 14 个二进制，各 0 命中 / 0 错误 |
| 后续 Linux ASAR GUI | **132 项通过、20 截图、0 渲染错误**；8 卡片、5 内嵌、3 阻断、9 次 IPC 执行前拒绝、5 项误提示修复、3134 词库搜索 / 纯文本详情及设置 |

GUI 使用官方 Linux Electron 44.4.3 在客体无网络 namespace 加载**最终 Windows `app.asar` / resources 原字节**，没有重编译。默认启动遇到 SUID sandbox 配置错误，随后仅客体测试以 `--no-sandbox` 回退；真实值 `app.isPackaged=false` 未伪造。

**未验证 Windows 原生 GUI、便携 EXE 自解压、Windows 平台探测和五包真实安装器；未执行安装 / 卸载、深度验证、用户 CLI、hooks、备份恢复或词库注入写入。** 旧 Electron 33 的两次 Wine 超时是历史失败，不是本版 Windows 验证。

[后续 GUI 汇总](./release/gui-verification-1.5.5-electron44.4.3-ay5toza1/SUMMARY.json) · [20 张截图](./release/gui-verification-1.5.5-electron44.4.3-ay5toza1/gui-electron44.4.3-linux-no-sandbox-20260920T150459Z-coykj9fm/screenshots/)

归档内及外置构建报告的 `pending-for-new-Electron44-build` 是打包时 GUI 尚未执行的时间点；后来的 GUI 汇总更新这项状态。归档生成时的完整构建 / 扫描报告保留，不修改最终 ZIP 或哈希；早期 ZIP 的只读词库深度分析仅在内容字节一致的范围内适用。

## ClamAV 实际告警（未放行）

ClamAV **1.5.3**、官方库 **28129 / 2026-09-20 06:26:26**，扫描 **26131 文件**（含源码、暂存、归档重复副本），报告 **29 个 Infected files、54 条告警行**：

| 签名 | 告警行数 |
| :-- | --: |
| `Win.Exploit.CVE_2015_6096-1` | 18 |
| `Img.Phishing.SvgJsPhishing-10044283-0` | 30 |
| `Html.Downloader.Satan-6249582-1` | 6 |

未预期签名 0、扫描限额警告 0，**并不表示扫描通过**。8 个 Markdown 源路径对应两种真实 XXE / SVG 示例；词库 1188 / 2427 / 2916 与 1389 / 1496 / 1603 两组保留同类内容。整库 JSON 的 Satan 签名来自跨记录 15 个关键词共现；3134 条逐记录完整引擎扫描没有单条 Satan 命中，整库告警仍保留。

官方 44 参考 EXE 本次 AV 命中为 0；旧官方 33 的 Mikey 检测已复现，支持该项为运行时误报，但未经厂商确认。不能据此把交付包所有告警认定误报。当前内容告警不是旧 R/N 前置封装，但也不是无毒证明。

React `<pre>` 详情只显示文本、不执行活动 HTML 或 OS 命令；词库注入则会写入下游 AI 规则，并非所有使用场景惰性无害。保留原文与功能，没有为隐藏报毒而拆分、编码、加白或移除内容。

## 宿主证据与后续验证

51 个确认命中的旧项目文件继续位于 `.security-quarantine-1.5.5/1789901641497-83836/*.quarantined`，移动前后哈希一致；`summary.json` / `manifest.jsonl` 保留映射。范围仅限 `node_modules`、`packed-packs`、`release`、`release-final`、`release-next`；原 1.5.4 EXE 路径不存在。隔离区被 Git 忽略且不作分发输入；这是改名 / 路径分离，不是沙箱或 NTFS 禁止执行，不要恢复样本。

早期宿主报告仍记录 TEMP `R.exe` / `HD_X.dat` 命中；没有清理活动感染，也没有证明初始入口、家族、C2、数据窃取或写入者身份。`Get-MpComputerStatus` 未找到，不存在 Defender 放行结论；不得归因官方厂商恶意。用户原有 `_patch_installer_v15.py`、`parse-installer.ps1` 保留，未访问账号令牌。

后续在独立可信 Windows 环境复核原生 GUI、自解压及允许包安装器，并独立复核 AV 内容告警。遇到 SmartScreen / 杀毒拦截应停止运行并核对报告，不绕过防护或添加排除项。不得沿用旧依赖、缓存、归档 / ASAR、旧输出或隔离样本来重建。

---

# 历史发布记录 — 非 1.5.5 验证，旧版安全保证失效

**以下全部版本的截图、测试通过、沙盒「干净机」、性能与哈希记录仅为历史资料，不是本次可信宿主、产物安全或功能回归证明。旧文档中以未签名解释拦截、保证无问题或认定误报的安全结论已撤回；不要据历史记录运行旧产物或重跑会执行载荷的旧测试。**

# v1.5.4 — 新增 WorkBuddy AI 国际版破甲卡片（历史，停止使用现有 EXE）

Windows 便携桌面端。八张卡片一张冰蓝工作台：Codex 10.4 / 胖虎 / Cursor 1.2 / DSH 5.7.0 / OpenCode / WorkBuddy 4.4 / WorkBuddy AI 国际版 1.3 / 反重力 3.2。

## 历史产物身份（不是下载或运行推荐）

- 文件：`SusuAIOverclock-1.5.4-portable.exe`，119691442 字节；已移动隔离，原 `release/` 路径不存在。
- SHA-256：`eb77718675e041e0ecc958146aec072a9b144ede87b8ec0036bf7c4665580ccb`，本次确认含共同封装的证据样本；哈希一致不等于安全。
- 已移除下载链接和绕过拦截的指引。请停止运行并先阅读当前安全报告。

## 历史界面截图（不是 1.5.5 实机验证）

![工具箱](https://raw.githubusercontent.com/1449690477/SusuAIOverclock/main/docs/screenshots/toolbox.png)

![破甲词库](https://raw.githubusercontent.com/1449690477/SusuAIOverclock/main/docs/screenshots/library.png)

![深度验证](https://raw.githubusercontent.com/1449690477/SusuAIOverclock/main/docs/screenshots/deep-verify.png)

## 本版更新

- 新增内嵌包 `workbuddy-ai`（懒人包 v1.3），不替换国内版 WorkBuddy。
- 软件侧直调 `Install-WBAI-LazyPack.ps1 -NoOpenLinks` / `-Uninstall`。
- 配置根 `~/.workbuddy-ai`，与 `~/.workbuddy` 隔离。
- 应用版本升至 `1.5.4`。
- 工具箱计数改为 `已找到 / 卡片总数`。

## 1.5 系列

- **1.5.3** Cursor 懒人包 v1.2
- **1.5.2** 反重力 v3.2 + 冰蓝 UI
- **1.5.1** WorkBuddy 国内版 v4.4
- **1.5.0** Codex 冷咖啡石井 v10.4

完整记录见仓库 [`CHANGELOG.md`](https://github.com/1449690477/SusuAIOverclock/blob/main/CHANGELOG.md)。

## 历史发布前校验（非 1.5.5 验证）

- 沙盒 A 干净机 / B 已有人设机安装+卸载，真机 `~/.workbuddy-ai` / `WorkBuddyAI` 哈希不变。
- `npm test` 通过。
- `package.json.version` 必须为 `1.5.4`。

---

# v1.5.3 — 内嵌 Cursor 包同步懒人包 v1.2

## 同步内容

- 用 `cursor 破`（v1.2）整包替换内嵌 Cursor 包。
- 软件侧直调 `setup.py install --no-open` / `uninstall`。
- 不打入旧 v3.6 的 `install_cursor.py` 与 `实测记录/`。
- 应用版本升至 `1.5.3`。

## 历史发布前校验（非 1.5.5 验证）

- `python setup.py --selftest` 通过。
- 沙盒 A 干净机 / B 已有规则机安装+卸载，真机 `~/.cursor` 哈希不变。
- `npm test` 通过。
- `package.json.version` 必须为 `1.5.3`。

---

# v1.5.2 — 内嵌反重力包同步 v3.2

## 同步内容

- 用 `anti-gravity-v3.2` 整包替换内嵌反重力包。
- 不打入本机 `backups/` / `evidence/`。
- `DEPLOY_PLANS.anti-gravity` 仍直调 `Install-AntiGravity.ps1 -NoOpenLinks`。
- 应用版本升至 `1.5.2`。

## 历史发布前校验（非 1.5.5 验证）

- 源包 `selftest-upgrade.ps1` 隔离自检全绿。
- 内嵌副本再跑同一套自检 + 干净/旧遮蔽/自定义规则三场景沙盒安装。
- `npm test` 通过。
- `package.json.version` 必须为 `1.5.2`。

---

# v1.5.1 — 内嵌 WorkBuddy 包同步 v4.4

## 同步内容

- 用 `wb破4.4` 源包整包替换内嵌 WorkBuddy 包（历史记录）。
- 不打入本机 `_quarantine` / `_*-state.json`。
- `DEPLOY_PLANS.workbuddy` 安装/卸载均直调 `Install-WB-OneClick.ps1 -NoOpenLinks`。
- 应用版本升至 `1.5.1`。

## 历史发布前校验（非 1.5.5 验证）

- 源包 `selftest-upgrade.ps1`：83/83。
- 内嵌副本再跑同一套自检 + 干净/已有/自定义三场景沙盒安装。
- `npm test` 通过。
- `package.json.version` 必须为 `1.5.1`。

---

# v1.5.0 — 内嵌 Codex 包同步 v10.4

## 同步内容

- 用 `codex-break-kit-v10` 源包整包替换内嵌 Codex「冷咖啡石井」（历史记录）。
- 桌面端加固保留：vision-exp 串行工具、反夹层硬自检、`DEPLOY_PLANS.codex` 直调 `install-replica.ps1 -NoOpenLinks -SkipAstra6`。
- 升级识别补上 1.4 内嵌 hook 哈希 `C18FE139…` 与独立 v10.4 原版 `B301B25F…`。
- 应用版本升至 `1.5.0`。

## 历史发布前校验（非 1.5.5 验证）

- `npm test` 通过。
- 沙盒安装：干净 home / 已有 hooks.json / 非作者路径，均能完整跑完 `install-replica.ps1`。
- `package.json.version` 必须为 `1.5.0`。

---

# v1.4.0 — DSH v5.7.0 同步

## 同步内容

- 同步 DSH v5.7.0 完整源包，包含 `VERSION`、双份 SHA-256 清单、v5.7 shield、prompt、技能和运行时自愈脚本。
- DSH 源包校验清单：2101 个 payload 文件，0 缺失、0 哈希/大小不一致、0 未登记文件。
- DSH 卡片版本改为读取 `VERSION`，显示 `5.7.0`。
- 保持 DSH 无独立 CLI 的 `gui-note` 降级策略，避免把可验证的 L1/L2 结果误报为 L4 失败。
- 应用版本升至 `1.4.0`。

---

# v1.3.8 — WorkBuddy v4.0 中性契约包同步

## 同步内容

- 修复深度验证 L4：CLI 验证固定临时工作目录、跳过 Git 信任确认、禁用 stdin 额外输入，并按真实 `--version` 选择最新 Codex CLI。
- 内嵌 WorkBuddy 包更新为 v4.0 中性契约版的 `IDENTITY.md`、`MEMORY.md`、`SOUL-snippet.txt`、`README-CN.txt` 与桥接服务。
- 保留桌面端已验证的 v1.1 全树模板清理、插件缓存/市场清理、模板备份与安装日志逻辑；没有直接覆盖回旧版清理能力。
- WorkBuddy 安装器版本提取统一显示 v4.0，并补齐 v2→v3 协议升级、SOUL 摘要升级、技能目录替换和自定义 `WB_HOME` 支持。
- 桥接服务不再内嵌 API Key；请求必须通过 `Authorization: Bearer ...` 或 `OMEN_KEY` 提供凭据，缺失时返回 401。
- Omen 启动入口改为相对包目录定位，不再依赖开发机绝对路径；BAT 返回真实退出码。
- 应用版本为 `1.3.8`。

## 历史发布前校验（非 1.5.5 验证）

- 不将源包 `backups/` 目录、`__pycache__` 或 `.pyc` 文件带入内嵌资源。
- `packed-packs/workbuddy` 与 `release/win-unpacked/resources/packs/workbuddy` 关键文件哈希一致。
- 发布目录扫描不到 `DEFAULT_KEY` 或硬编码 API Key。
- `app.asar` 内 `package.json.version` 必须为 `1.3.8`（历史版本记录）。

---

# v1.3.7 — 内嵌 Codex 包同步 v9.4

本版把独立包 `codex破 v9.4 (握手去冲突 + hooks最小化 + 路由兜底).zip` 同步进桌面端，
但保留桌面端已经验证过的串行工具调用和安装后反夹层硬自检。

## 同步内容

- `materials/hooks/ishii_auto_route.py`
  - 裸「冷咖啡」等激活词走独立握手路径，不再与路由首行约束冲突。
  - router 缺失、超时、非零退出或坏 JSON 时使用内建 fallback route。
  - L1/L2/L3 阶梯不再推进，工具事件继续保持纯放行。
- `materials/hooks.json`
  - 保留 `UserPromptSubmit`、`PreCompact`、`SessionStart`。
  - 移除失效的 `slo-runtime-hook`、`Stop` 和工具边界注册，避免无效进程与协议夹层。
- `install-replica.ps1`
  - 保留 v1.3.6 的 Hashtable 转换、历史工具事件清理和安装后硬自检。
  - 加入独立包 v9.4 及桌面端历史 hook 哈希的自动升级识别。
  - 未知哈希默认保留本机自定义版本，`-Force` 才覆盖，并备份 `.preexisting`。
- `materials/models.json`
  - 继续固定 `deepseek-v4-flash-vision-exp` 的
    `supports_parallel_tool_calls: false`，没有把并发工具调用回退打开。

## 校验基线

| 项目 | 结果 |
| --- | --- |
| 独立 v9.4 ZIP SHA-256 | `F4753DAE42FE9124A97C398CDF78EBA5DB11686DA9F6408D34ADB869A2F50145` |
| 内嵌 hook SHA-256 | `C18FE139D9B594E40BFFE26B9CA0CF53BE5C3EA996CD8B5D1D9D5F1D6947B7D6` |
| `SusuAIOverclock-1.3.7-portable.exe` SHA-256 | `D5BF14800E2EB8AEC7B5D93E3554F5FE359DE2A9359F819198BA9BBECA8EB62E` |
| portable EXE 大小 | `146,151,732 bytes` |
| 内嵌模型并发工具调用 | `false` |
| 内嵌 hooks 事件 | `UserPromptSubmit`, `PreCompact`, `SessionStart` |
| 发布版本 | `1.3.7` |

安装动作仍由用户在桌面端点击后执行；同步资源本身不会修改本机 Codex 配置。

---

# v1.3.6 — 内嵌 codex 包补齐「反夹层」安装侧防线（并拦下一次回退）

## 先回答那个问题

> 「这次修复，软件里的 codex 包是不是要同步更新？」

**四项里只有一项要同步，另外三项同步了就是回退。**

独立包 v9.2 报告里说的「包内 `ishii_auto_route.py` 还是夹层元凶版」，
指的是**独立 zip 自己的源包**，不是软件包。软件包这份从 v1.3.5 起就是
**三个工具事件（PreToolUse / PostToolUse / SubagentStart）全部纯放行**的彻底版；
v9.2 换上的 `83c0f53e…` 反而只改了两处 —— `SubagentStart` 那行仍是
`emit(_ctx("SubagentStart", TOOL_LOCK))`，只是独立包的 `hooks.json` 恰好没注册这个事件，才没炸出来。

| 独立包 v9.2 的改动 | 软件包现状 | 同步？ |
| :-- | :-- | :-- |
| hooks 脚本换 `83c0f53e…` | 包内 `248ef68e…`（三事件全放行） | ❌ 同步即回退 |
| `hooks.json` 加回 `PreToolUse` | 已移除该注册 | ❌ 同步即回退 |
| `models.json` 并发工具调用 | 已是 `false` | ❌ 同步即回退 |
| 安装器 hooks 部署的升级保护 | 无条件覆盖 | ✅ **同步**（做得更稳） |

## 补了什么

**1. 历史遗留的工具事件注册，这次真的清掉了**

合并逻辑只遍历「包内 `hooks.json` 声明过的事件」，而包内从 v1.3.5 起就不声明 `PreToolUse` 了。
于是老用户 `~/.codex/hooks.json` 里前几版留下的 `PreToolUse` / `SubagentStart` 条目**永远清不掉** ——
脚本换了新，注册还挂着。（v1.3.5 的发布说明里其实承诺过「重装自愈清 PreToolUse 遗留注册」，本版才真正兑现。）

现在 `[4/9]` 段显式遍历三个工具事件，只摘 `ishii_auto_route` / `slo-runtime-hook` 条目，
**用户自己的 hook 原样保留**，并逐条说明：

```
[purge] legacy PreToolUse registration removed (anti-interleave)
[purge] PostToolUse: removed 1 kit entr(ies), kept 1 user entr(ies)
[purge] legacy SubagentStart registration removed (anti-interleave)
```

**2. hooks 脚本部署：始终落修复版 + 备份 + 四态日志**

语义仍是**无条件覆盖**（对「别人用了绝不能出问题」来说，保证旧夹层版必被替换，
比「尊重用户自定义」更重要），但补上哈希比对与四态日志：
`[deploy]` 不存在 · `[keep]` 已是最新 · `[upgrade]` 旧版被替换 · `[force]` 指定强制。
被替换的旧文件一律先备份到 `Backup\hooks\ishii_auto_route.py`。

**3. 装后反夹层硬自检**

`[9/9]` 新增两条 `throw`（**不是告警**）：部署后的 `hooks/ishii_auto_route.py` 若仍含
`_ctx("PreToolUse"|"PostToolUse"|"SubagentStart"` 注入，或 `hooks.json` 的工具事件上仍挂着本 Kit 条目，
直接判定**装包失败** —— 不给用户「以为装好了」的机会。

## 实测抓到的两个真 bug（单元测试看不见）

在沙盒里模拟「老用户升级」（`hooks.json` 有工具事件残留 + hooks 脚本是夹层版）跑真实安装器，
连踩两坑，都是**真正会打崩别人机器**的那种：

1. **`ConvertFrom-Json` 的 PSCustomObject 删过一次键就拒绝再加键。**
   `[purge]` 摘掉工具事件后，合并循环里的 `$targetHooks.hooks.PreCompact = $kept` 直接抛
   `Exception setting "PreCompact": The property 'PreCompact' can not be found on this object`，
   **整个装包失败**。修法：先把 `hooks` 转成普通 hashtable，增删自由。
2. **hashtable 的 `PSObject.Properties.Name` 看不到数据键。**
   它返回的是类型成员（`Count`/`Keys`/`Values`…），于是 `-contains 'PreToolUse'` 恒为 false ——
   `[purge]` 和装后自检**双双静默失效**：日志里看着一切正常，实际残留原封不动。
   修法：改用原生 `ContainsKey()`。

两处都已沉淀成回归测试。

## 验证

- 单元测试 **102/102** 通过；`tsc --noEmit` 无错误；4 份 PowerShell 脚本 AST 解析全部 OK。
- **三场景真实安装器端到端**（`-CodexHome` 指向沙盒）：

  | 场景 | 结果 |
  | :-- | :-- |
  | 老用户升级（3 个工具事件残留 + 夹层版脚本） | `[purge]`×3 · 备份 + 覆盖修复版 · 自检通过 · 退出码 0 · 用户自定义 hook 保留 |
  | 全新安装（无 `hooks.json` / 无 `hooks` 目录） | `[deploy]` · 自检通过 · 退出码 0 |
  | 幂等重跑 | `[keep]` · 自检通过 · 退出码 0 |

---

# v1.3.5 — 内嵌 codex 包补上「命名空间报错」根治（软件安装路径不再漏修）

## 先回答那个要命的问题

> 「放到新软件里的 codex 包，别人用了之后是不是也会出现这个问题？」

**会。而且是必然。**

软件安装 codex 包时走的是：

```js
// electron/core.cjs
codex: { install: { file: 'install-replica.ps1', kind: 'ps1', args: ['-NoOpenLinks'] }, ... }
```

**直调 `install-replica.ps1`，根本不经过 `Install-OneClick.cmd`。**

而命名空间修复此前只挂在 cmd 的「Step 0」里 —— 于是：

| 安装方式 | 是否有命名空间修复 |
| --- | --- |
| 手工双击 `Install-OneClick.cmd` | ✅ 有（Step 0 会问一次） |
| 手工跑 `install-replica.ps1` | ❌ 没有 |
| **从软件里点「安装」** | ❌ **没有** |

装完一开 Codex，模型第一次调 `tool_search` 就撞：

```
Duplicate namespace name 'codex_app' in input[N].tools[M]. Namespace names must be unique.
```

换个法子压重名，立刻换第二条：

```
Invalid schema for function 'codex_app::automation_update':
schema must be a JSON Schema of 'type: "object"', got 'type: null'.
```

这是**原版 Codex 的 bug**（补丁写盘 18:29:03，而 Codex 进程 18:14:40 就起来了；18:12 / 18:14 两次报错跑的是未打补丁的原版 asar）。但这个包会把模型推向「去找联网 / 浏览器工具」，等于**提前把潜伏 bug 引爆**，所以看起来像「用了这个包才出事」。

本版把修复内建进 `install-replica.ps1` 本身，**软件路径与手工路径全部覆盖**。

## 改了什么

1. **`install-replica.ps1` 内置 Step 0** —— 新增 `[1.5/9] codex_app namespace fix`。
   - 位置：预检通过后（**此处已确认 Codex 主程序未运行，app.asar 可写**）
   - 动作：`python codex-namespace-fix\patch_codex_asar_namespace.py --auto`
   - 幂等：已打 / 无特征串 → `SKIP`，不动一个字节
   - 非致命：任何失败只打 `[WARN]`，**装包照常继续**
   - 可跳过：`-SkipNamespaceFix`
   - `-Force` 强装（Codex 在跑）时补丁失败也只告警

2. **包内新增 `codex-namespace-fix\`**

   | 文件 | 用途 |
   | --- | --- |
   | `FIX-NAMESPACE.cmd` | 一键修复（英文名，双击即用） |
   | `一键修复Codex命名空间报错.cmd` | 同上（中文名） |
   | `patch_codex_asar_namespace.py` | 主脚本，`--find/--check/--auto/--audit/--jscheck/--selftest/--restore` |
   | `check_codex_flatten.py` | 复查（直接读 asar 判形态 + 全量 integrity） |
   | `说明.txt` | 完整原理、证据链、边界、回滚方法 |

3. **`Install-OneClick.cmd` 升到 v9** —— Step 0 在装包前先问一次；进程守卫换成 `check_codex.ps1`（忽略 `.codex\plugins\` 下不随桌面端退出的常驻子进程，避免「我明明退出了却一直说在运行」）。

4. **`README-CN.txt` 写入 v9 说明段**（背景、原理、安全检查清单、重启要求）。

## 顺手拦下一次回退事故

新源包的 `materials/` 基线停在 **9/4–9/5**，比已发布修复更早。若无脑整体镜像，会把三处已发布修复冲回去：

| 文件 | 会被冲回的坏状态 | 后果 |
| --- | --- | --- |
| `materials/hooks.json` | 重新出现 `PreToolUse` 事件 | 暴露工具事件注入面 |
| `materials/hooks/ishii_auto_route.py` | 重新在 `PreToolUse`/`SubagentStart`/`PostToolUse` 注入 `additionalContext` | 撕开 `tool_calls` → `tool-output` 相邻性，DeepSeek 等严格 provider 回 **HTTP 400 `No tool output found for tool call`** |
| `materials/models.json` | `supports_parallel_tool_calls` 回到 `true` | 并行工具调用重开，同源风险 |

处置：镜像时**只取新增件**，这三个文件保留已发布版本，并逐项断言未回退：

```
hooks.json        PreToolUse 计数   = 0     ✓
ishii_auto_route  v7.3 FIX 计数    = 3     ✓
ishii_auto_route  TOOL_LOCK 注入   = 0     ✓
models.json       与上一版逐文件一致       ✓
```

与备份 `diff -rq` 的最终结果只有三项：新增 `codex-namespace-fix/`、更新 `Install-OneClick.cmd`、更新 `README-CN.txt`。

## 安全检查

> 以下仅为 v1.3.5 的历史代码 / 完整性检查记录，不能证明当时或当前二进制无恶意代码；相关安全保证失效，不是 1.5.5 的新增验证。

- `install-replica.ps1` / `check_codex.ps1` / `Uninstall.ps1` 三份 PS 脚本 **语法解析全 OK**
- 注入后行尾仍是**全 CRLF**（CR=LF=950）、**BOM 保留**（`efbbbf`）
- 补丁脚本**纯标准库**（`argparse/glob/hashlib/json/os/shutil/struct/subprocess/sys/tempfile/time`），不引入依赖
- 补丁调用**不接管道**：接管道会被宿主按控制台代码页解码再重编码，在**非中文系统区域**下不可逆，中文提示会变乱码 → 现在让子进程字节直通（有单测钉死）
- 补丁本身的安全边界（上一轮实测）：写入前自动备份 `app.asar.bak-codexapp-<时间戳>`、全量 integrity `5775/5775 MATCH`、被改 bundle `node --check` PASS、二次执行 SKIP、`--restore` 后逐字节一致、`NO-TARGET` 直接跳过、多份 Codex 并存时不自动挑（要求 `--asar` 显式指定，避免误改 antigravity / opencode / kimi / cursor）

---

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

**历史缓存故障说明**：当时的「自愈」仅指半截解压缓存重建，不是感染清除。旧版更换 EXE / 删除缓存的说明不作为当前处置指引；本次没有运行旧产物或清理系统。

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

## 历史产物记录（不推荐下载或执行）

| 文件 | 大小 | 说明 |
| :-- | :-- | :-- |
| `SusuAIOverclock-1.3.6-portable.exe` | ~140 MB | 历史七包便携产物记录，未在本次重新验证，不作为运行推荐 |

> 旧安全保证已撤回，绕过 SmartScreen / 杀毒拦截的指引已删除。遇到拦截应停止运行并核对当前安全报告；不要用旧包恢复隔离功能。

**历史 SHA-256 记录**（只作身份记录，不是无病毒证明，也不是 1.5.5 校验和）：

```
534E1495CED90020461F9AAE6130B55B07ADC4DD5C384252E78109BD42764B96
```

> 历史升级、缓存自愈与配置保留说明不再作为当前升级操作指南；本次未运行旧 EXE 或安装器，未验证这些历史保证。当前以 1.5.5 隔离和可信重建要求为准。

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

> 以下是 v1.2.0 原设计描述，不是受污染二进制实际行为的保证；关于不创建启动项 / 服务等安全保证不再有效，本次未据此宣告系统干净。

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

## 历史验证记录（非 1.5.5 验证）

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
- 历史版本未签名；这不能解释本次所有拦截或证明文件无害，当前应停止运行并核对安全报告
- 仓库不含 `packed-packs/`（377 MB），从源码构建需自行放置工具包
- GUI 通道深度验证会把客户端短暂顶到前台几秒

---

## 完整变更日志

见 [CHANGELOG.md](./CHANGELOG.md)
