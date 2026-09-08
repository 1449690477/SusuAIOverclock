import React from 'react';
import type { ProgressPayload } from '../types';

export default function ProgressBar({ p }: { p: ProgressPayload }) {
  if (!p || (!p.busy && !p.stage)) return null;
  const total = p.total || 0;
  const value = p.value || 0;
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  const label = p.stage === 'collect' ? '正在枚举文件' : p.stage === 'hash' ? '正在计算哈希' : '处理中';

  return (
    <div className="progress" data-testid="progress-bar">
      <div className="progress-label">
        <span>
          {label} {total > 0 ? `${value} / ${total}` : ''}
        </span>
        <span className="cur">{p.current || ''}</span>
      </div>
      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
