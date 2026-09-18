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
          八大 AI 工具包的一键部署、基线对比与大模型会话超频监控台。支持真实图标提取、一键调用包内脚本、四层穿透透视（文件/配置/进程/模型会话问答放行与拒绝分析）。
        </p>
        <p style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-faint)' }}>
          当前根目录：{root || '（尚未选择）'} · 最近扫描：{formatTime(lastScanAt)}
        </p>
      </div>
      <div className="hero-stats">
        <div className="stat">
          <div className="stat-num">{found}/6</div>
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
