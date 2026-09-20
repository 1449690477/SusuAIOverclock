import React from 'react';
import MascotCat from './MascotCat';
import { formatTime } from '../utils';
import type { Pack } from '../types';

export default function Hero({ packs, lastScanAt, root }: { packs: Pack[]; lastScanAt: string | null; root: string | null }) {
  const found = packs.filter((p) => p.found).length;
  const based = packs.filter((p) => p.baselineAt).length;
  const diffed = packs.filter((p) => p.lastResult === 'changed').length;

  return (
    <div className="hero">
      <div className="hero-sheen" aria-hidden="true" />
      <div className="hero-sparkles" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <MascotCat size={86} />
      <div className="hero-text">
        <h1>苏苏 AI超频 · Susu AI Overclock</h1>
        <p>
          五个发布包保留部署与管理；Codex、胖虎、反重力旧载荷已隔离。平台检测与普通文本词库独立保留，批量部署自动排除隔离项。
        </p>
        <p style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-faint)' }}>
          当前根目录：{root || '（尚未选择）'} · 最近扫描：{formatTime(lastScanAt)}
        </p>
      </div>
      <div className="hero-stats">
        <div className="stat">
          <div className="stat-num">{found}/{packs.length || 8}</div>
          <div className="stat-label">目录已找到</div>
        </div>
        <div className="stat">
          <div className="stat-num">{based}</div>
          <div className="stat-label">已建基线</div>
        </div>
        <div className="stat" style={{ background: diffed ? 'var(--yuzu-soft)' : undefined }}>
          <div className="stat-num">{diffed}</div>
          <div className="stat-label">与基线不同</div>
        </div>
      </div>
    </div>
  );
}
