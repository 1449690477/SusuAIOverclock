import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Search, Library as LibraryIcon, Filter, Loader2, ArrowDownUp, CheckCircle2, AlertTriangle, X, Eye, Zap, FileText, ExternalLink } from 'lucide-react';
import type { LibraryItem, Pack } from '../types';

type SortKey = 'rate-desc' | 'rate-asc' | 'length-desc' | 'name-asc';

const PLATFORMS: { id: string; label: string; tone: string }[] = [
  { id: 'cursor',          label: 'Cursor',           tone: 'grape' },
  { id: 'codex',           label: 'Codex',            tone: 'soda' },
  { id: 'workbuddy',       label: 'WorkBuddy',        tone: 'yuzu' },
  { id: 'dsh',             label: 'DSH',              tone: 'sakura' },
  { id: 'opencode',        label: 'OpenCode',         tone: 'matcha' },
  { id: 'anti-gravity',    label: 'Anti-Gravity',     tone: 'kuromi' },
];

type Props = {
  packs: Pack[];
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void;
  onClose?: () => void;
};

export default function Library({ packs, toast, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [stats, setStats] = useState<{ total: number; categories: Record<string, number>; rates: Record<string, number>; source?: string } | null>(null);
  const [kw, setKw] = useState('');
  const [cat, setCat] = useState('');
  const [sort, setSort] = useState<SortKey>('rate-desc');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [detail, setDetail] = useState<{ idx: number; item: LibraryItem; content: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [pickPlatform, setPickPlatform] = useState<string>(PLATFORMS[0].id);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, st] = await Promise.all([window.dango?.libraryList(), window.dango?.libraryStats()]);
      if (list) setItems(list.prompts || []);
      if (st) setStats(st as any);
      if (!list?.ok) toast('info', '内嵌词库未加载，使用列表 API 兜底');
    } catch (e) {
      toast('err', '词库加载失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const k = kw.trim().toLowerCase();
    let arr = items;
    if (cat) arr = arr.filter((p) => (p.category_label || '通用安全') === cat);
    if (k) arr = arr.filter((p) =>
      (p.name || '').toLowerCase().includes(k) ||
      (p.desc || '').toLowerCase().includes(k) ||
      (p.content_preview || '').toLowerCase().includes(k)
    );
    const sorted = arr.slice();
    if (sort === 'rate-desc') sorted.sort((a, b) => (Number(b.success_rate) || 0) - (Number(a.success_rate) || 0));
    else if (sort === 'rate-asc') sorted.sort((a, b) => (Number(a.success_rate) || 0) - (Number(b.success_rate) || 0));
    else if (sort === 'length-desc') sorted.sort((a, b) => (Number(b.content_length) || 0) - (Number(a.content_length) || 0));
    else if (sort === 'name-asc') sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return sorted;
  }, [items, kw, cat, sort]);

  const togglePick = (idx: number) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const openDetail = async (idx: number, item: LibraryItem) => {
    setDetail({ idx, item, content: '加载中...' });
    try {
      const r = await window.dango?.libraryDetail(idx);
      if (r?.ok && r.detail?.content) {
        setDetail({ idx, item, content: r.detail.content });
      } else {
        setDetail({ idx, item, content: '获取失败：' + (r?.error || '未知') });
      }
    } catch (e) {
      setDetail({ idx, item, content: '加载异常：' + (e instanceof Error ? e.message : String(e)) });
    }
  };

  const injectOne = async (idx: number, item: LibraryItem) => {
    setImporting(true);
    try {
      const r = await window.dango?.libraryDetail(idx);
      if (!r?.ok || !r.detail?.content) throw new Error(r?.error || '内容为空');
      const res = await window.dango?.libraryImport({
        platformId: pickPlatform,
        index: idx,
        name: item.name,
        content: r.detail.content,
      });
      if (res?.ok) toast('ok', `已注入到 ${res.label}`);
      else throw new Error('注入失败');
    } catch (e) {
      toast('err', e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const injectBatch = async () => {
    if (picked.size === 0) { toast('info', '请先勾选词条'); return; }
    setImporting(true);
    let ok = 0, fail = 0;
    for (const idx of picked) {
      const item = items[idx];
      if (!item) continue;
      try {
        const r = await window.dango?.libraryDetail(idx);
        if (!r?.ok || !r.detail?.content) { fail++; continue; }
        await window.dango?.libraryImport({
          platformId: pickPlatform,
          index: idx,
          name: item.name,
          content: r.detail.content,
        });
        ok++;
      } catch { fail++; }
    }
    setImporting(false);
    toast(fail === 0 ? 'ok' : 'info', `批量注入完成：成功 ${ok} 条 / 失败 ${fail} 条`);
    setPicked(new Set());
  };

  const cats = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of items) {
      const c = p.category_label || '通用安全';
      map[c] = (map[c] || 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [items]);

  return (
    <div className="flex flex-col h-full bg-[#faf7f2] text-slate-800">
      <header className="px-6 py-4 border-b border-slate-200 bg-white flex items-center gap-3 shadow-sm">
        <LibraryIcon className="w-6 h-6 text-pink-500" />
        <div className="flex-1">
          <h2 className="text-lg font-semibold">智汇AI · 破甲词库</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {stats ? `共 ${stats.total} 条 · ${Object.keys(stats.categories).length} 个分类` : '加载中...'}
            {stats?.source === 'meta' && <span className="ml-2 text-amber-600">（仅元数据，注入时联网补全）</span>}
            {stats?.source === 'bundle' && <span className="ml-2 text-emerald-600">（完整快照，离线可用）</span>}
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded" title="关闭">
            <X className="w-5 h-5" />
          </button>
        )}
      </header>

      <div className="px-6 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="搜索名称、描述、内容..."
            className="flex-1 bg-transparent outline-none text-sm"
          />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Filter className="w-4 h-4 text-slate-400" />
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="bg-white border border-slate-200 rounded px-2 py-1.5 text-sm">
            <option value="">全部分类（{items.length}）</option>
            {cats.map(([c, n]) => <option key={c} value={c}>{c}（{n}）</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <ArrowDownUp className="w-4 h-4 text-slate-400" />
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="bg-white border border-slate-200 rounded px-2 py-1.5 text-sm">
            <option value="rate-desc">成功率 ↓（推荐优先）</option>
            <option value="rate-asc">成功率 ↑</option>
            <option value="length-desc">内容长度 ↓</option>
            <option value="name-asc">名称 A-Z</option>
          </select>
        </div>
      </div>

      <div className="px-6 py-2 bg-white border-b border-slate-200 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500 mr-2">注入到：</span>
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPickPlatform(p.id)}
            className={`px-3 py-1 rounded-full border transition ${pickPlatform === p.id ? 'bg-pink-500 text-white border-pink-500' : 'bg-white border-slate-200 hover:border-pink-300'}`}
          >
            {p.label}
          </button>
        ))}
        <div className="flex-1" />
        {picked.size > 0 && (
          <>
            <span className="text-pink-600 font-medium">已选 {picked.size} 条</span>
            <button
              disabled={importing}
              onClick={injectBatch}
              className="px-3 py-1 rounded bg-pink-500 text-white disabled:opacity-50"
            >
              {importing ? <Loader2 className="w-3 h-3 animate-spin inline" /> : <Zap className="w-3 h-3 inline" />}
              <span className="ml-1">批量注入</span>
            </button>
          </>
        )}
      </div>

      <main className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> 加载词库中...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400">暂无匹配的词条</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((item, i) => {
              const idx = items.indexOf(item);
              const rate = Number(item.success_rate) || 0;
              const rateColor = rate >= 90 ? 'text-emerald-600' : rate >= 80 ? 'text-amber-600' : 'text-slate-400';
              const isPicked = picked.has(idx);
              return (
                <div key={idx} className={`bg-white rounded-xl border transition p-4 ${isPicked ? 'border-pink-400 ring-2 ring-pink-100' : 'border-slate-200 hover:border-pink-300'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] px-2 py-0.5 rounded bg-pink-50 text-pink-600">
                      {item.category_label || '通用安全'}
                    </span>
                    <span className={`text-xs font-semibold ${rateColor}`}>
                      成功率 {rate > 0 ? `${rate}%` : 'n/a'}
                    </span>
                  </div>
                  <h3 className="font-semibold text-sm text-slate-800 line-clamp-2 mb-1">{item.name || '未命名'}</h3>
                  <p className="text-xs text-slate-500 line-clamp-3 mb-2 min-h-[2.5em]">{item.desc || '暂无描述'}</p>
                  <div className="text-[10px] text-slate-400 mb-3">
                    {item.source || '未知'} · {(item.content_length || 0).toLocaleString()} 字
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => togglePick(idx)}
                      className={`flex-1 text-xs py-1.5 rounded border ${isPicked ? 'bg-pink-500 text-white border-pink-500' : 'bg-white border-slate-200 hover:border-pink-300'}`}
                    >
                      {isPicked ? <><CheckCircle2 className="w-3 h-3 inline" /> 已选</> : '选择'}
                    </button>
                    <button onClick={() => openDetail(idx, item)} className="text-xs py-1.5 px-2 rounded bg-slate-100 hover:bg-slate-200" title="查看详情">
                      <Eye className="w-3 h-3 inline" />
                    </button>
                    <button
                      disabled={importing}
                      onClick={() => injectOne(idx, item)}
                      className="text-xs py-1.5 px-2 rounded bg-pink-500 text-white hover:bg-pink-600 disabled:opacity-50"
                      title="注入到选中平台"
                    >
                      <Zap className="w-3 h-3 inline" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <footer className="px-6 py-2 border-t border-slate-200 bg-white text-[10px] text-slate-400 flex items-center gap-2">
        <FileText className="w-3 h-3" />
        <span>词条来源：智汇AI 用户提示词库（{stats?.total || 0} 条 · 由 {PLATFORMS.find(p => p.id === pickPlatform)?.label} 接收）</span>
      </footer>

      {detail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-xl max-w-3xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <h3 className="font-semibold">{detail.item.name}</h3>
              <button onClick={() => setDetail(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 py-2 text-xs text-slate-500">
                {detail.item.category_label} · {detail.item.source} · {(detail.item.content_length || 0).toLocaleString()} 字
                <span className="ml-2 font-semibold text-pink-600">
                  成功率 {Number(detail.item.success_rate) || 0}%
                </span>
              </div>
            <div className="px-5 py-3 flex-1 overflow-auto">
              <pre className="text-xs whitespace-pre-wrap font-mono bg-slate-50 p-3 rounded border border-slate-200">
{detail.content}
              </pre>
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2">
              <button
                disabled={importing}
                onClick={async () => {
                  setImporting(true);
                  try {
                    const res = await window.dango?.libraryImport({
                      platformId: pickPlatform,
                      index: detail.idx,
                      name: detail.item.name,
                      content: detail.content,
                    });
                    if (res?.ok) { toast('ok', `已注入到 ${res.label}`); setDetail(null); }
                  } catch (e) { toast('err', e instanceof Error ? e.message : String(e)); }
                  finally { setImporting(false); }
                }}
                className="px-4 py-1.5 rounded bg-pink-500 text-white disabled:opacity-50"
              >
                {importing ? <Loader2 className="w-3 h-3 inline animate-spin" /> : <Zap className="w-3 h-3 inline" />}
                <span className="ml-1">注入到 {PLATFORMS.find(p => p.id === pickPlatform)?.label}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}