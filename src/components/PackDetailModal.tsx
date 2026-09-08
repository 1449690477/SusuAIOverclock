import React from 'react';
import { X, FolderOpen, ShieldCheck, RefreshCcw, Trash2, Download, Save, Radar } from 'lucide-react';
import type { Pack, PlatformInfo, BreakStatus, PlanInfo } from '../types';
import { baselineClass, BASELINE_LABEL, formatBytes, formatTime } from '../utils';

function ChangeList({ title, items, cls }: { title: string; items: { path: string }[]; cls: string }) {
  if (!items || !items.length) return null;
  return (
    <div className="block">
      <h4>
        {title}（{items.length}）
      </h4>
      <div className="change-list">
        {items.slice(0, 80).map((it) => (
          <div className="change-item" key={it.path}>
            <span className={`tag ${cls}`}>{title.slice(0, 1)}</span>
            {it.path}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PackDetailModal({
  pack,
  platform,
  breakStatus,
  plan,
  busy,
  onClose,
  onCapture,
  onVerify,
  onClear,
  onOpenFolder,
  onDeploy,
  onBackup,
  onVerifyBreak,
  onDeepVerify
}: {
  pack: Pack;
  platform?: PlatformInfo;
  breakStatus?: BreakStatus;
  plan?: PlanInfo;
  busy: boolean;
  onClose: () => void;
  onCapture: (id: string) => void;
  onVerify: (id: string) => void;
  onClear: (id: string) => void;
  onOpenFolder: (id: string) => void;
  onDeploy: (id: string, action: 'install' | 'uninstall') => void;
  onBackup: (id: string) => void;
  onVerifyBreak: (id: string) => void;
  onDeepVerify: (id: string) => void;
}) {
  const d = pack.lastChanges;
  const active = breakStatus?.active;

  return (
    <div className="overlay" onClick={onClose} data-testid="pack-detail-modal">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div style={{ flex: 1 }}>
            <h2>{pack.name}</h2>
            <p>
              {pack.subtitle} · 目标 {platform?.displayName || pack.target}
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭详情" data-testid="detail-close">
            <X size={17} />
          </button>
        </div>

        {pack.note ? <div className="note-box">{pack.note}</div> : null}

        <div className="block">
          <h4>目标平台</h4>
          <div className="kv">
            <div className="kv-item">
              <div className="kv-k">软件是否安装</div>
              <div className="kv-v">{platform?.installed ? '已安装' : '未检测到'}</div>
            </div>
            <div className="kv-item">
              <div className="kv-k">可执行文件</div>
              <div className="kv-v" style={{ fontSize: 11 }}>
                {platform?.exePath ? platform.exePath.split(/[\\/]/).slice(-2).join('\\') : '—'}
              </div>
            </div>
            <div className="kv-item">
              <div className="kv-k">破甲是否生效</div>
              <div className="kv-v">
                {active === true ? '已生效' : active === false ? '未生效' : '无判定依据'}
              </div>
            </div>
            <div className="kv-item">
              <div className="kv-k">脚本</div>
              <div className="kv-v" style={{ fontSize: 11 }}>
                {plan?.installFile || '无安装'} / {plan?.uninstallFile || '无卸载'}
              </div>
            </div>
          </div>
        </div>

        {breakStatus?.items?.length ? (
          <div className="block">
            <h4>生效判定依据</h4>
            <div className="change-list">
              {breakStatus.items.map((it) => (
                <div className="change-item" key={it.label}>
                  <span className={`tag ${it.ok ? 'tag-add' : 'tag-del'}`}>{it.ok ? '命中' : '未中'}</span>
                  {it.label}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="warn-box">
          安装与卸载调用的是这个包目录里<strong>自带的脚本</strong>（{plan?.installFile || '无'} / {plan?.uninstallFile || '无'}），
          本软件不生成、不改写任何注入内容。执行过程与退出码在下方日志里完整可见。
        </div>

        <div className="kv">
          <div className="kv-item">
            <div className="kv-k">目录</div>
            <div className="kv-v">{pack.found ? '已找到' : '未找到'}</div>
          </div>
          <div className="kv-item">
            <div className="kv-k">版本</div>
            <div className="kv-v">{pack.version ? `v${pack.version}` : '未标注'}</div>
          </div>
          <div className="kv-item">
            <div className="kv-k">版本来源</div>
            <div className="kv-v">{pack.versionSource || '—'}</div>
          </div>
          <div className="kv-item">
            <div className="kv-k">文件数 / 目录数</div>
            <div className="kv-v">{pack.found ? `${pack.fileCount} / ${pack.dirCount}` : '—'}</div>
          </div>
          <div className="kv-item">
            <div className="kv-k">总体积</div>
            <div className="kv-v">{pack.found ? formatBytes(pack.bytes) : '—'}</div>
          </div>
          <div className="kv-item">
            <div className="kv-k">最近修改</div>
            <div className="kv-v">{formatTime(pack.modifiedAt)}</div>
          </div>
          <div className="kv-item">
            <div className="kv-k">基线快照</div>
            <div className="kv-v">{formatTime(pack.baselineAt)}</div>
          </div>
          <div className="kv-item">
            <div className="kv-k">最近检查</div>
            <div className="kv-v">{formatTime(pack.lastCheckedAt)}</div>
          </div>
        </div>

        <div className="block">
          <h4>两个独立状态（不合并）</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className={`badge ${pack.found ? 'badge-ok' : 'badge-muted'}`}>
              目录：{pack.found ? '已找到' : '未找到'}
            </span>
            <span className={baselineClass(pack.lastResult)}>校验：{BASELINE_LABEL[pack.lastResult]}</span>
            <span className={`badge ${active === true ? 'badge-ok' : active === false ? 'badge-warn' : 'badge-muted'}`}>
              破甲：{active === true ? '已生效' : active === false ? '未生效' : '无判定'}
            </span>
          </div>
        </div>

        {pack.path ? (
          <div className="block">
            <h4>完整路径</h4>
            <div className="change-item" style={{ fontSize: 12 }}>
              {pack.path}
            </div>
          </div>
        ) : null}

        <div className="block">
          <h4>预期条目</h4>
          <div className="entry-list">
            {pack.entries.length === 0 && !pack.missingEntries.length ? (
              <span className="entry">（目录为空或未扫描）</span>
            ) : null}
            {pack.entries.map((e) => (
              <span className="entry" key={e}>
                {e}
              </span>
            ))}
            {pack.missingEntries.map((e) => (
              <span className="entry missing" key={`missing-${e}`} title="预期存在但未找到">
                {e}
              </span>
            ))}
          </div>
        </div>

        {pack.warnings.length ? (
          <div className="block">
            <h4>提示</h4>
            <div className="warn-box" style={{ marginBottom: 0 }}>
              {pack.warnings.join('；')}
            </div>
          </div>
        ) : null}

        {d ? (
          <>
            <div className="block">
              <h4>最近一次检查</h4>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className="badge badge-muted">新增 {d.added?.length ?? 0}</span>
                <span className="badge badge-muted">删除 {d.removed?.length ?? 0}</span>
                <span className="badge badge-muted">修改 {d.modified?.length ?? 0}</span>
                <span className="badge badge-muted">未变 {d.unchanged ?? 0}</span>
                {d.truncated ? <span className="badge badge-warn">明细已截断</span> : null}
              </div>
            </div>
            <ChangeList title="新增" items={d.added} cls="tag-add" />
            <ChangeList title="删除" items={d.removed} cls="tag-del" />
            <ChangeList title="修改" items={d.modified} cls="tag-mod" />
          </>
        ) : null}

        <div className="modal-foot">
          <button
            className="btn btn-mint"
            disabled={busy || !pack.found || !plan?.hasInstall}
            onClick={() => onDeploy(pack.id, 'install')}
            data-testid="detail-install"
          >
            <Download size={14} /> 安装破甲
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy || !pack.found || !plan?.hasUninstall}
            onClick={() => onDeploy(pack.id, 'uninstall')}
            data-testid="detail-uninstall"
          >
            <Trash2 size={14} /> 卸载
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onBackup(pack.id)}>
            <Save size={13} /> 备份配置
          </button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onDeepVerify(pack.id)} data-testid="detail-deep-verify">
            <Radar size={13} /> 深度验证
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy || !pack.found}
            onClick={() => onCapture(pack.id)}
            data-testid="detail-capture"
          >
            <ShieldCheck size={13} /> 建立基线
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy || !pack.found || !pack.baselineAt}
            onClick={() => onVerify(pack.id)}
            data-testid="detail-verify"
          >
            <RefreshCcw size={13} /> 检查变更
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onClear(pack.id)}>
            清除基线
          </button>
          <button className="btn btn-ghost btn-sm" disabled={!pack.found} onClick={() => onOpenFolder(pack.id)}>
            <FolderOpen size={13} /> 打开文件夹
          </button>
        </div>
      </div>
    </div>
  );
}
