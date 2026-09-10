import type { BaselineResult } from './types';

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 目录状态与校验状态是两件独立的事，绝不合并成一个勾。
 */
export const FOLDER_LABEL: Record<string, string> = {
  found: '目录已找到',
  missing: '目录未找到'
};

export const BASELINE_LABEL: Record<BaselineResult, string> = {
  untracked: '未建立基线',
  recorded: '待检查',
  unchanged: '与基线一致',
  changed: '与基线不同'
};

export function baselineClass(r: BaselineResult): string {
  if (r === 'unchanged') return 'badge badge-ok';
  if (r === 'changed') return 'badge badge-warn';
  return 'badge badge-muted';
}
