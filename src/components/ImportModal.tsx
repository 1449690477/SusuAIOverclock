import React, { useState } from 'react';
import { X, FolderSearch, Loader2, Package, FileText, AlertTriangle, CheckCircle2, FolderOpen } from 'lucide-react';
import type { Pack, ImportDetection } from '../types';

type Step = 'choose' | 'detecting' | 'result';

export default function ImportModal({
  packs,
  onClose,
  onChoosePath,
  onAnalyze,
  onImportDir,
  onImportFile,
  toast
}: {
  packs: Pack[];
  onClose: () => void;
  onChoosePath: (kind: 'file' | 'dir') => Promise<{ canceled: boolean; path?: string }>;
  onAnalyze: (p: string) => Promise<ImportDetection>;
  onImportDir: (p: string, platformId: string) => Promise<unknown>;
  onImportFile: (p: string, platformId: string) => Promise<unknown>;
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void;
}) {
  const [step, setStep] = useState<Step>('choose');
  const [inputPath, setInputPath] = useState('');
  const [det, setDet] = useState<ImportDetection | null>(null);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);

  const nameOf = (id?: string) => (id ? packs.find((p) => p.id === id)?.name || id : '—');
  const blockOf = (id?: string) => packs.find((p) => p.id === id)?.blockedReason;
  const selectedBlock = det?.blockedReason || det?.analysis?.blockedReason || blockOf(picked);

  const analyze = async (p: string) => {
    setInputPath(p);
    setStep('detecting');
    try {
      const d = await onAnalyze(p);
      setDet(d);
      // 单平台已识别：预选；unknown：预选最佳候选（但如果候选全部同分则不预选，避免误注入）
      if (d.kind === 'single' && d.platform) setPicked(d.platform);
      else if (d.candidates && d.candidates.length) {
        const top = d.candidates[0].score;
        const tied = d.candidates.filter((c) => c.score === top).length > 1;
        setPicked(tied || top === 0 ? '' : d.candidates[0].platform);
      } else setPicked('');
      setStep('result');
    } catch (e) {
      toast('err', e instanceof Error ? e.message : String(e));
      setStep('choose');
    }
  };

  const choose = async (kind: 'file' | 'dir') => {
    const r = await onChoosePath(kind);
    if (r.canceled || !r.path) return;
    await analyze(r.path);
  };

  const confirm = async () => {
    if (!det || !picked) return;
    if (selectedBlock) { toast('err', selectedBlock); return; }
    setBusy(true);
    try {
      if (det.inputKind === 'file') {
        await onImportFile(det.path, picked);
        toast('ok', `规则文件已注入 ${nameOf(picked)}`);
      } else {
        await onImportDir(det.path, picked);
        toast('ok', `已导入 ${nameOf(picked)}，之后安装将使用这个包`);
      }
      onClose();
    } catch (e) {
      toast('err', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const isFile = det?.inputKind === 'file';
  const canConfirm = Boolean(picked) && !selectedBlock;

  return (
    <div className="overlay" onClick={onClose} data-testid="import-modal">
      <div className="modal" style={{ width: 'min(660px, 100%)' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div style={{ flex: 1 }}>
            <h2>导入第三方破甲包</h2>
            <p>支持三种：单个规则文件 / 单个平台的包目录 / 含多个子目录的包根</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </div>

        {step === 'choose' ? (
          <div className="empty" style={{ padding: '32px 16px' }}>
            <FolderSearch size={44} color="var(--sakura)" />
            <h3 style={{ margin: '14px 0 8px' }}>选文件还是选目录？</h3>
            <p style={{ maxWidth: 440 }}>
              Windows 的文件对话框一次只能选一种，所以这里分成两个按钮。
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
              <button className="btn btn-primary" onClick={() => choose('file')} data-testid="import-choose-file">
                <FileText size={14} /> 选择单个规则文件
              </button>
              <button className="btn btn-mint" onClick={() => choose('dir')} data-testid="import-choose-dir">
                <FolderOpen size={14} /> 选择包目录
              </button>
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 14, lineHeight: 1.8, maxWidth: 460 }}>
              <b>单个规则文件</b>（.md / .mdc / .txt …）→ 直接注入到对应平台的规则位；<br />
              <b>包目录</b> → 注册为"用这个包"，之后安装 / 卸载 / 基线都走它。
              <br />隔离包禁止从这里导入；普通 Codex 文本规则仍可在独立词库页面管理。
            </p>
          </div>
        ) : null}

        {step === 'detecting' ? (
          <div className="v2-loading" style={{ padding: '40px 8px' }}>
            <Loader2 size={24} className="spin" />
            <div>
              <b>正在识别…</b>
              <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 4 }}>{inputPath}</div>
            </div>
          </div>
        ) : null}

        {step === 'result' && det ? (
          <>
            {selectedBlock ? <div className="warn-box" role="status">来源或目标已隔离：{selectedBlock}</div> : null}
            <div className="block">
              <div className="kv">
                <div className="kv-item">
                  <div className="kv-k">路径</div>
                  <div className="kv-v" style={{ fontSize: 11 }}>{det.path}</div>
                </div>
                <div className="kv-item">
                  <div className="kv-k">形态</div>
                  <div className="kv-v">
                    {det.kind === 'multi-root' ? '多包根目录' : isFile ? '单个规则文件' : '单平台包目录'}
                  </div>
                </div>
                <div className="kv-item">
                  <div className="kv-k">识别平台</div>
                  <div className="kv-v">{det.platform ? nameOf(det.platform) : '未识别'}</div>
                </div>
                <div className="kv-item">
                  <div className="kv-k">置信度</div>
                  <div className="kv-v">{det.confidence ? `${Math.round(det.confidence * 100)}%` : '—'}</div>
                </div>
              </div>
            </div>

            {det.kind === 'unknown' ? (
              <div className="warn-box">
                <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
                {det.canPickManually
                  ? '这是文本规则文件，但没能确定它属于哪个平台。下面选一个目标平台即可注入（打分仅供参考）。'
                  : '没能确定这是哪个平台的包。从下面候选里选一个（打分仅供参考）：'}
              </div>
            ) : null}

            {det.kind === 'multi-root' && det.platforms ? (
              <div className="block">
                <h4>检测到 {det.platforms.length} 个平台的包</h4>
                <div className="change-list" style={{ maxHeight: 240 }}>
                  {det.platforms.map((p) => (
                    <div className="change-item" key={p.platform} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Package size={13} />
                      <span style={{ flex: 1 }}>
                        <b>{nameOf(p.platform)}</b>
                        {p.analysis?.version ? ` · v${p.analysis.version}` : ''}
                        {p.blockedReason || p.analysis?.blockedReason || blockOf(p.platform)
                          ? <span style={{ display: 'block' }}>{p.blockedReason || p.analysis?.blockedReason || blockOf(p.platform)}</span>
                          : p.analysis?.missing?.length ? ` · 缺 ${p.analysis.missing.length} 项` : ' · 结构完整'}
                      </span>
                      <button
                        className="btn btn-mint btn-sm"
                        disabled={busy || Boolean(p.blockedReason || p.analysis?.blockedReason || blockOf(p.platform))}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await onImportDir(p.path, p.platform);
                            toast('ok', `已导入 ${nameOf(p.platform)}`);
                            onClose();
                          } catch (e) {
                            toast('err', e instanceof Error ? e.message : String(e));
                          } finally {
                            setBusy(false);
                          }
                        }}
                        data-testid={`import-multi-${p.platform}`}
                      >
                        导入
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {det.kind !== 'multi-root' ? (
              <>
                {det.analysis ? (
                  <div className="block">
                    <h4>包结构盘点</h4>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span className="badge badge-muted">版本 {det.analysis.version ? `v${det.analysis.version}` : '未标注'}</span>
                      <span className={`badge ${det.analysis.installScript ? 'badge-ok' : 'badge-warn'}`}>
                        安装脚本 {det.analysis.installScript || '无'}
                      </span>
                      <span className={`badge ${det.analysis.uninstallScript ? 'badge-ok' : 'badge-muted'}`}>
                        卸载脚本 {det.analysis.uninstallScript || '无'}
                      </span>
                      <span className={`badge ${det.analysis.missing?.length ? 'badge-warn' : 'badge-ok'}`}>
                        {det.analysis.blockedReason ? '已隔离，未分析载荷' : det.analysis.missing?.length ? `缺 ${det.analysis.missing.length} 项` : '结构完整'}
                      </span>
                    </div>
                  </div>
                ) : null}

                <div className="block">
                  <h4>{det.kind === 'unknown' ? '选择目标平台' : '确认为'}</h4>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {packs.map((p) => {
                      const cand = det.candidates?.find((c) => c.platform === p.id);
                      return (
                        <button
                          key={p.id}
                          className={`btn btn-sm ${picked === p.id ? 'btn-mint' : 'btn-ghost'}`}
                          disabled={busy || Boolean(p.blockedReason)}
                          title={p.blockedReason || undefined}
                          onClick={() => setPicked(p.id)}
                          data-testid={`import-pick-${p.id}`}
                        >
                          {p.name}{p.blockedReason ? '（已隔离）' : ''}
                          {cand ? ` (${cand.score})` : ''}
                        </button>
                      );
                    })}
                  </div>
                  {isFile ? (
                    <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 10, lineHeight: 1.7 }}>
                      <FileText size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
                      将把这个规则文件注入到 {nameOf(picked)} 的规则位（追加模式会先自动备份原文件）。
                    </p>
                  ) : (
                    <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 10, lineHeight: 1.7 }}>
                      <FolderOpen size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
                      将把 {nameOf(picked)} 的包目录指向这里；安装 / 卸载前仍会重新检查发布策略与来源，历史导入不能解除隔离。
                    </p>
                  )}
                </div>

                <div className="modal-foot">
                  <button className="btn btn-mint" disabled={busy || !canConfirm} onClick={confirm} data-testid="import-confirm">
                    <CheckCircle2 size={14} /> {isFile ? '确认注入' : '确认导入'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setStep('choose')} disabled={busy}>
                    重选
                  </button>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
