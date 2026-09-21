import React from 'react';
import { FileStack, Hash, Clock, Download, Trash2, ShieldCheck, CircleSlash, Radar, AlertTriangle } from 'lucide-react';
import type { Pack, PlatformInfo, BreakStatus, PlanInfo } from '../types';
import { baselineClass, BASELINE_LABEL, formatBytes, formatTime } from '../utils';

export default function PackCard({
  pack,
  platform,
  breakStatus,
  plan,
  icon,
  busy,
  onOpen,
  onDeploy,
  onDeepVerify,
  onConsent
}: {
  pack: Pack;
  platform?: PlatformInfo;
  breakStatus?: BreakStatus;
  plan?: PlanInfo;
  icon?: string | null;
  busy: boolean;
  onOpen: (p: Pack) => void;
  onDeploy: (id: string, action: 'install' | 'uninstall') => void;
  onDeepVerify?: (id: string) => void;
  onConsent?: (id: string, granted: boolean) => void;
}) {
  const active = breakStatus?.active;
  const blockedReason = pack.blockedReason || plan?.blockedReason;
  const consentRequired = Boolean(pack.consentRequired);
  const consented = Boolean(pack.consented);
  // 已解锁的隔离包：策略层不再返回 blockedReason，用 consented 单独标记
  const unlocked = consentRequired && consented && !blockedReason;

  const badgeClass = blockedReason
    ? 'badge-warn'
    : unlocked
      ? 'badge-accent'
      : active === true
        ? 'badge-ok'
        : active === false
          ? 'badge-warn'
          : 'badge-muted';
  const badgeText = blockedReason
    ? '已隔离 · 只读'
    : unlocked
      ? '隔离已解锁'
      : active === true
        ? '已生效'
        : active === false
          ? '未生效'
          : '无判定';

  return (
    <div
      className={`pack-card accent-${pack.accent}${pack.found ? '' : ' missing'}`}
      data-testid={`pack-card-${pack.id}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(pack)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(pack);
        }
      }}
    >
      <div className="pack-top">
        <div className="pack-icon" data-testid={`pack-icon-${pack.id}`}>
          {icon ? <img src={icon} alt="" width={30} height={30} /> : <span className="pack-icon-fallback">{pack.name.slice(0, 1)}</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="pack-name">{pack.name}</h3>
          <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>
            {platform?.displayName || pack.target}
            {platform?.installed ? ' · 已安装' : ' · 未检测到'}
          </div>
        </div>
        <span className={`badge ${badgeClass}`}>
          {!blockedReason && active === true ? <ShieldCheck size={11} /> : <CircleSlash size={11} />}
          {badgeText}
        </span>
      </div>

      <p className="pack-sub">{pack.subtitle}</p>

      {consentRequired ? (
        <div
          className={`consent-box${consented ? ' consent-ok' : ''}`}
          data-testid={`consent-${pack.id}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="consent-head">
            <AlertTriangle size={12} />
            {consented ? '已登记知情同意 · 隔离已解除' : '该载荷已隔离 · 需勾选知情同意'}
          </div>
          {pack.consentNotice ? <p className="consent-notice">{pack.consentNotice}</p> : null}
          <label className="consent-tick">
            <input
              type="checkbox"
              checked={consented}
              disabled={busy || !onConsent}
              onChange={(e) => onConsent?.(pack.id, e.target.checked)}
              data-testid={`consent-check-${pack.id}`}
            />
            <span>{pack.consentLabel || '我知晓 同意'}</span>
          </label>
          {blockedReason ? (
            <div className="consent-block" data-testid={`quarantine-${pack.id}`}>
              {blockedReason}
            </div>
          ) : null}
        </div>
      ) : blockedReason ? (
        <div className="warn-box" data-testid={`quarantine-${pack.id}`}>
          {blockedReason}
        </div>
      ) : null}

      <div className="pack-meta">
        <span>
          <Hash size={12} /> {pack.version ? `v${pack.version}` : '未标注'}
        </span>
        <span>
          <FileStack size={12} /> {pack.found ? `${pack.fileCount} 个文件` : '—'}
        </span>
        <span>
          <Clock size={12} /> {formatTime(pack.modifiedAt)}
        </span>
      </div>

      <div className="pack-foot" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className={`badge ${blockedReason ? 'badge-muted' : pack.found ? 'badge-ok' : 'badge-muted'}`}>
          {blockedReason ? '载荷已停用' : unlocked ? '载荷已解锁' : pack.found ? '目录已找到' : '目录未找到'}
        </span>
        {pack.source && pack.source !== 'none' && pack.source !== 'quarantined' ? (
          <span
            className={`badge ${
              pack.source === 'imported' ? 'badge-warn' : pack.source === 'embedded' ? 'badge-accent' : 'badge-muted'
            }`}
            data-testid={`source-${pack.id}`}
            title={pack.source === 'imported' ? '来自你导入的目录' : pack.source === 'embedded' ? '软件自带内嵌包' : '来自你选的根目录'}
          >
            {pack.source === 'imported' ? '导入' : pack.source === 'embedded' ? '内嵌' : '外部'}
          </span>
        ) : null}
        <span className={baselineClass(pack.lastResult)}>{BASELINE_LABEL[pack.lastResult]}</span>
      </div>

      <div className="pack-actions" onClick={(e) => e.stopPropagation()}>
        {onDeepVerify && (
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy || Boolean(blockedReason) || !pack.found}
            onClick={() => onDeepVerify(pack.id)}
            data-testid={`deep-verify-btn-${pack.id}`}
            title={blockedReason || 'L1-L4 四层穿透与模型问答监控'}
          >
            <Radar size={13} /> 监控
          </button>
        )}
        <button
          className="btn btn-mint btn-sm"
          disabled={busy || Boolean(blockedReason) || !pack.found || !plan?.hasInstall}
          onClick={() => onDeploy(pack.id, 'install')}
          data-testid={`install-${pack.id}`}
          title={blockedReason || (plan?.installFile ? `执行 ${plan.installFile}` : '无安装脚本')}
        >
          <Download size={13} /> 安装
        </button>
        <button
          className="btn btn-ghost btn-sm"
          disabled={busy || Boolean(blockedReason) || !pack.found || !plan?.hasUninstall}
          onClick={() => onDeploy(pack.id, 'uninstall')}
          data-testid={`uninstall-${pack.id}`}
          title={blockedReason || (plan?.uninstallFile ? `执行 ${plan.uninstallFile}` : '该包未提供卸载脚本')}
        >
          <Trash2 size={13} /> 卸载
        </button>
      </div>
    </div>
  );
}
