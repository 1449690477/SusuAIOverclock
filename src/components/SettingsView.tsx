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
          发布允许包为 cursor / dsh / claude / opencode / workbuddy / workbuddy-ai。
          Codex、胖虎、反重力三个旧载荷随包内置（勾选知情后要有真实载荷才能安装），但默认阻断；
          更换根目录、导入目录或旧备份都不能解除阻断，
          只有在对应卡片上勾选「我知晓 同意」才会为该载荷解锁安装、卸载、备份、恢复与深度验证，撤销即恢复阻断。
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
          扫描与基线检查只读；安装/卸载会运行允许包的脚本，深度验证会启动客户端，备份/恢复与词库管理会写盘。
          隔离策略在主进程强制执行（勾选框只是入口，登记表在策略层），但不代表其他文件已通过恶意软件检测，也不代表用户目录已清理。
        </div>
      </div>
    </>
  );
}
