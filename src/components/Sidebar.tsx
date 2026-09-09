import React from 'react';
import { LayoutGrid, ScrollText, Settings as SettingsIcon, Library as LibraryIcon } from 'lucide-react';

export type View = 'toolbox' | 'library' | 'activity' | 'settings';

const ITEMS: { key: View; label: string; Icon: typeof LayoutGrid }[] = [
  { key: 'toolbox', label: '工具箱', Icon: LayoutGrid },
  { key: 'library', label: '破甲词库', Icon: LibraryIcon },
  { key: 'activity', label: '活动记录', Icon: ScrollText },
  { key: 'settings', label: '设置', Icon: SettingsIcon }
];

export default function Sidebar({ view, onChange, version }: { view: View; onChange: (v: View) => void; version: string }) {
  return (
    <aside className="sidebar">
      {ITEMS.map(({ key, label, Icon }) => (
        <button
          key={key}
          className={`nav-item${view === key ? ' active' : ''}`}
          onClick={() => onChange(key)}
          data-testid={`nav-${key}`}
        >
          <Icon size={16} />
          {label}
          <span className="dot" />
        </button>
      ))}
      <div className="sidebar-foot">
        苏苏 AI超频 v{version}
        <br />
        状态透视 · 会话监控
      </div>
    </aside>
  );
}
