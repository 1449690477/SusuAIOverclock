import React from 'react';
import { formatTime } from '../utils';
import type { ActivityItem } from '../types';

const KIND_LABEL: Record<string, { text: string; color: string }> = {
  root: { text: '目录', color: 'var(--soda-deep, #2f9fd0)' },
  scan: { text: '扫描', color: '#6f5bbd' },
  baseline: { text: '基线', color: '#3fae72' },
  'verify-ok': { text: '校验', color: '#3fae72' },
  'verify-diff': { text: '变更', color: '#b57d16' },
  report: { text: '报告', color: '#e8607f' }
};

export default function ActivityView({ items }: { items: ActivityItem[] }) {
  return (
    <div className="panel">
      <h2>活动记录</h2>
      <p className="desc">
        只记录这个管理台自己做过的事：选目录、扫描、建立基线、检查变更、导出报告。
        它不知道、也不记录那七个包在别的软件里的运行情况。
      </p>
      {items.length === 0 ? (
        <p className="desc" style={{ margin: 0 }}>
          还没有任何操作记录。
        </p>
      ) : (
        items.map((it) => {
          const k = KIND_LABEL[it.kind] || { text: it.kind, color: 'var(--ink-soft)' };
          return (
            <div className="log-row" key={it.id} data-testid="activity-row">
              <span className="log-time">{formatTime(it.at)}</span>
              <span className="log-kind" style={{ color: k.color }}>
                {k.text}
              </span>
              <span className="log-text">{it.text}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
