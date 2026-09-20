'use strict';

// Pure, immutable release policy. No state, environment, payloads or dependencies
// may extend this allowlist. Build tooling can require this file without core.
const RELEASE_PACK_IDS = Object.freeze(['cursor', 'dsh', 'opencode', 'workbuddy', 'workbuddy-ai']);
const RESTORE_SOURCE_WARNING = '恢复源不可信（restore-source-not-trusted）：旧备份、外部目录、导入副本和历史内嵌包均不得用于恢复该载荷。隔离不代表用户目录已清理。';
const QUARANTINED_PACKS = Object.freeze({
  codex: `Codex 冷咖啡石井旧载荷已从发布范围移除并隔离：slo-runtime-hook.exe 已知受文件前置感染影响。禁止安装、卸载脚本、深度验证、复制和恢复。${RESTORE_SOURCE_WARNING}`,
  'codex-panghu': `Codex 胖虎旧载荷已隔离：随包 python.exe 及 venv 启动器已知受感染影响。禁止安装、卸载脚本、深度验证、复制和恢复。${RESTORE_SOURCE_WARNING}`,
  'anti-gravity': `反重力旧载荷已隔离：antigravity-oauth-proxy.exe 已知受感染影响。禁止安装、卸载脚本、深度验证、复制和恢复。${RESTORE_SOURCE_WARNING}`
});

function getPackBlockReason(id) {
  if (typeof id === 'string' && Object.prototype.hasOwnProperty.call(QUARANTINED_PACKS, id)) return QUARANTINED_PACKS[id];
  return RELEASE_PACK_IDS.includes(id) ? null : '该包不在当前发布允许列表中，已禁止部署。';
}

function assertPackAllowed(id) {
  const reason = getPackBlockReason(id);
  if (reason) {
    const error = new Error(reason);
    error.code = 'ERR_PACK_QUARANTINED';
    throw error;
  }
}

function getDeployPlanInfo(id, plan = {}) {
  const blockedReason = getPackBlockReason(id);
  return Object.freeze({
    blockedReason,
    hasInstall: !blockedReason && Boolean(plan.install),
    hasUninstall: !blockedReason && Boolean(plan.uninstall),
    installFile: !blockedReason && plan.install ? plan.install.file : null,
    uninstallFile: !blockedReason && plan.uninstall ? plan.uninstall.file : null
  });
}

function assertBackupAllowed(id, name) {
  assertPackAllowed(id);
  const match = typeof name === 'string' && /^([a-z-]+)-\d{8}-\d{6}$/.exec(name);
  if (!match) throw new Error('备份名不合法');
  assertPackAllowed(match[1]);
  if (match[1] !== id) throw new Error('备份不属于所选包，禁止跨包恢复');
}

// Known source names only, not an antivirus verdict. Covers renamed registrations
// whose source still contains a quarantined tree/launcher. No content is executed.
// codex-instruct.py is also used by independent Python skill scripts. Match the
// confirmed keysmith release/wrapper, not that generic name or a plain .md name.
function getSourceNameBlockReason(value) {
  for (const part of String(value).split(/[\\/]+/)) {
    const name = part.toLowerCase().replace(/[ .]+$/, '');
    let id = null;
    if (/^(?:\.?codex|codex 破|codex-macos|codex-break-kit(?:-v[\d.]+)?)$/.test(name) || /^(?:slo-runtime(?:-hook\.exe)?|install-replica\.ps1)$/.test(name)) id = 'codex';
    else if (/^(?:codex-panghu|keysmith|keysmith_windows_compat\.py|codex-instruct-v0\.5\.0\.py)$/.test(name)) id = 'codex-panghu';
    else if (/^(?:anti-gravity(?:-shiyi-kit)?|antigravity-oauth-proxy\.exe|install-antigravity\.ps1)$/.test(name)) id = 'anti-gravity';
    if (id) return QUARANTINED_PACKS[id];
  }
  return null;
}

module.exports = Object.freeze({
  RELEASE_PACK_IDS, QUARANTINED_PACKS, RESTORE_SOURCE_WARNING,
  getPackBlockReason, assertPackAllowed, getDeployPlanInfo, assertBackupAllowed, getSourceNameBlockReason
});
