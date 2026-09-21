'use strict';

// Release policy. The constant maps below are frozen and may only be changed in
// source. The one piece of mutable state is the per-id quarantine consent
// register: it is written exclusively through setQuarantineConsent /
// grantQuarantineConsent / revokeQuarantineConsent, only accepts ids that exist
// in QUARANTINED_PACKS, and defaults to empty. With an empty register every
// function here behaves exactly as the previous hard-quarantine policy: the
// blocked reason is returned, assert* throw, and no plan reports install.
// Build tooling can require this file without core.
const RELEASE_PACK_IDS = Object.freeze(['cursor', 'dsh', 'claude', 'opencode', 'workbuddy', 'workbuddy-ai']);
const RESTORE_SOURCE_WARNING = '恢复源不可信（restore-source-not-trusted）：旧备份、外部目录、导入副本和历史内嵌包均不作为该载荷的可信恢复源。隔离不代表用户目录已清理。';
const QUARANTINED_PACKS = Object.freeze({
  codex: `Codex 冷咖啡石井旧载荷已隔离：slo-runtime-hook.exe 曾被列为不可信样本，随包内置。默认阻断安装、卸载脚本、深度验证、复制和恢复；勾选「我知晓 同意」后解锁。${RESTORE_SOURCE_WARNING}`,
  'codex-panghu': `Codex 胖虎旧载荷已隔离：随包 python.exe 及 venv 启动器曾被列为不可信样本，随包内置。默认阻断安装、卸载脚本、深度验证、复制和恢复；勾选「我知晓 同意」后解锁。${RESTORE_SOURCE_WARNING}`,
  'anti-gravity': `反重力旧载荷已隔离：antigravity-oauth-proxy.exe 曾被列为不可信样本，随包内置。默认阻断安装、卸载脚本、深度验证、复制和恢复；勾选「我知晓 同意」后解锁。${RESTORE_SOURCE_WARNING}`
});

// Every pack directory that ships inside the portable artifact. The quarantined
// three are distributed too — but only so that a user who ticks the consent box
// has an actual payload to install. Distribution is not a safety verdict:
// RELEASE_PACK_IDS stays the deploy allowlist, and getPackBlockReason() still
// blocks the quarantined ids until consent is registered.
const DISTRIBUTED_PACK_IDS = Object.freeze([
  ...RELEASE_PACK_IDS,
  ...Object.keys(QUARANTINED_PACKS)
]);

// Not a safety verdict: this is the exact text the user must tick. Keeping it
// here (not in the renderer) means the same wording is shown and persisted.
const QUARANTINE_CONSENT_LABEL = '我知晓 同意';
const QUARANTINE_CONSENT_NOTICE = `知情同意（consent-required）：上面列出的受影响文件、不可信恢复源与"用户目录未清理"这三条前提我都已读到。软件不再强制隔离该旧载荷，但也只在我勾选本项之后才解锁它的安装、卸载、备份、恢复与深度验证。隔离原本就不等于安全认证，解锁同样不是；同意只是把决定权交回给我。`;

function isQuarantinedId(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(QUARANTINED_PACKS, id);
}

const CONSENTED_QUARANTINE_IDS = new Set();

/** 同意登记：只接受 QUARANTINED_PACKS 的 id，其它值（含未知、原型键、非字符串）一律拒绝。 */
function setQuarantineConsent(ids) {
  if (!Array.isArray(ids)) throw new TypeError('同意登记必须是数组');
  const next = new Set();
  for (const id of ids) {
    if (!isQuarantinedId(id)) throw new Error(`不是已隔离的包，无法登记同意：${String(id)}`);
    next.add(id);
  }
  CONSENTED_QUARANTINE_IDS.clear();
  for (const id of next) CONSENTED_QUARANTINE_IDS.add(id);
  return grantedQuarantineIds();
}

function grantQuarantineConsent(id) {
  if (!isQuarantinedId(id)) throw new Error(`不是已隔离的包，无法登记同意：${String(id)}`);
  CONSENTED_QUARANTINE_IDS.add(id);
  return grantedQuarantineIds();
}

function revokeQuarantineConsent(id) {
  CONSENTED_QUARANTINE_IDS.delete(id);
  return grantedQuarantineIds();
}

function grantedQuarantineIds() {
  return Object.freeze([...CONSENTED_QUARANTINE_IDS]);
}

function hasQuarantineConsent(id) {
  return isQuarantinedId(id) && CONSENTED_QUARANTINE_IDS.has(id);
}

function getPackBlockReason(id) {
  if (isQuarantinedId(id)) return CONSENTED_QUARANTINE_IDS.has(id) ? null : QUARANTINED_PACKS[id];
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
function getSourceNameMatchId(value) {
  for (const part of String(value).split(/[\\/]+/)) {
    const name = part.toLowerCase().replace(/[ .]+$/, '');
    if (/^(?:\.?codex|codex 破|codex-macos|codex-break-kit(?:-v[\d.]+)?)$/.test(name) || /^(?:slo-runtime(?:-hook\.exe)?|install-replica\.ps1)$/.test(name)) return 'codex';
    if (/^(?:codex-panghu|keysmith|keysmith_windows_compat\.py|codex-instruct-v0\.5\.0\.py)$/.test(name)) return 'codex-panghu';
    if (/^(?:anti-gravity(?:-shiyi-kit)?|antigravity-oauth-proxy\.exe|install-antigravity\.ps1)$/.test(name)) return 'anti-gravity';
  }
  return null;
}

function getSourceNameBlockReason(value) {
  const id = getSourceNameMatchId(value);
  return id ? QUARANTINED_PACKS[id] : null;
}

module.exports = Object.freeze({
  RELEASE_PACK_IDS, DISTRIBUTED_PACK_IDS, QUARANTINED_PACKS, RESTORE_SOURCE_WARNING,
  QUARANTINE_CONSENT_LABEL, QUARANTINE_CONSENT_NOTICE,
  isQuarantinedId, setQuarantineConsent, grantQuarantineConsent, revokeQuarantineConsent,
  grantedQuarantineIds, hasQuarantineConsent,
  getPackBlockReason, assertPackAllowed, getDeployPlanInfo, assertBackupAllowed,
  getSourceNameMatchId, getSourceNameBlockReason
});
