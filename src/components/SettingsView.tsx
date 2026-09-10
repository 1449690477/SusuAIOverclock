import React from 'react';
import { FolderSearch, ExternalLink, FileDown, Info } from 'lucide-react';
import type { Hub } from '../types';
import { formatTime } from '../utils';

export default function SettingsView({
  hub,
  onChooseRoot,
  onClearRoot,
  onOpenRoot,
  onExport,
  reducedMotion,
  setReducedMotion
}: {
  hub: Hub;
  onChooseRoot: () => void;
  onClearRoot?: () => void;
  onOpenRoot: () => void;
  onExport: () => void;
  reducedMotion: boolean;
  setReducedMotion: (v: boolean) => void;
}) {
  return (
    <>
      <div className="panel" style={{ marginBottom: 18 }}>
        <h2>根目录</h2>
        <p className="desc">
          这七个工具包必须在同一个父目录下，各自一个子文件夹（codex / codex-panghu / cursor / dsh / opencode / workbuddy /
          anti-gravity）。本软件本体不含这些包，换台电脑重新选一次目录即可。
        </p>

        <div className="setting-row">
          <div className="info">
            <b>当前根目录</b>
            <span>{hub.root || '尚未选择'}</span>
          </div>
          <button className="btn btn-sm" onClick={onChooseRoot} data-testid="settings-choose-root">
            <FolderSearch size={13} /> 重新选择
          </button>
          {hub.root && onClearRoot && (
            <button className="btn btn-ghost btn-sm" onClick={onClearRoot} data-testid="settings-clear-root">
              清除根目录
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onOpenRoot} disabled={!hub.root}>
            <ExternalLink size={13} /> 打开
          </button>
        </div>

        <div className="setting-row">
          <div className="info">
            <b>最近扫描</b>
            <span>{formatTime(hub.lastScanAt)}</span>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 18 }}>
        <h2>报告与数据</h2>
        <p className="desc">导出一份 Markdown 检查报告，包含每个包的体积、文件数、版本来源与最近一次比对结果。</p>
        <div className="setting-row">
          <div className="info">
            <b>检查报告</b>
            <span>导出到你自己选择的位置</span>
          </div>
          <button className="btn btn-mint btn-sm" onClick={onExport}>
            <FileDown size={13} /> 导出报告
          </button>
        </div>
        <div className="setting-row">
          <div className="info">
            <b>本软件的数据目录</b>
            <span>{hub.userDir}</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>界面</h2>
        <div className="setting-row">
          <div className="info">
            <b>减少动效</b>
            <span>关闭小猫摇摆与卡片浮动动画</span>
          </div>
          <button
            className="btn btn-sm"
            onClick={() => setReducedMotion(!reducedMotion)}
            data-testid="settings-reduced-motion"
          >
            {reducedMotion ? '已开启' : '已关闭'}
          </button>
        </div>

        <div className="note-box" style={{ marginTop: 16, marginBottom: 0 }}>
          <Info size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
          这个管理台是只读的：它不写入被管理的目录，也不执行里面的任何 .ps1 / .cmd / .bat / .py 脚本。
          安装、卸载、验证效果这类操作，需要你在对应软件里按各自包的说明自行处理。
        </div>
      </div>
    </>
  );
}
