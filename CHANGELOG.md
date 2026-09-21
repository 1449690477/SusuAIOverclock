# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> **当前状态（2026-09-21）：1.5.7 已在隔离客体产出可用的便携 EXE，并已确认「勾选同意后真的能装」。** 修复 1.5.6 的**分发缺口**：三个隔离包虽已可勾选知情同意，但从未被构建进产物，导致勾选后仍「无法安装」。1.5.7 把 `codex` / `codex-panghu` / `anti-gravity` 三棵目录与 5 个可执行载荷一并内置回包，**分发不等于放行** —— `RELEASE_PACK_IDS` 仍是部署许可名单，未勾选时行为与硬隔离完全一致。产物 `SusuAIOverclock-1.5.7-portable.exe`，146,966,201 字节，SHA-256 `be9b7951b43364109c4d6b9608dab612ebb731e3beb50325de29f4b06df259ab`；交付归档 `SusuAIOverclock-1.5.7-portable-electron44.4.3-isolated.zip`，231,724,148 字节，SHA-256 `94ed18ca8100c088e7e857ddbc8b39cd29188ba4d40bf74b709d39350ed38913`。GUI 冒烟 **176 checks / 0 fail**（`PASS_LINUX_ASAR_GUI_ONLY`），含「未同意 → 阻断、同意 → 三个按钮真的可点、撤销 → 恢复阻断」的完整往返。1.5.5 的隔离与替换结论继续有效：ClamAV 对 1.5.5 归档报告的 29 个命中是安全案例文档 / 示例代码 / 词库的**内容签名**，不是此前的 `R.exe` / `N.exe` 投放器，但也不构成 AV 放行。Windows 宿主仍受感染，51 个项目样本继续隔离。1.5.4 及更早条目只作历史记录，旧安全保证失效，不要恢复或运行旧样本。详见 [SECURITY-1.5.5](./docs/SECURITY-1.5.5.md)。

---

## [1.5.7] — 2026-09-21 · 隔离包载荷内置 + 中文文件名修复（修复勾选同意后仍无法安装）

### 修复

- **勾选「我知晓 同意」后仍然无法安装。** 根因是把两件不同的事混成了一个名单：`RELEASE_PACK_IDS` 是**部署**许可名单，`build.extraResources` 的 `filter` 是**分发**名单，而过滤器里只有六个发布包。
  - 后果链：同意登记后 `getPackBlockReason()` 正确返回 `null`（所以徽标显示「隔离已解锁」），但产物里根本没有那三棵目录；`resolvePackDir()` 依次尝试 已导入 → 外部根目录 → 内嵌，三处全部落空，返回 `{ dir: null, source: 'none' }`。
  - `main.cjs::scanPack` 因此给出 `found = false`，而 `PackCard` 的按钮是 `disabled={busy || blockedReason || !pack.found || !plan.hasInstall}` —— 安装 / 卸载 / 深度验证永久灰掉，页脚显示「未建立基线」。
  - 交叉验证：1.5.4 产物 119,691,442 字节、1.5.5 为 114,047,016 字节、1.5.6 为 114,069,111 字节，而三包裸 LZMA 压缩后约 33 MB —— 任何历史版本都不可能装得下它们，即该功能在**载荷层面**从未可用过。
- **载荷补进去之后 Codex 仍然失败：来源检查把包自己的目录当成了别的载荷。** 这是补齐分发后的**第二个独立阻塞**，测试当时没覆盖，靠逐个直接调用安全检查函数才暴露。
  - `assertPackSourceAllowed` 会把**每一个后代目录名**都拿去和隔离包 id 比对，而 `packed-packs/codex/breaker-tx/skills/packs/anti-gravity/` 是 Codex toolkit **自己的技能目录**，于是命中「反重力」签名并抛 `ERR_PACK_SOURCE_QUARANTINED` —— 报的还是**反重力**的错误文案，误导性极强。同意解锁了策略门，来源扫描却仍然拒绝这个包自己的树。
  - 修法：已获同意的包，**自身树内部（`depth >= 1`）的目录名豁免**；根目录与**所有文件名**仍全量检查，因此「用甲包指向乙包的载荷目录」「用发布包指向隔离文件」这类跨包复用依旧被拒（`electron/pack-source-policy.cjs`）。
  - 已加回归测试 `consent unlocks a pack's own tree and never another pack's tree` 固定该不变量。
- **parity 断言自己先把检查放空：`.gitkeep` 被 builder 无条件丢掉。** 分发轴补齐后新加的「宿主过滤规则选出的集合 == 产物 `resources/packs/` 集合」断言一开始就红，根因在 `builder-util` 的 `copyDir`：它硬编码跳过 `.gitkeep`，但 `.gitignore` / `.github/` / `.travis.yml` / `.keep` / 零字节文件**一律保留**。
  - 这不是本项目的 bug，是 electron-builder 的既定行为，所以修法是在过滤规则里**显式声明** `!**/.gitkeep`，让两侧同源 —— 过滤规则由 18 条变 19 条，`packed-packs/` 侧条目数随之收敛。

### 新增

- **分发轴独立出来**：`electron/security-policy.cjs` 与 `scripts/preflight-security.cjs` 新增 `DISTRIBUTED_PACK_IDS = RELEASE_PACK_IDS + QUARANTINED_PACKS`（九包），构建预检断言两侧一致，`RELEASE_RESOURCE_FILTER` 与 `package.json` 的 `extraResources[0].filter` 一同**由 15 条扩到 19 条**（六发布包 + 三隔离包 + `NOTICE.txt` + 8 条排除规则 + `!**/.gitkeep`）。
- **隔离载荷安全传递**：1.5.5 卫生隔离把 5 个可执行文件移出了三棵目录，只补目录仍是空壳。载荷现在**不从隔离区恢复**，而是从 `.exe` 在宿主之外的**洁净字节基线**直接写进源包 ZIP（`scripts/payload-dedetaint.json`）。
  - 为什么放弃「从 `.security-quarantine-1.5.5/` 的 `summary.json` 恢复」：宿主有活体 PE 前置注入器，按扩展名轮询投毒。1.5.5 隔离出来的那 5 个 blob 当时是干净的，但**同一个目录在这之后被再次感染** —— 恢复出来的字节等于把新注入的 2,592,798 字节 loader 又请回产物里。判据是可机械复核的：干净文件的 `size % 4096 == 30`（VC 链接器节对齐留白），带 loader 的则是 `size == 原值 + 2592798` 且 `MOD 4096 != 30`。
  - 现方案：`payload-dedetaint.json` 逐条钉死 5 个载荷的 `entryPath` / `cleanSize` / `cleanSha256`，导出时**按内容而非按路径**放行 —— 只有字节的 sha256 命中基线才写入 ZIP；`allPass` 不为真、条目数不等于 5、`entryPath` 有重复、缺少 loader 文本段签名（`TEXT_OFFSET 0x1000` / `TEXT_LENGTH 0x7f000`，sha256 `dd25f3ed…c9932`）任一条件不成立即**拒绝导出**。
  - 宿主磁盘上这些文件始终是 `*.quarantined`，`.exe` 只出现在 ZIP 条目名里：绝不能在宿主落任何 `.exe`。
  - 5 个载荷：`anti-gravity/materials/proxy/bin/antigravity-oauth-proxy.exe`、`codex/materials/slo-runtime/eni-solo/sha256-r2-mixed-pinned-2b50f93a8d7716b5/slo-runtime-hook.exe`、`codex-panghu/keysmith/python/python.exe`、`codex-panghu/keysmith/python/Lib/venv/scripts/nt/python.exe`、`.../pythonw.exe`。实测 `stripped` 全部为真，例如 `slo-runtime-hook.exe` 由 `18,386,515` 回到 `15,879,733` 字节、`python.exe` 由 `2,768,926` 回到 `262,144` 字节。
  - `SOURCE-MANIFEST.json` 的 `restoredFromQuarantine` 字段**恒为空数组**（schemaVersion 2），并由客体侧断言「该已退役机制不得复活」。
  - 三棵隔离目录内允许 `.exe/.dll/.pyd/.node` 与 MZ 内容，**前缀之外一律照旧抛错**；`codex-panghu` 的 ensurepip 内置 wheel（`pip-25.0.1-py3-none-any.whl`）随包保留，否则随包解释器无法自举 pip。
- **端到端回归断言**：`isolated-build-verify.cjs` 在客体侧解包真实 EXE 后，逐条断言这 5 个载荷存在于 `resources/packs/` 且首两字节为 `MZ`，并把记录写进 `reports/artifact-result.json` 的 `quarantinedPayload` 字段；`isolated-gui-smoke.cjs` 断言三张隔离卡在**未勾选**时仍是 `source: 'quarantined'` / `found: false` / 按钮全灰，在**勾选后** `found: true`、`source: 'embedded'`、安装与深度验证按钮可点，撤销后再次灰掉。
- **选材一致性闸门（防止「卡片在、载荷不在」复发）**：`isolated-build-verify.cjs` 新增 parity 断言 —— 产物 `resources/packs/` 下的文件集合必须**逐个文件等于** `build.extraResources[0].filter` 从 `packed-packs/` 选出的集合。校验器内置最小 glob 引擎 `filterMatcher`，遇到不认识的 glob 模式**抛错而不是静默不匹配**（后者会让断言变成永远为真的空检查）。输出落 `reports/pack-filter-parity.json`。
  - 配套修掉导出脚本的作用域缺陷：`node_modules` / `release` 此前是**任意层级**排除，而 electron-builder 的 `!**/…` 只排除同级之外的模式 —— 结果是 `packed-packs/opencode/node_modules`（1 MB）与 `packed-packs/codex-panghu/keysmith/release` 被导出脚本丢弃、却被 builder 保留，两侧必然不等。现拆成 `$omitAtRoot`（仅根）与 `$omitAnywhere`（`backups` / `evidence` / `__pycache__` / `_quarantine` / `_deprecated-omen-bridge`）。修复后重跑：`opencode` 由 12 项增至 102 项、`codex-panghu` 由 797 增至 799 项，与 builder 侧一致。
- **传输完整性闸门（1.5.7 的第三颗雷，也是唯一一颗「两边互证、谁都没错」的雷）**：客体用 `unzip` 解包源码时，Ubuntu 的 Info-ZIP **UnZip 6.00** 在 `LANG=C.UTF-8` 下会把**所有带 bit-11 UTF-8 标记的条目名**改写成 OEM/CP437 字形 —— `packed-packs/cursor/一键安装.bat` 变成 `packed-packs/cursor/ф╕АщФохоЙшгЕ.bat`。1.5.7 归档里有 **566 个非 ASCII 条目、全部带 bit-11**，其中 **454 个被改坏**。
  - 为什么此前每一道闸门都放行：parity 断言比的是「产物 `resources/packs/`」与「**客体自己解出来的树**」—— 两侧被同一把刀改成同样的乱码，于是**互证一致**。凡是被 `unzip` 写过的名字，比对双方都错得一模一样。
  - 判据必须换成**「传输前由宿主写下、客体够不着」的东西**：导出时把每个条目的 `path` / `size` / `sha256` 写进归档内的 `SOURCE-MANIFEST.json`（schemaVersion 2，本包 6,177 条）。
  - 三层修法：①**换解包器** —— `scripts/isolated-build-unpack.py` 用 `zipfile.ZipFile`（尊重 bit 11）解包，拒绝符号链接 / 绝对路径 / `..`，落盘前逐文件复核 `size` + `sha256`，并断言归档内副本与自己逐字节相同（sha256 `30fac4ae…`）、非 ASCII 路径 ≥ 500；②**加传输闸门** —— `isolated-build-verify.cjs` 的 `tools()` 最先跑 `SOURCE-MANIFEST.json` 核对，非 ASCII 名字逐个 `existsSync` + size/hash 复核，并断言 `packed-packs/` 的宿主清单与客体解包树**逐名一致**，输出 `reports/source-transfer-integrity.json`；③**客体硬断言** —— `guest_prepare157.sh` 对 `一键安装.bat` 等四个中文名做点名抽查，并用 `find -name '*╕*' -o -name '*╣*'` 断言 CP437 残渣为 **0**，非 0 直接 `exit 1`。
  - 回归测试 `the source archive is extracted by a UTF-8 safe unpacker, not \`unzip\`` 把这四处断言钉死；`_v156_build/guest_setup.sh`（1.5.6 历史流程）里残留的 `unzip` 也已一并替换为 `zipfile`。
  - 同一缺陷存在于 1.5.5 / 1.5.6 的产物中，两个版本的归档与交付不予追溯重发。

### 变更

- 隔离文案改为与「知情同意」语义一致：`QUARANTINED_PACKS` 说明从「禁止安装」改为「默认阻断…勾选知情可解锁」，`RESTORE_SOURCE_WARNING` 收敛为「旧备份、外部目录、导入副本和历史内嵌包均不作为该载荷的可信恢复源。隔离不代表用户目录已清理。」`getPackBlockReason()` / `assertPackAllowed()` / `getDeployPlanInfo()` 语义未动。
- `packed-packs/NOTICE.txt` 从「六个工具包」更正为九个，并写明三个隔离载荷随包分发不等于部署许可。
- 版本号全链路对齐 1.5.7（`package.json` / `package-lock.json` / 构建预检硬断言 / 隔离构建导出与校验 / 交付归档校验 / 安全证据 / GUI 冒烟默认值）。

### 验证

**宿主侧（源码与策略）**

- `DANGO_TEST_REAL_PACKS=1 node --test tests/security-*.cjs`：**43 通过 / 0 失败 / 0 跳过**。
- `npm test`：**116 / 116** 通过。
- `tsc --noEmit`：无错误；`vite build`：1592 模块，产物 245.03 kB JS + 41.85 kB CSS。
- 构建预检（`--json`）：`ok: false` 但 **`errors: []`** —— 结构断言全过（版本三方一致、Electron 44.4.3 钉死、**19 条**过滤规则与共享清单逐条精确匹配、三轴常量一致）；findings 全部是已知宿主感染文件（`%TEMP%\R.exe`、`%TEMP%\HD_X.dat`，以及被前置器盖戳的 `7za.exe` / `app-builder.exe`）。**脚本明确声明无 bypass 开关。**
- `scripts/preflight-security.cjs --scan` 逐包复验：`codex` / `codex-panghu` / `anti-gravity` 合计 58 个二进制，全部 `known-ioc-not-detected`，0 命中 0 错误。
- 隔离包来源检查正反用例：三个包获得同意后全部通过；`codex` → 反重力根、`codex` → 胖虎根、`workbuddy` → 胖虎旧载荷文件、`workbuddy` → codex 树、`cursor` → 胖虎树，全部按预期抛错。
- 源包导出 `susu157e-source.zip`：**343,448,152 字节 / 6,177 文件 / `payloadBinaries 63` / `dedetainted 5` / `restoredFromQuarantine []`**，SHA-256 `c4ee204daa7b7b7d8421eaa9d8dbdec070bef1f81c9fe1d16c7bf989627f397c`；566 个非 ASCII 条目全部带 bit-11。与前一版 `susu157c-source.zip` 的清单差异**只有 `scripts/isolated-gui-smoke.cjs` 一个文件**（探针修复，见下），`package.json#build.files` 白名单不含 `scripts/`，故产物字节不变。
- `isolated-build-export.ps1` 在 Windows PowerShell 5.1 下解析 0 错误。

**隔离客体侧（Ubuntu 6.8.0-139 · Node v22.23.2 · Electron 44.4.3 · electron-builder 25.1.8）**

- 传输闸门：`reports/source-unpack.json` 与 `reports/source-transfer-integrity.json` —— `manifestEntries 6177 == archiveEntries 6177`，`missing` / `extra` / `sizeMismatch` / `hashMismatch` **全为 0**，`nonAsciiEntries 566`，解包器 sha256 `30fac4ae…`；客体 `find -name '*╕*' -o -name '*╣*' | wc -l` == **0**。
- 构建阶段：`PHASE=build EXIT=0`；预检 `findings: 0 / errors: 0`。
- 产物校验 `isolated-build-verify.cjs artifact`：**ALL PASSED**。

  | 项 | 值 |
  | :-- | :-- |
  | 产物 | `SusuAIOverclock-1.5.7-portable.exe` |
  | 字节 | **146,966,201** |
  | SHA-256 | `be9b7951b43364109c4d6b9608dab612ebb731e3beb50325de29f4b06df259ab` |
  | 包目录 | 9 个（6 发布 + 3 隔离） |
  | 载荷 | 5 个全部 `MZ`，sha256 逐个等于洁净基线 |
  | 二进制扫描 | `scannedBinaries 77` / `knownIocFindings 0` / `inspectionErrors 0` |

- parity 断言：产物 `resources/packs/` 与过滤规则（19 条）从 `packed-packs/` 选出的集合**逐个文件相等**，`resources/packs/cursor/一键安装.bat` 按字面名在场。
- AV（ClamAV 1.5.3 / 28129，全量 `--allmatch`）：`PHASE=av EXIT=0`，扫描 **36,292 文件 / 7524 目录 / 2.24 GiB**，46 处命中全部落在三组**内容签名**上 —— `Win.Exploit.CVE_2015_6096-1` ×20、`Img.Phishing.SvgJsPhishing-10044283-0` ×36、`Html.Downloader.Satan-6249582-1` ×4（最后一个是 `library.json` 整集合的关键词共现，不是可识别的独立下载器条目）。分类器 `unexpectedFindings: []`，**不声明 AV 通过**。
- **GUI 冒烟（`linux-no-sandbox`）：176 checks / 0 fail / `status=PASS`；`finalize` = `PASS_LINUX_ASAR_GUI_ONLY`**，`checksPassed 176`、`screenshotsSuccessfulRun 21`、`quarantineRejected 9`、`rendererErrors []`、`execAuditUnexpected []`、`portableArtifactSHA256` 与产物一致。老板报障的两条路径被当场实证：

  | 断言 | 结果 |
  | :-- | :-- |
  | 未勾选：三张隔离卡 `source: quarantined` / `found: false` / 按钮全灰，且真实 IPC 拒绝 `deploy` / `verifyDeep`（`ERR_PACK_QUARANTINED`） | 通过 |
  | 勾选：`source: embedded` / `found: true` / **`installEnabled` `uninstallEnabled` `monitorEnabled` 全为 `true`** | 通过 |
  | 撤销：徽标回「已隔离 · 只读」、阻断提示重现、三个按钮重新变灰、登记表落盘为空且不含载荷名 | 通过 |

  - 附带发现并修掉的是**探针自身**的两个缺陷，不是产物缺陷：① `page.waitForFunction()` 只要带第二个参数就会在页面里 `eval()` 重建谓词，产物 CSP 为 `script-src 'self'`（无 `unsafe-eval`），于是抛 `EvalError`，而调用侧的 `.then(() => true, () => false)` 把它**吞成 `false`**，报告里就长成一条「产品功能失败」；② `locator.check()` 对 React 受控 checkbox 会在 `window.dango.setConsent()` 异步往返完成前重试点击。现改为 Node 侧 `poll()`（谓词走 `page.evaluate`，CDP 不经 CSP）+ 单次 `click()` 后轮询渲染结果。
- **交付归档**：`SusuAIOverclock-1.5.7-portable-electron44.4.3-isolated.zip`，**231,724,148 字节**，SHA-256 `94ed18ca8100c088e7e857ddbc8b39cd29188ba4d40bf74b709d39350ed38913`，内含 1205 个条目（根为便携 EXE + 全部客体证据 + 复现脚本）。宿主侧复核 `problems: []`。
- 产物不在宿主打包：宿主预检按设计拒绝，`No bypass flag exists`；二进制全程只存在于隔离客体与宿主内存中的归档读取里（`executableExtractedToHost: false` / `executableRunOnHost: false`）。


## [1.5.6] — 2026-09-21 · 隔离包知情同意解锁 + Claude Code 破甲包

### 新增

- **Claude Code 破甲包（`claude`）成为第六个发布包**：内嵌 `packed-packs/claude`，冷咖啡 CHA v2.3.6 Claude 席位。`install-claude.py inject` 写入 88 个目标（`CLAUDE.md` 标记块 1 项 + `rules/cha-breakopen.md` 1 项 + 86 个 `SKILL.md`，含 6 父路由 / 80 叶子），`restore` 按备份与标记精准回滚。
  - 部署计划：安装 `install-claude.py inject`（kind `py`），卸载 `install-claude.py restore`，备份目录 `~/.claude`（尊重 `CLAUDE_CONFIG_DIR` → `CLAUDE_HOME` → `~/.claude` 解析顺序）。
  - L4 会话层通道：`cli`，`claude -p <prompt>` 无副作用问答，`--version` 探测。
  - 配置层检查：`CLAUDE.md` 含 `CHA-CLAUDE-POJIA:BEGIN`、`rules/cha-breakopen.md` 存在、`skills/cha-*` 至少一个 `SKILL.md`。
  - 新增品牌图标（clay 陶土色八芒星）与 `--clay` 系列 CSS 变量；来源识别签名仅对本包白名单，其他 id 不得复用 Claude 目录树。
- **隔离载荷改为知情同意（consent-required）解锁**：`codex`、`codex-panghu`、`anti-gravity` 三个旧载荷不再强制隔离，但也不默认放行。用户在卡片上勾选「我知晓 同意」后，安装 / 卸载 / 备份 / 恢复 / 深度验证才解锁；撤销即恢复 fail-closed。
  - 新增 IPC `dango:setConsent(id, granted)`，只接受隔离名单内的 id，落盘到 `state.json` 的 `consents`，并在每次 `loadState()` 时同步进不可变策略寄存器 —— 渲染层复选框不是安全边界。
  - 未勾选时 `deployPlanFor(id)` 仍返回空计划（`install:null`），`probeRuntime` / `assertPackAllowed` 直接拒绝，行为与 1.5.5 的强制隔离完全一致。
  - 勾选后从 `LEGACY_QUARANTINE_PLANS`（逐字取自 v1.5.4）取回可执行定义，L4 通道从 `none` 提升为 `cli` / `gui`。

### 变更

- 发布许可名单扩充为六包：`cursor`、`dsh`、`claude`、`opencode`、`workbuddy`、`workbuddy-ai`；包卡总数 9（6 发布 + 3 隔离）。
- `main.cjs` 不再直接读取 `core.DEPLOY_PLANS` / `core.L4_CHANNELS`，统一走 `core.deployPlanFor(id)` 与 `core.l4ChannelFor(id)`；CLI 验证参数按通道登记表取，移除 codex 专用硬编码。
- `findCodexCliInfo` 保持纯路径探测（未知版本候选一律不执行，避免触发受感染 CLI），并新增独立的 `findClaudeCliInfo`。
- 版本号全链路对齐 1.5.6：`package.json` / `package-lock.json` / 构建预检硬断言 / 隔离构建与归档校验脚本。

### 验证

- `npm test`：115 / 115 通过。
- `npm run test:security`（含 `DANGO_TEST_REAL_PACKS=1` 真实树只读检查）：39 / 39 通过。
- `tsc --noEmit`：无错误。
- Claude 包端到端实测（临时 HOME）：`inject` 写入 88 / 备份 0 → `verify` 88/88 → 二次 `inject` 幂等（88 写入 / 88 备份）→ `verify` 仍 88/88 → `restore` 88 复原，`CLAUDE.md` 标记块、`rules/cha-breakopen.md`、`skills/*` 全部清理干净。
- 知情同意链路实测：三个隔离包未勾选时 `blockReason=BLOCKED`、`plan.install=null`；勾选后 `install-replica.ps1` 可达且 L4 提升为 `cli`；撤销后立即回到 fail-closed。


## [1.5.5] — 2026-09-20 · 本地构建完成，AV 告警未解除

### 最终构建与运行时更新

- 经用户后续明确批准在本机隔离打包，使用专用 VirtualBox 客体、Ubuntu 24.04 官方 20260911 镜像、全新虚拟磁盘；NAT / 回环转发，无共享剪贴板或共享目录。受感染宿主和虚拟化层仍有剩余风险，不是可信宿主证明。
- 锁定官方 **Electron 44.4.3**，从最终构建移除 EOL Electron 33；旧 33 构建保留为已被替代的审计记录。完整运行时代码未改，打包 `.text` 与官方一致，仅正常品牌信息与 ASAR / 资源打包；这是正常安全升级，不是杀毒规避。
- 移除旧 builder 缓存 / shim 变通；全新 npm registry 获取，514 条 SRI 记录、456 个安装包；客体 Node 22.23.2、npm 10.9.8、builder 25.1.8。缓存标识 `1.5.5-electron44.4.3` 避免复用 33 缓存。
- 真实 NSIS → 7z → ASAR 解包核对 3066 个文件，版本和运行时配置一致；实际资源仅 5 包，3 包仍阻断，3134 条词库及材料字节保持一致。
- 修复嵌套预期路径检测，消除 Cursor / WorkBuddy AI 的 5 项错误缺失提示。不承诺零功能变化或 3 个隔离安装器恢复。

### 最终交付与实测

- [本地交付 ZIP](./release/SusuAIOverclock-1.5.5-portable-electron44.4.3-isolated.zip)：115161469 字节，SHA-256 `81d0b280ffcc0765a139bab710f64cc794cdb5b6bb84ad4c1069cdf1bc01d883`。
- 内含 `SusuAIOverclock-1.5.5-portable.exe`：114047016 字节，SHA-256 `089657d058dd647ae350be8936de3d536c127b66ac1ecd728067ff565887eb7b`。
- 宿主内置模块在内存核验 67 个归档条目 / 1 个 EXE，归档和 EXE 哈希精确匹配客体；0 已知 IOC / 0 错误，未向宿主解压 EXE 或运行它。只交付归档以降低再感染暴露，不是无病毒保证；见[交付完整性报告](./release/1.5.5-DELIVERY-INTEGRITY.json)。
- 最终测试 **31 项 / 29 通过 / 0 失败 / 2 条件跳过**：已退役胖虎载荷项和 Linux 不适用的 Windows junction 项。语法、TypeScript、Vite 均通过；最终输入工具 124 个二进制、产物 14 个二进制各为 0 已知 IOC / 0 错误。
- 后续客体无网络 namespace 中，官方 Linux Electron 44.4.3 加载字节未改的最终 Windows ASAR / resources，未重新编译：**132 GUI 检查通过 / 20 截图 / 0 渲染错误**，涵盖 8 卡片、5 内嵌、3 阻断、9 次 IPC 执行前拒绝、5 项错误提示修复、3134 词库搜索 / 纯文本详情及设置。
- 默认 Linux 启动因 SUID sandbox 配置错误失败，随后仅客体 GUI 测试使用 `--no-sandbox`；`app.isPackaged=false` 如实记录。没有安装 / 注入写入，未验证 Windows 原生 GUI、自解压、平台探测或五包实际安装器；旧 Wine / Electron 33 两次超时不算本版 Windows 验证。
- [最终构建报告](./release/SusuAIOverclock-1.5.5-electron44.4.3-isolated-report.json)的 GUI pending 是归档生成时状态；后来[GUI 汇总](./release/gui-verification-1.5.5-electron44.4.3-ay5toza1/SUMMARY.json)更新这一状态。归档内当时的完整构建 / 扫描报告保持不变，不改 ZIP / 哈希。

### 实际杀毒结果与未解除告警

- ClamAV 1.5.3、官方库 28129（2026-09-20 06:26:26）扫描 26131 文件，包含源码 / 暂存 / 容器重复副本：**29 个 Infected files / 54 条告警**。签名行数为 `Win.Exploit.CVE_2015_6096-1` 18、`Img.Phishing.SvgJsPhishing-10044283-0` 30、`Html.Downloader.Satan-6249582-1` 6；未预期签名 0、限额警告 0，但不是 AV 通过。
- 8 个 Markdown 来源路径对应两种真实 XXE / SVG 安全示例，6 条词库记录含相同内容。整库 JSON 的 Satan 命中来自跨记录 15 个关键词共现；3134 条逐记录完整引擎扫描中无单条 Satan 命中，不等于整库无告警。
- 官方 44 参考 EXE 本次 AV 命中为 0；旧官方 33 的 Mikey 检测可复现，支持该项为运行时误报的判断，但未获厂商确认，不能延伸成全包无毒结论。
- 保留原材料 / 词库，没有为隐藏告警而删除功能、拆分、编码或加白。React `<pre>` 仅作文本显示，但词库注入会写入下游 AI 规则，并非所有用途都惰性无害。剩余告警不同于旧 R/N 前置封装，仍须披露和独立复核。

### 已应用的源码变更

- 隔离 `codex`（应用原名「冷咖啡石井 v10.4」）、`codex-panghu`（胖虎独立分支）、`anti-gravity` 三条包部署路线，相关安装功能有意停用，等待可信替换来源。
- 最终打包采用 5 包允许清单：`cursor`、`dsh`、`opencode`、`workbuddy`、`workbuddy-ai`。允许清单不等于安全认证。
- 保留 8 张卡片及普通 UI / 文本词库 / 检测功能，增加上述嵌套路径修复和运行时升级。已完成有限 Linux GUI 实测，未验证 Windows 原生运行或真实安装，不承诺全部原有功能保留。
- 包身份使用已确认的 Codex「冷咖啡石井」与胖虎独立分支标签；不能据本地副本命中归因官方厂商恶意。
- 新增 `npm run test:security`、`npm run audit:security` 入口，以及 `scripts/quarantine-known-infection.cjs` 文件隔离工具。

### 已执行的项目文件隔离

- 先 dry-run，再 `--apply`，将 **51 个确认命中的项目文件**实际移至 `.security-quarantine-1.5.5/1789901641497-83836/*.quarantined`；移动前后均核对原始文件哈希，原字节保留、证据未删除。
- 范围仅限本项目 `node_modules`、`packed-packs`、`release`、`release-final`、`release-next`。原污染路径（包括 1.5.4 便携 EXE）不再存在；隔离目录中的 `summary.json` 与 `manifest.jsonl` 保存映射。
- 隔离区已被 Git 忽略，不作为分发输入；只是改名与来源路径分离，不是完整沙箱或 NTFS 执行拒绝，禁止恢复样本。未停止活动恶意程序、未做系统清理或更改操作系统配置。

### 阶段一实测（客体构建前的历史里程碑）

- 隔离前：项目清单 **277 个二进制 / 51 个受影响文件 / 0 错误**；构建预检 **184 个二进制 / 9 个受影响文件 / 0 错误**。报告：`release/security-audit-1.5.5-1789901531005.json`。
- 隔离后：项目清单 **226 个二进制 / 0 个已知 IOC 命中 / 0 错误**；构建预检 **177 个二进制 / 2 个受影响文件**（TEMP `R.exe`、`HD_X.dat`），另有 **2 项预期的必需工具缺失**（x64 `7za`、`app-builder` 已隔离）。报告：`release/security-audit-1.5.5-1789901684401.json`。
- 当时构建预检明确排除未使用的 macOS/Linux 签名缓存树；有界 IOC 检查不等于完整杀毒。宿主直接构建当时被阻断，后续在获准的客体内以全新工具完成构建；旧压缩包 / ASAR 不因此获安全背书。
- 在 `DANGO_TEST_REAL_PACKS=1` 下，使用官方签名 / 哈希已核验的系统 Node 内置测试运行器执行 `node --test tests/security-quarantine.test.cjs tests/security-preflight.test.cjs`：**tests 28 / pass 28 / fail 0 / skipped 0**。真实五包元数据检查条目数为 Cursor 33、DSH 2914、OpenCode 127、WorkBuddy 827、WorkBuddy AI 34；名称 / 来源守卫均通过，未执行包脚本、安装器或载荷，不是恶意代码放行或应用回归。
- core / main / preload、2 个新增策略模块及预检 / 清单收集 / 隔离 / 便携补丁 / 打包 / 构建前钩子，共 **11 个 JS 文件 `node --check` 通过**；`git diff --check` 通过。
- 1.5.4 样本共同封装及 `R.exe` / `N.exe` 证据保留于完整报告；初始入口、家族、C2、数据窃取未确认。

### 仍未完成与文档边界

- Windows 宿主未清理，虚拟化层未获独立可信证明；本地构建完成不等于 AV 放行或 Windows 功能全验收。后续仍需在独立可信 Windows 环境验证原生 GUI、自解压、允许包安装器并复核内容告警。
- 旧依赖、缓存、EXE、旧输出和隔离证据不得恢复为构建输入；旧套件须先排除载荷执行路径。历史截图、28/28 以及旧 Wine 结果不代替最终版本验证。
- README 保留停止并核对报告的拦截指引，不提供杀毒加白 / SmartScreen 绕过。用户原有 `_patch_installer_v15.py`、`parse-installer.ps1` 保留，未读取账号令牌、未清理宿主感染；已发布 GitHub Release v1.5.5。

---

## [1.5.4] — 2026-09-18 · 历史记录，现有产物停止使用

### 新增 WorkBuddy AI 国际版破甲卡片

- 用独立包 `WorkBuddyAI-石井懒人包-v1.3` 新增卡片，不替换国内版 WorkBuddy v4.4。
- 配置根锁死 `~/.workbuddy-ai`，与国内版 `~/.workbuddy` 互不覆盖。
- 软件安装/卸载直调 `Install-WBAI-LazyPack.ps1 -NoOpenLinks` / `-Uninstall`，避开 cmd 的 pause 与开官网。
- 卡片版本读 `README-CN.txt` / 安装器头的 `v1.3`。
- 应用版本升至 `1.5.4`。
- 工具箱计数改为 `已找到 / 卡片总数`（八包不再显示成 `/6`）。
- GitHub 仓库补齐 v1.5.4 冰蓝界面截图、项目介绍与本页更新日志入口。

---

## [1.5.3] — 2026-09-18

### 内嵌 Cursor 包同步懒人包 v1.2

- 用独立包 `cursor 破`（v1.2）整包替换内嵌 Cursor 破甲包（原内嵌为 v3.6 的 `install_cursor.py` 线）。
- 新包走 `setup.py`：18 条规则装到 Cursor 官方用户规则目录 `~/.cursor/rules/`，可选响应篡改代理默认关闭。
- 软件安装/卸载直调 `setup.py install --no-open` / `uninstall`，避开 bat 的 `pause` 与装完开官网。
- 卡片版本优先读 `README-CN.txt` / `使用说明.txt` 的 `v1.2`。
- 不打入旧包 `实测记录/` 与已废弃的 `install_cursor.py` / `patch_cursor_v32.py`。
- 应用版本升至 `1.5.3`。

---

## [1.5.2] — 2026-09-18

### 内嵌反重力包同步 v3.2

- 用独立包 `anti-gravity-v3.2` 整包替换内嵌反重力破甲包（原内嵌为 v3.0）。
- 同步 AGL1 三通道：`rules/ag-armor.md` 常驻 + `skills/coldbrew-breakout` 按需 + `plugins` 兼容；旧同名 skill 自动挪走解除遮蔽。
- 卡片版本优先读 `README-CN.txt` 的 `v3.2`。
- 不打入本机 `backups/` 与 `materials/evidence/` 现场记录。
- 应用版本升至 `1.5.2`。
- 界面从奶油粉绿甜品风收成瓷白 + 冰蓝高级感：布局圆角不动，主色/阴影/按钮/侧栏/词库/弹窗统一冷色。
- 补蓝白律动装饰：背景光球/斜扫光带/星点、标题栏流光、卡片与按钮扫光、侧栏呼吸线、导航点与徽章脉动。

---

## [1.5.1] — 2026-09-18

### 内嵌 WorkBuddy 包同步 v4.4

- 用独立包 `wb破4.4` 整包替换内嵌 WorkBuddy 破甲包（原内嵌为 v4.0）。
- 同步注入层去对抗签名、`Find-AllProgs` 多安装根、Temp 沙箱禁止自扫真机、`verify-install.ps1` / `selftest-upgrade.ps1`。
- Omen 桥接不再作为安装必备文件，保留在 `_deprecated-omen-bridge`。
- 软件安装/卸载直调 `Install-WB-OneClick.ps1 -NoOpenLinks`，避开 bat 的 `pause` 与弹窗。
- 卡片版本优先读 `README-CN.txt` 的 `v4.4`。
- 应用版本升至 `1.5.1`。

---

## [1.5.0] — 2026-09-18

### 内嵌 Codex 包同步 v10.4

- 用独立包 `codex-break-kit-v10`（v10.4）整包替换内嵌「冷咖啡石井」Codex 包。
- 保留桌面端已验证的硬约束：`deepseek-v4-flash-vision-exp` 串行工具调用、装后反夹层硬自检、软件安装路径 `-SkipAstra6`（不扫 Desktop/Documents）、1.4 / 独立 v10.4 hook 哈希可升级。
- 安装器沿用 v10.2 `ConvertTo-DeepDict`，干净机器与已有配置机器都能过 `[4/9] hooks.json`。
- 卡片版本读取改为 README 的 `破甲包 v10.4`，不再误读安装器注释里的 `v10.2`。
- 应用版本升至 `1.5.0`。

---

## [1.4.0] — 2026-09-11

### DSH v5.7.0 同步

- 同步 DSH v5.7.0 完整包：中性化 GLM5.3 拒答触发器、profile patch 自愈、启动日志探活、dsh-shield 52 项双侧冒烟护栏。
- 同步 `VERSION`、`SHA256SUMS.txt`、`SHA256SUMS.json`，源包 2101 个 payload 文件校验全部一致。
- DSH 卡片版本读取改为优先读取 `VERSION`，显示 `5.7.0`，不再从旧安装器首行误读成 `5`。
- 保留 DSH 原有 `gui-note` 通道语义：DSH 无独立 CLI 时 L3 降级通过，L4 自动跳过，不再误报会话失败。
- 应用版本升至 `1.4.0`。

---

## [1.3.8] — 2026-09-11

### WorkBuddy v4.0 中性契约包同步

- 修复深度验证 L4：CLI 验证固定临时工作目录，跳过 Git 信任确认，禁用 stdin 额外输入，并按真实 `--version` 选择最新 Codex CLI，避免旧版 CLI 误读新 `models.json`。
- 同步 WorkBuddy v4.0 的 IDENTITY / MEMORY / SOUL / bridge 内容，同时保留内嵌包 v1.1 已验证的全树模板清理和缓存清理能力。
- 安装器支持 `WB_HOME` / `WORKBUDDY_HOME` / `-WBHomePath`，修复 v2→v3 升级、SOUL 摘要升级和技能目录重复嵌套。
- 移除桥接服务中的硬编码 API Key；无 `Authorization` 或 `OMEN_KEY` 时显式返回 401。
- Omen 启动脚本改为相对路径定位，移除开发机绝对路径依赖；BAT 透传真实退出码。
- 不把 `backups/`、`__pycache__` 和 `.pyc` 打进发布资源。

---

## [1.3.7] — 2026-09-11

### 内嵌 Codex 包同步 v9.4

- 同步独立 Codex v9.4 的激活握手短路和路由故障 fallback，消除裸暗号与路由首行约束的冲突。
- `materials/hooks.json` 收敛为 `UserPromptSubmit`、`PreCompact`、`SessionStart` 三个有效事件，移除失效 runtime hook、Stop 和工具边界注册。
- 安装器保留 v1.3.6 的 Hashtable 转换、历史工具事件清理、用户 hook 保留和装后反夹层硬自检；新增已知 hook 哈希自动升级与未知版本保护。
- 保留 `deepseek-v4-flash-vision-exp` 的 `supports_parallel_tool_calls: false`，避免把已修复的工具交织问题重新打开。
- Desktop 包版本升至 `1.3.7`，Codex 卡片版本读取优先显示 README 的 `v9.4`。

### 校验

- 独立 v9.4 ZIP：`F4753DAE42FE9124A97C398CDF78EBA5DB11686DA9F6408D34ADB869A2F50145`
- 内嵌 hook：`C18FE139D9B594E40BFFE26B9CA0CF53BE5C3EA996CD8B5D1D9D5F1D6947B7D6`
- `SusuAIOverclock-1.3.7-portable.exe`：`D5BF14800E2EB8AEC7B5D93E3554F5FE359DE2A9359F819198BA9BBECA8EB62E`
- 版本：`1.3.7`

---

## [1.3.6] — 2026-09-11

### 结论先行

独立包 v9.2（「反夹层 hooks 修复 + 安装器升级保护」）的改动，**软件内嵌 codex 包只需要同步其中一件**，
其余三项一旦同步就是**回退**。以下逐项核过：

| 独立包 v9.2 的改动 | 软件包现状 | 该不该同步 |
| --- | --- | --- |
| `materials/hooks/ishii_auto_route.py` 换「修复版」`83c0f53e…` | 包内是 `248ef68e…`，**三个工具事件全部纯放行** | ❌ 不同步，同步即回退 |
| `materials/hooks.json` 重新加回 `PreToolUse` | 软件包已移除该注册 | ❌ 不同步，同步即回退 |
| `materials/models.json` `deepseek-v4-flash-vision-exp` 并发 | 软件包已是 `supports_parallel_tool_calls: false` | ❌ 不同步，同步即回退 |
| 安装器 hooks 部署的「哈希三态升级保护」 | 软件包仍是**无条件覆盖** | ✅ 同步（并做得更稳，见下） |

`83c0f53e…` 只把 `PreToolUse` / `PostToolUse` 改成了放行，**`SubagentStart` 仍写着
`emit(_ctx("SubagentStart", TOOL_LOCK))`**。独立包之所以没炸，只是因为它的 `hooks.json` 恰好没注册
`SubagentStart` —— 那是颗定时炸弹。软件包这份 `248ef68e…` 是三个工具事件全部放行的彻底版。

### 修复

- **内嵌 codex 包：安装器主动清理历史遗留的工具事件注册**
  - 合并逻辑只遍历**包内 hooks.json 声明过的事件**，而包内早已不声明 `PreToolUse`。
    结果是老用户 `~/.codex/hooks.json` 里从前几版留下的 `PreToolUse` / `SubagentStart` 条目
    **永远清不掉** —— 脚本换新了，注册却还挂着。
  - 现在 `[4/9]` 段显式遍历 `PreToolUse` / `PostToolUse` / `SubagentStart`，只摘掉 `ishii_auto_route` /
    `slo-runtime-hook` 的条目，**用户自己的 hook 原样保留**，并逐条打日志：
    ```
    [purge] legacy PreToolUse registration removed (anti-interleave)
    [purge] PostToolUse: removed 1 kit entr(ies), kept 1 user entr(ies)
    ```
- **内嵌 codex 包：hooks 脚本部署改「始终落修复版 + 备份 + 四态日志」**
  - 语义上仍是**无条件覆盖**（对「绝不能出问题」来说，保证旧夹层版必被替换比「尊重用户自定义」更重要），
    但补上了哈希比对与四态日志：`[deploy]` 不存在 · `[keep]` 已是最新 · `[upgrade]` 旧版被替换 ·
    `[force]` 指定强制。被替换的旧文件一律先备份到 `Backup\hooks\ishii_auto_route.py`。
- **内嵌 codex 包：装后反夹层硬自检**
  - `[9/9]` 新增两条 `throw`（不是告警）：部署后的 `hooks/ishii_auto_route.py` 若含
    `_ctx("PreToolUse"|"PostToolUse"|"SubagentStart"` 注入，或 `hooks.json` 的工具事件上仍挂着本 Kit 条目，
    **直接判定装包失败**，不给用户「以为装好了」的机会。

### 端到端实测抓到的两个真 bug（单元测试看不见）

沙盒里模拟「老用户升级」（hooks.json 有工具事件残留 + hooks 脚本是夹层版）跑真实安装器，连踩两坑：

1. **`ConvertFrom-Json` 的 PSCustomObject 删过一次键就拒绝再加键。**
   `[purge]` 用 `PSObject.Properties.Remove()` 摘掉工具事件后，合并循环里的
   `$targetHooks.hooks.PreCompact = $kept` 直接抛
   `Exception setting "PreCompact": The property 'PreCompact' can not be found on this object`，
   **整个装包失败**（比原来要修的 bug 还严重）。
   修法：先把 `hooks` 转成普通 hashtable，增删都自由。
2. **hashtable 的 `PSObject.Properties.Name` 看不到数据键。**
   它返回的是类型成员（`Count`/`Keys`/`Values`…），于是 `-contains 'PreToolUse'` 恒为 false ——
   `[purge]` 与装后自检**双双静默失效**（假阴性，日志里看着一切正常，实际残留原封不动）。
   修法：改用原生 `ContainsKey()`。

这两处都已沉淀成回归测试（对 `targetHooks.hooks` 不得使用 `PSObject.Properties.Name` / `.Remove`）。

### 验证

- 单元测试 **102/102** 通过（新增 6 条：清理顺序、四态日志、装后自检硬失败、包内脚本零注入、
  hashtable 转换、`ContainsKey` 用法）。
- `tsc --noEmit` 无错误；4 份 PowerShell 脚本 AST 解析全部 OK。
- **三场景真实安装器端到端**（`-CodexHome` 指向沙盒）：

  | 场景 | 结果 |
  | --- | --- |
  | 老用户升级（3 个工具事件残留 + 夹层版脚本） | `[purge]`×3 · `[upgrade]`/`[force]` · 自检通过 · 退出码 0 · 用户自定义 hook 保留 |
  | 全新安装（无 hooks.json / 无 hooks 目录） | `[deploy]` · 自检通过 · 退出码 0 |
  | 幂等重跑 | `[keep]` · 自检通过 · 退出码 0 |



---

## [1.3.5] — 2026-09-10

### 修复

- **内嵌 codex 包：`codex_app` 命名空间报错根治，软件安装路径不再漏修**
  - 现场：Codex 桌面端自带 bug —— 模型一旦调用 `tool_search`，整轮失败：
    `Duplicate namespace name 'codex_app' in input[N].tools[M]`；
    换法子压重名则撞上第二条 `Invalid schema for function 'codex_app::automation_update'`。
  - **真正的漏点**：软件安装 codex 包走的是 `DEPLOY_PLANS.codex.install`
    → **直调 `install-replica.ps1`**（`args: ['-NoOpenLinks']`），
    而命名空间修复此前只挂在 `Install-OneClick.cmd` 的 Step 0 上。
    结果是：手工跑 cmd 的有这道修复，**从软件里点「安装」的完全没有** —— 一用就撞 bug。
  - 现在把修复**内建进 `install-replica.ps1`**（新增 `[1.5/9] codex_app namespace fix`）：
    预检确认 Codex 主程序未运行（app.asar 可写）→ 对 `app.asar` 做 1 字节等长替换（flatten）。
    **幂等**（已打 / 无特征串 → SKIP，不动一个字节）、**非致命**（任何失败只告警，装包照常）、
    可 `-SkipNamespaceFix` 显式跳过。
  - 包内新增 `codex-namespace-fix\`（5 件：`FIX-NAMESPACE.cmd`、`一键修复Codex命名空间报错.cmd`、
    `patch_codex_asar_namespace.py`、`check_codex_flatten.py`、`说明.txt`），
    主脚本支持 `--find/--check/--auto/--audit/--jscheck/--selftest/--restore` 全参数。
  - `Install-OneClick.cmd` 同步升到 v9（Step 0 装包前先问一次 + `check_codex.ps1` 精确进程守卫），
    `README-CN.txt` 写入 v9 说明段。
  - 顺手加固：补丁脚本的调用**不接管道**。经管道会被宿主按控制台代码页解码再重编码，
    在**非中文系统区域**下这一步不可逆 —— 补丁脚本的 UTF-8 中文提示会变成乱码。现在字节直通。

- **回退检查：拒绝两处已发布修复被旧基线覆盖**
  - 新源包 `materials/` 基线停在 9/4–9/5（早于已发布修复），整体镜像会冲掉三处修复：
    ① `hooks.json` 重新出现 `PreToolUse` 事件；
    ② `ishii_auto_route.py` 重新在工具事件（`PreToolUse`/`SubagentStart`/`PostToolUse`）上注入
    `additionalContext` —— 会撕开 `tool_calls` → `tool-output` 相邻性，严格 Chat Completions
    提供方（DeepSeek）回 HTTP 400 `No tool output found for tool call`；
    ③ `models.json` 的 `supports_parallel_tool_calls` 回到 `true`。
  - 处置：镜像源包时**只取新增件**，上述三个文件保留已发布版本，并逐项断言未回退
    （`PreToolUse` 计数 = 0、`v7.3 FIX` ≥ 3、`TOOL_LOCK` 注入 = 0）。

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
