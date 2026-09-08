import React, { useEffect, useRef } from 'react';
import { X, Eraser, Copy } from 'lucide-react';
import type { LogLine } from '../types';

const KIND_CLASS: Record<string, string> = {
  cmd: 'log-cmd',
  sys: 'log-sys',
  out: 'log-out',
  err: 'log-err',
  ok: 'log-ok',
  fail: 'log-fail',
  warn: 'log-warn'
};

export default function ConsolePanel({
  lines,
  running,
  onClear,
  onCancel,
  onClose
}: {
  lines: LogLine[];
  running: boolean;
  onClear: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const copyAll = () => {
    const text = lines.map((l) => l.line).join('\n');
    if (navigator.clipboard) navigator.clipboard.writeText(text);
  };

  return (
    <div className="console" data-testid="console-panel">
      <div className="console-head">
        <span className={`console-dot${running ? ' live' : ''}`} />
        <b>执行日志</b>
        <span className="console-count">{lines.length} 行</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {running ? (
            <button className="btn btn-ghost btn-sm" onClick={onCancel} data-testid="console-cancel">
              中止
            </button>
          ) : null}
          <button className="btn btn-ghost btn-sm" onClick={copyAll}>
            <Copy size={12} /> 复制
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onClear}>
            <Eraser size={12} /> 清空
          </button>
          <button className="modal-close" style={{ width: 28, height: 28 }} onClick={onClose} aria-label="关闭日志">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="console-body" ref={boxRef}>
        {lines.length === 0 ? (
          <div className="console-empty">点「安装」或「卸载」后，这里会实时显示脚本输出。</div>
        ) : (
          lines.map((l, i) => (
            <div className={`console-line ${KIND_CLASS[l.kind] || 'log-out'}`} key={`${i}-${l.line.slice(0, 12)}`}>
              {l.line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
