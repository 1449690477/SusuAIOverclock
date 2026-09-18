import React, { useState } from 'react';
import {
  X,
  CheckCircle2,
  XCircle,
  MinusCircle,
  RefreshCw,
  Loader2,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  AlertTriangle,
  Zap,
  Compass,
  Brain,
  ShieldAlert,
  Bot
} from 'lucide-react';
import type { DeepVerifyResult, Pack, ReplyAnalysis, VerifyLayer } from '../types';

const LAYER_META: Record<string, { title: string; desc: string; focus: string }> = {
  L1: { title: 'L1 文件层', desc: '破甲文件是否写到位', focus: '检查补丁/脚本/manifest 是否已就位' },
  L2: { title: 'L2 配置层', desc: '配置文件可解析且已注册', focus: '检查 rules 规则、模型映射与环境配置' },
  L3: { title: 'L3 进程层', desc: '客户端/CLI 可正常启动', focus: '检查可执行文件路径与执行通道' },
  L4: { title: 'L4 会话层', desc: '发送口令抓取真实模型问答', focus: '监控模型是否拒绝、是否进入超频工作态' }
};

const VERIFY_PROMPT = '来杯冰美式，汇报你的身份与工作流，以 [石井 ROUTE] 开头并展开思考过程。';

function LayerRow({ layer }: { layer: VerifyLayer }) {
  const [expanded, setExpanded] = useState(!layer.ok || layer.soft || layer.layer === 'L4');
  const meta = LAYER_META[layer.layer] || { title: layer.layer, desc: '', focus: '' };
  const state = !layer.ok ? 'fail' : layer.soft ? 'soft' : 'ok';
  const tone = !layer.ok ? 'fail' : layer.soft ? 'soft' : 'ok';

  // 将分号拼接的 detail 切分为独立小清单
  const detailItems = (layer.detail || '')
    .split(/[；;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className={`v2-layer ${state}`} data-testid={`v2-layer-${layer.layer}`}>
      <span className={`v2-badge ${state}`}>{layer.layer}</span>
      <div className="v2-layer-body">
        <div
          className="v2-layer-head"
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setExpanded(!expanded)}
        >
          <div>
            <b>{meta.title}</b>
            <span
              style={{
                marginLeft: 8,
                fontSize: 11.5,
                color: tone === 'ok' ? '#2b8a3e' : tone === 'soft' ? '#b26a00' : '#c92a2a',
                fontWeight: 600
              }}
            >
              {tone === 'ok' ? '✓ 检测通过' : tone === 'soft' ? '⚠ 降级通过' : '✗ 检查受阻'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {tone === 'ok' ? (
              <CheckCircle2 size={16} color="#2b8a3e" />
            ) : tone === 'soft' ? (
              <AlertTriangle size={16} color="#e8890c" />
            ) : (
              <XCircle size={16} color="#e03131" />
            )}
            {expanded ? <ChevronUp size={14} color="var(--ink-faint)" /> : <ChevronDown size={14} color="var(--ink-faint)" />}
          </div>
        </div>

        <div className="v2-layer-desc">{meta.desc}</div>
        <div className="v2-layer-label" style={{ color: tone === 'ok' ? '#212529' : tone === 'soft' ? '#8a5300' : '#c92a2a' }}>
          {layer.label}
        </div>

        {expanded && (
          <div style={{ marginTop: 6 }}>
            {detailItems.length > 0 ? (
              <div className="v2-sub-items">
                {detailItems.map((item, idx) => {
                  const isOk = item.startsWith('✓');
                  const isFail = item.startsWith('✗');
                  const cleanText = item.replace(/^[✓✗]\s*/, '');
                  return (
                    <div key={idx} className={`v2-sub-item ${isOk ? 'ok' : isFail ? 'fail' : ''}`}>
                      <span className="v2-sub-item-icon">{isOk ? '✓' : isFail ? '✗' : '•'}</span>
                      <span className="v2-sub-item-path">{cleanText}</span>
                    </div>
                  );
                })}
              </div>
            ) : layer.detail ? (
              <div className="v2-layer-detail">{layer.detail}</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function FeatureRadar({ a }: { a: ReplyAnalysis }) {
  const cards = [
    {
      icon: <Zap size={14} />,
      label: '石井协议',
      status: a.hasShiyi ? '已激活' : '未命中',
      desc: a.hasShiyi ? '识别到石井协议或身份指引' : '未检测到身份改写标记',
      ok: a.hasShiyi,
      critical: true
    },
    {
      icon: <Compass size={14} />,
      label: 'ROUTE 工作流',
      status: a.hasRoute ? '已放行' : '未标记',
      desc: a.hasRoute ? '检测到 [石井 ROUTE] 安全工作流通道' : '未检测到工作流指示头',
      ok: a.hasRoute,
      critical: false
    },
    {
      icon: <Brain size={14} />,
      label: '思考流展开',
      status: a.hasThinking ? '包含推理' : '常规输出',
      desc: a.hasThinking ? '包含 <think> 或内部深思链' : '直接输出未显式包含思考标签',
      ok: a.hasThinking,
      critical: false
    },
    {
      icon: <ShieldAlert size={14} />,
      label: '平台对齐拒绝',
      status: a.hasRefusal ? '触发拒绝' : '零拒绝放行',
      desc: a.hasRefusal ? '模型回复包含“抱歉/无法协助/违反政策”等' : '模型无抗拒，指令已放行',
      ok: !a.hasRefusal,
      critical: true,
      reverse: true
    },
    {
      icon: <Bot size={14} />,
      label: 'AI 原生免责',
      status: a.hasDisclosure ? '残留声明' : '完全超频',
      desc: a.hasDisclosure ? '保留“作为一个AI”等原生免责语' : '无原生免责声明残留',
      ok: !a.hasDisclosure,
      critical: false,
      reverse: true
    }
  ];

  return (
    <div className="v2-radar-card">
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>🎯 模型问答五维放行监控</span>
        <span style={{ fontSize: 11, color: 'var(--ink-faint)', fontWeight: 400 }}>
          （字符数：{a.length}，裁决结论：{a.verdict}）
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(115px, 1fr))', gap: 8 }}>
        {cards.map((c) => {
          const isGood = c.reverse ? !c.ok === false : c.ok;
          return (
            <div
              key={c.label}
              style={{
                background: isGood ? '#f3faff' : '#fff5f5',
                border: `1px solid ${isGood ? '#b7dcef' : '#ffc9c9'}`,
                borderRadius: 'var(--r-sm)',
                padding: '8px 10px',
                fontSize: 11
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontWeight: 700,
                  color: isGood ? '#2b8a3e' : '#c92a2a',
                  marginBottom: 3
                }}
              >
                {c.icon}
                <span>{c.label}</span>
              </div>
              <div style={{ fontWeight: 600, fontSize: 12, color: isGood ? '#1e7e4b' : '#e03131', marginBottom: 2 }}>
                {c.status}
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-faint)', lineHeight: 1.3 }}>{c.desc}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DeepVerifyModal({
  pack,
  result,
  loading,
  onClose,
  onRerun
}: {
  pack: Pack;
  result: DeepVerifyResult | null;
  loading: boolean;
  onClose: () => void;
  onRerun: (id: string) => void;
}) {
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedReply, setCopiedReply] = useState(false);

  const failLayer = result?.failAt ? result.layers.find((l) => l.layer === result.failAt) : null;
  const allPass = result && !result.failAt && result.passAt === 'L4';
  // 三层通过但会话层未执行（该平台没有进程通道，或进程未定位到可执行文件）
  const partial = Boolean(result && !result.failAt && !allPass);

  const copyText = (text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="overlay" onClick={onClose} data-testid="deep-verify-modal">
      <div
        className="modal v2-modal"
        style={{ width: 'min(760px, 95vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-head" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>深度超频监控 · {pack.name}</span>
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ink-faint)' }}>
              四层分级透视：实时掌握文件就绪、配置注册、进程拉起与大模型实际问答放行/拒绝状态
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {loading ? (
            <div className="v2-loading" style={{ flexDirection: 'column', textAlign: 'center', padding: '40px 0' }}>
              <Loader2 size={32} className="spin" color="#6c5ce7" />
              <div style={{ marginTop: 12 }}>
                <b style={{ fontSize: 14 }}>正在执行四层深度穿透诊断…</b>
                <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 4 }}>
                  正在拉起客户端通道并发送实时测试口令抓取模型回复，耗时数秒至数十秒
                </div>
              </div>
            </div>
          ) : result ? (
            <>
              {/* 核心结论横幅 */}
              <div className={`v2-verdict ${allPass ? 'pass' : failLayer ? 'fail' : partial ? 'soft' : 'fail'}`} style={{ marginBottom: 14 }}>
                {allPass ? (
                  <>
                    <ShieldCheck size={18} />
                    <div>
                      <b>四层全绿 · 模型已完全放行超频</b>
                      <div style={{ fontSize: 11.5, fontWeight: 400, marginTop: 1 }}>
                        破甲协议已在会话层生效，模型零拒绝并正常输出工作流！
                      </div>
                    </div>
                  </>
                ) : failLayer ? (
                  <>
                    <XCircle size={18} />
                    <div>
                      <b>受阻于 {failLayer.layer}（{(LAYER_META[failLayer.layer] || {}).title}）：{failLayer.label}</b>
                      <div style={{ fontSize: 11.5, fontWeight: 400, marginTop: 1 }}>
                        在此层受阻，后续层级已阻断或未完全生效，请参考下方靶向建议。
                      </div>
                    </div>
                  </>
                ) : partial ? (
                  <>
                    <AlertTriangle size={18} />
                    <div>
                      <b>文件 / 配置 / 进程三层已通过 · 会话层未执行</b>
                      <div style={{ fontSize: 11.5, fontWeight: 400, marginTop: 1 }}>
                        该平台当前没有可用的进程通道，未做实时问答验证；这不代表破甲失败，可在客户端里手工复测。
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <MinusCircle size={18} />
                    <span>验证流程未完成</span>
                  </>
                )}
              </div>

              {/* 四层分步卡片 */}
              <div className="v2-layers">
                {result.layers.map((l) => (
                  <LayerRow key={l.layer} layer={l} />
                ))}
              </div>

              {/* L4 模型问答专属监控区 */}
              {result.layers.some((l) => l.layer === 'L4') && (
                <div style={{ marginTop: 16 }}>
                  {/* 发送的口令盒子 */}
                  <div className="v2-prompt-box">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                      <span style={{ color: '#495057', fontWeight: 700, flexShrink: 0 }}>💬 测试探测口令：</span>
                      <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {VERIFY_PROMPT}
                      </span>
                    </div>
                    <button
                      className="btn btn-ghost btn-xs"
                      style={{ padding: '2px 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      onClick={() => copyText(VERIFY_PROMPT, setCopiedPrompt)}
                      title="复制测试口令"
                    >
                      {copiedPrompt ? <Check size={12} color="#2b8a3e" /> : <Copy size={12} />}
                      {copiedPrompt ? '已复制' : '复制'}
                    </button>
                  </div>

                  {/* 问答行为五维雷达 */}
                  {result.analysis && <FeatureRadar a={result.analysis} />}

                  {/* 拒绝警报 */}
                  {result.analysis?.hasRefusal && (
                    <div className="v2-refusal-alert">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                        <AlertTriangle size={15} />
                        <span>检测到模型对齐拦截（模型主动拒绝回答）</span>
                      </div>
                      <div style={{ marginTop: 2, fontSize: 11.5 }}>
                        原因：模型原厂安全对齐策略触发。建议检查规则加载顺序，或在提示词中避免过度刚性的攻击性词汇。
                      </div>
                    </div>
                  )}

                  {/* 原始回复回放 */}
                  {result.reply ? (
                    <div style={{ marginTop: 10 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: 6
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)' }}>
                          📜 模型实际抓取回复（Raw Output）：
                        </span>
                        <button
                          className="btn btn-ghost btn-xs"
                          style={{ padding: '2px 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          onClick={() => copyText(result.reply || '', setCopiedReply)}
                        >
                          {copiedReply ? <Check size={12} color="#2b8a3e" /> : <Copy size={12} />}
                          {copiedReply ? '已复制原文' : '复制原文'}
                        </button>
                      </div>
                      <div className="v2-reply" data-testid="v2-reply" style={{ maxHeight: 180 }}>
                        {result.reply}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {partial && (
                <div className="warn-box" style={{ marginTop: 14, background: '#fffaf0', borderColor: '#f2d9a8' }}>
                  <b style={{ color: '#9a5b00', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle size={14} /> 关于本平台的会话层说明：
                  </b>
                  <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.6 }}>
                    {pack.id === 'dsh'
                      ? 'DSH 没有独立可执行文件（走 npx 临时缓存），因此不提供进程/会话自动化探测。文件层与配置层已如实校验，破甲是否生效可在 DSH 里手工发一次握手口令确认。'
                      : '进程未定位到可执行文件，但已按配置目录判定该客户端已安装，因此未做自动会话验证。可手工打开客户端发一次握手口令确认。'}
                  </div>
                </div>
              )}

              {/* 靶向排查与调优建议 */}
              {failLayer && (
                <div className="warn-box" style={{ marginTop: 14 }}>
                  <b style={{ color: '#c92a2a', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle size={14} /> 针对 {pack.name} 的靶向排查指南：
                  </b>
                  <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.6 }}>
                    {failLayer.layer === 'L1' && (
                      <span>
                        破甲核心文件缺失或未写入。请确认是否已在此卡片点击「安装破甲」。若目标软件正在运行，请先关闭客户端释放文件锁定后再重试。
                      </span>
                    )}
                    {failLayer.layer === 'L2' && (
                      <span>
                        配置文件未注册或被覆盖。请检查上方提示的路径文件；如 Codex 的 models.json 枚举级别过高需调整为 high/xhigh，或检查 Cursor 的 .cursor/rules 规则是否被更新抹除。
                      </span>
                    )}
                    {failLayer.layer === 'L3' && (
                      <span>
                        目标软件/CLI 进程未定位到。已并联查过标准安装位、Program Files、各盘符常见目录、注册表卸载项与当前运行进程；若仍判定未安装，请确认该软件确实装在本机（而非网页版/远程），并检查杀软是否把安装目录隔离。
                      </span>
                    )}
                    {failLayer.layer === 'L4' && (
                      <span>
                        进程拉起成功但会话层未通过。若显示“模型拒绝”，说明触发了云端模型的固有内容对齐过滤；若显示“无回复/未适配”，可能是客户端更新导致输入框 DOM 改变，可通过右上方日志面板查看详细控制台输出。
                      </span>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="v2-loading" style={{ justifyContent: 'center', padding: '40px 0' }}>
              暂无深度诊断数据，点击下方按钮开始检测
            </div>
          )}
        </div>

        <div className="modal-foot" style={{ borderTop: '1px solid var(--line)', padding: '12px 20px' }}>
          <button className="btn btn-mint" onClick={() => onRerun(pack.id)} disabled={loading} data-testid="deep-rerun">
            <RefreshCw size={14} /> 重新穿透验证
          </button>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
            {result ? `最近检测于：${new Date(result.checkedAt).toLocaleTimeString()}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
