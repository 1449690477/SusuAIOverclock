import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, Library as LibraryIcon, Loader2, Zap, Eye, Star, X, Copy, Check,
  RefreshCw, FolderOpen, Trash2, ChevronLeft, ChevronRight, SlidersHorizontal,
  BookOpen, Settings2, Crosshair, AlertTriangle, FileText, CheckCircle2,
  ShieldCheck, ShieldAlert, ShieldQuestion, Replace, PlusCircle, RotateCcw
} from 'lucide-react';
import type {
  LibraryItem, LibraryStatsResult, LibraryTargetInfo, InjectionItem, InjectionsResult,
  LibraryHistoryItem
} from '../types';

/* ------------------------------------------------------------------ 常量 */

const PAGE_SIZE = 24;
const FAV_KEY = 'dango.library.favorites';
const PLAT_KEY = 'dango.library.platform';
const MODE_KEY = 'dango.library.injectMode';

type Tab = 'browse' | 'manage' | 'guide';
type SortKey = 'rate-desc' | 'rate-asc' | 'len-desc' | 'len-asc' | 'name-asc' | 'index-asc';
type RateFilter = '' | '90' | '80' | '70' | 'none';
type InjectMode = 'replace' | 'append';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'rate-desc', label: '成功率从高到低' },
  { key: 'rate-asc', label: '成功率从低到高' },
  { key: 'len-desc', label: '内容长度从长到短' },
  { key: 'len-asc', label: '内容长度从短到长' },
  { key: 'name-asc', label: '名称 A-Z' },
  { key: 'index-asc', label: '原始顺序' }
];

const PLAT_LABEL: Record<string, string> = {
  cursor: 'Cursor',
  codex: 'Codex',
  dsh: 'DSH',
  workbuddy: 'WorkBuddy',
  opencode: 'OpenCode',
  'anti-gravity': 'Anti-Gravity'
};

function rateClass(r: number): string {
  if (r >= 90) return 'lib-rate hi';
  if (r >= 70) return 'lib-rate mid';
  return 'lib-rate low';
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtAgo(iso?: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

function loadFavs(): number[] {
  try {
    const raw = window.localStorage.getItem(FAV_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => Number.isInteger(x)) : [];
  } catch { return []; }
}

function loadPlat(fallback: string): string {
  try { return window.localStorage.getItem(PLAT_KEY) || fallback; } catch { return fallback; }
}

function loadInjectMode(): InjectMode {
  try { return window.localStorage.getItem(MODE_KEY) === 'append' ? 'append' : 'replace'; } catch { return 'replace'; }
}

/* ------------------------------------------------------------------ 小组件 */

/** 平台破甲层状态徽章 */
function BreakBadge({ active }: { active?: boolean | null }) {
  if (active === true) return <span className="badge badge-ok" title="该平台破甲层已生效"><ShieldCheck size={11} /> 破甲生效</span>;
  if (active === false) return <span className="badge badge-warn" title="未检测到破甲生效标记，注入词库前建议先装破甲包"><ShieldAlert size={11} /> 破甲未生效</span>;
  return <span className="badge badge-muted" title="无判定依据"><ShieldQuestion size={11} /> 无判定</span>;
}

/** 单块注入复核徽章 */
function VerifyBadge({ v }: { v?: InjectionItem['verify'] }) {
  if (!v) return null;
  if (v.verdict === 'active') return <span className="badge badge-ok" title="标记块在位且内容与注入时一致"><ShieldCheck size={11} /> 生效中</span>;
  if (v.verdict === 'drifted') return <span className="badge badge-warn" title="标记块还在但内容被改过（客户端重写或手动编辑），可重新注入恢复"><ShieldAlert size={11} /> 内容漂移</span>;
  return <span className="badge badge-warn" title="标记块已从文件中消失"><ShieldAlert size={11} /> 已丢失</span>;
}

/* ------------------------------------------------------------------ 主组件 */

type Props = {
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void;
};

export default function Library({ toast }: Props) {
  const api = window.dango;

  /* ---- 数据 ---- */
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [stats, setStats] = useState<LibraryStatsResult | null>(null);
  const [targets, setTargets] = useState<LibraryTargetInfo[]>([]);

  /* ---- 浏览状态 ---- */
  const [tab, setTab] = useState<Tab>('browse');
  const [kw, setKw] = useState('');
  const [kwDebounced, setKwDebounced] = useState('');
  const [cat, setCat] = useState('');
  const [src, setSrc] = useState('');
  const [rateFilter, setRateFilter] = useState<RateFilter>('');
  const [sort, setSort] = useState<SortKey>('rate-desc');
  const [onlyFav, setOnlyFav] = useState(false);
  const [favs, setFavs] = useState<number[]>(loadFavs);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  /* ---- 注入状态 ---- */
  const [platform, setPlatform] = useState<string>(() => loadPlat('codex'));
  const [injectMode, setInjectMode] = useState<InjectMode>(loadInjectMode);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  /** 注入结果回执：显示复核结论 + 被替换掉的旧词条，可一键撤销式回滚提示 */
  const [lastResult, setLastResult] = useState<{
    platformId: string;
    name: string;
    dest: string;
    verify?: { verdict: string; breakActive: boolean | null };
    displaced?: string[];
    at: number;
  } | null>(null);

  /* ---- 详情弹窗 ---- */
  const [detail, setDetail] = useState<{
    item: LibraryItem;
    content: string | null;
    loading: boolean;
    error: string | null;
    injected: { key: string; verdict: string } | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  /* ---- 注入管理 ---- */
  const [mgmt, setMgmt] = useState<Record<string, InjectionsResult>>({});
  const [history, setHistory] = useState<LibraryHistoryItem[]>([]);
  const [mgmtLoading, setMgmtLoading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  /* ---- 搜索防抖 ---- */
  useEffect(() => {
    const t = window.setTimeout(() => {
      setKwDebounced(kw.trim().toLowerCase());
      setPage(0);
    }, 220);
    return () => window.clearTimeout(t);
  }, [kw]);

  /* ---- 平台预检 ---- */
  const refreshTargets = useCallback(async () => {
    if (!api) return;
    try {
      const tg = await api.libraryTargets();
      setTargets(tg?.targets || []);
    } catch { /* 静默，不打扰 */ }
  }, [api]);

  /* ---- 首次加载 ---- */
  const loadAll = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [list, st, tg] = await Promise.all([
        api.libraryList(),
        api.libraryStats(),
        api.libraryTargets()
      ]);
      if (!list.ok && list.error) setLoadError(list.error);
      setItems(list.prompts || []);
      setStats(st || null);
      setTargets(tg?.targets || []);
      if (!list.ok) toast('err', list.error || '词库快照未找到');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      toast('err', '词库加载失败：' + msg);
    } finally {
      setLoading(false);
    }
  }, [api, toast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  /* ---- 平台 / 注入方式持久化 ---- */
  useEffect(() => {
    try { window.localStorage.setItem(PLAT_KEY, platform); } catch { /* 忽略 */ }
  }, [platform]);
  useEffect(() => {
    try { window.localStorage.setItem(MODE_KEY, injectMode); } catch { /* 忽略 */ }
  }, [injectMode]);

  const toggleFav = (index: number) => {
    setFavs((prev) => {
      const next = prev.includes(index) ? prev.filter((x) => x !== index) : [...prev, index];
      try { window.localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch { /* 忽略 */ }
      return next;
    });
  };

  /* ---- 过滤 + 排序 ---- */
  const filtered = useMemo(() => {
    const favSet = new Set(favs);
    let arr = items;
    if (cat) arr = arr.filter((p) => (p.category_label || '通用安全') === cat);
    if (src) arr = arr.filter((p) => (p.source || '未标注') === src);
    if (onlyFav) arr = arr.filter((p) => favSet.has(p.index));
    if (rateFilter === '90') arr = arr.filter((p) => (p.success_rate || 0) >= 90);
    else if (rateFilter === '80') arr = arr.filter((p) => (p.success_rate || 0) >= 80 && (p.success_rate || 0) < 90);
    else if (rateFilter === '70') arr = arr.filter((p) => (p.success_rate || 0) >= 70 && (p.success_rate || 0) < 80);
    else if (rateFilter === 'none') arr = arr.filter((p) => !p.success_rate);

    if (kwDebounced) {
      const k = kwDebounced;
      arr = arr.filter((p) =>
        (p.name || '').toLowerCase().includes(k) ||
        (p.desc || '').toLowerCase().includes(k) ||
        (p.preview || '').toLowerCase().includes(k) ||
        (p.category_label || '').toLowerCase().includes(k) ||
        (p.source || '').toLowerCase().includes(k)
      );
    }

    const sorted = arr.slice();
    switch (sort) {
      case 'rate-desc': sorted.sort((a, b) => (b.success_rate || 0) - (a.success_rate || 0) || a.index - b.index); break;
      case 'rate-asc': sorted.sort((a, b) => (a.success_rate || 0) - (b.success_rate || 0) || a.index - b.index); break;
      case 'len-desc': sorted.sort((a, b) => (b.content_length || 0) - (a.content_length || 0)); break;
      case 'len-asc': sorted.sort((a, b) => (a.content_length || 0) - (b.content_length || 0)); break;
      case 'name-asc': sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-Hans-CN')); break;
      default: sorted.sort((a, b) => a.index - b.index);
    }
    return sorted;
  }, [items, kwDebounced, cat, src, rateFilter, sort, onlyFav, favs]);

  /* ---- 分页 ---- */
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => { if (page >= pageCount) setPage(0); }, [pageCount, page]);
  const pageItems = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  /* ---- 分类/来源 facet ---- */
  const cats = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of items) { const c = p.category_label || '通用安全'; map[c] = (map[c] || 0) + 1; }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const sources = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of items) { const s = p.source || '未标注'; map[s] = (map[s] || 0) + 1; }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const currentTarget = targets.find((t) => t.id === platform) || null;

  /** 已注入 index → key 映射（当前平台，来自注入管理扫描） */
  const injectedIndexMap = useMemo(() => {
    const map = new Map<number, { key: string; verdict: string }>();
    const res = mgmt[platform];
    if (res) {
      for (const it of res.items || []) {
        if (it.fromLibrary && typeof it.index === 'number' && it.index >= 0) {
          map.set(it.index, { key: it.key, verdict: it.verify?.verdict || 'active' });
        }
      }
    }
    return map;
  }, [mgmt, platform]);

  /** 平台切换或注入后刷新当前平台的注入清单（卡片上的"已注入"徽章靠它） */
  const refreshPlatformInjections = useCallback(async () => {
    if (!api) return;
    try {
      const r = await api.libraryInjections(platform);
      setMgmt((prev) => ({ ...prev, [platform]: r }));
    } catch { /* 静默 */ }
  }, [api, platform]);

  useEffect(() => { refreshPlatformInjections(); }, [refreshPlatformInjections]);

  /* ---- 注入单条 ---- */
  const injectOne = useCallback(async (item: LibraryItem, opts?: { silent?: boolean; fromDetail?: boolean }) => {
    if (!api) return false;
    setBusyIdx(item.index);
    try {
      const r = await api.libraryImport({ platformId: platform, index: item.index, name: item.name, mode: injectMode });
      if (!r.ok) throw new Error('注入失败（未知原因）');
      const verdict = r.verify?.verdict || 'unknown';
      if (!opts?.silent) {
        if (verdict === 'active') toast('ok', `已${injectMode === 'replace' ? '替换注入' : '注入'} ${PLAT_LABEL[platform] || platform} ← ${item.name}（复核通过）`);
        else toast('info', `已写入 ${PLAT_LABEL[platform] || platform}，但复核状态为 ${verdict}，请到注入管理页检查`);
      }
      setLastResult({
        platformId: platform,
        name: item.name,
        dest: r.dest,
        verify: r.verify ? { verdict: r.verify.verdict, breakActive: r.verify.breakActive ?? null } : undefined,
        displaced: r.displaced || [],
        at: Date.now()
      });
      await Promise.all([refreshTargets(), refreshPlatformInjections()]);
      return true;
    } catch (e) {
      toast('err', `注入失败：${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusyIdx(null);
    }
  }, [api, platform, injectMode, toast, refreshTargets, refreshPlatformInjections]);

  /* ---- 批量注入 ---- */
  const injectBatch = useCallback(async () => {
    if (!api || picked.size === 0) return;
    const entries = [...picked].map((idx) => {
      const it = items[idx];
      return it ? { index: it.index, name: it.name } : null;
    }).filter((x): x is { index: number; name: string } => x !== null);
    if (!entries.length) { toast('info', '选中的词条不存在'); return; }

    setBatchRunning(true);
    try {
      // 批量走 append：用户显式勾了多条，意图就是叠加；replace 会互相顶掉
      const r = await api.libraryImportBatch({ platformId: platform, entries, mode: 'append' });
      if (r.failCount === 0) toast('ok', `批量注入完成：${r.okCount} 条 → ${PLAT_LABEL[platform] || platform}`);
      else toast('info', `批量注入：成功 ${r.okCount} / 失败 ${r.failCount}`);
      const fails = (r.results || []).filter((x) => !x.ok);
      if (fails.length) toast('err', fails.slice(0, 3).map((f) => `${f.name}: ${f.error}`).join('；'));
      // 复核异常的回执
      const odd = (r.results || []).filter((x) => x.ok && x.verify && x.verify !== 'active');
      if (odd.length) toast('info', `${odd.length} 条写入后复核非 active，请到注入管理页检查`);
      setPicked(new Set());
      setLastResult({
        platformId: platform,
        name: `${entries.length} 条批量注入`,
        dest: r.results?.[0]?.dest || '',
        at: Date.now()
      });
      await Promise.all([refreshTargets(), refreshPlatformInjections()]);
    } catch (e) {
      toast('err', `批量注入失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBatchRunning(false);
    }
  }, [api, picked, items, platform, toast, refreshTargets, refreshPlatformInjections]);

  /* ---- 详情 ---- */
  const openDetail = useCallback(async (item: LibraryItem) => {
    setDetail({ item, content: null, loading: true, error: null, injected: null });
    setCopied(false);
    if (!api) return;
    try {
      const [r, inj] = await Promise.all([
        api.libraryDetail(item.index),
        api.libraryInjections(platform)
      ]);
      const hit = (inj.items || []).find((x: InjectionItem) => x.fromLibrary && x.index === item.index);
      const injected = hit ? { key: hit.key, verdict: hit.verify?.verdict || 'active' } : null;
      if (r.ok && r.detail?.content) {
        setDetail({ item, content: r.detail.content, loading: false, error: null, injected });
      } else {
        setDetail({ item, content: item.preview || null, loading: false, error: r.error || '全文获取失败', injected });
      }
    } catch (e) {
      setDetail({ item, content: item.preview || null, loading: false, error: e instanceof Error ? e.message : String(e), injected: null });
    }
  }, [api, platform]);

  const copyDetail = useCallback(async () => {
    if (!api || !detail?.content) return;
    const r = await api.copyText(detail.content);
    if (r.ok) { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
    else toast('err', '复制失败：' + (r.error || ''));
  }, [api, detail, toast]);

  /* ---- 注入管理 ---- */
  const loadMgmt = useCallback(async () => {
    if (!api) return;
    setMgmtLoading(true);
    try {
      const r = await api.libraryInjectionsAll();
      setMgmt(r.platforms || {});
      setHistory(r.history || []);
      const tg = await api.libraryTargets();
      setTargets(tg?.targets || []);
    } catch (e) {
      toast('err', '读取注入状态失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setMgmtLoading(false);
    }
  }, [api, toast]);

  useEffect(() => { if (tab === 'manage') loadMgmt(); }, [tab, loadMgmt]);

  const removeInjection = useCallback(async (platformId: string, key: string, title: string) => {
    if (!api) return;
    setRemoving(key);
    try {
      const r = await api.libraryRemove({ platformId, key });
      if (r.ok) {
        toast('ok', `已卸载：${title}`);
        await loadMgmt();
      } else toast('err', `卸载失败：${r.error || '未知'}`);
    } catch (e) {
      toast('err', `卸载失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRemoving(null);
    }
  }, [api, loadMgmt, toast]);

  const clearPlatform = useCallback(async (platformId: string) => {
    if (!api) return;
    setRemoving('clear-' + platformId);
    try {
      const r = await api.libraryClearPlatform(platformId);
      if (r.ok) {
        toast('ok', `已清空 ${PLAT_LABEL[platformId] || platformId} 的全部词库注入（${r.removed} 块）`);
        await loadMgmt();
      } else toast('err', r.error || '清空失败');
    } catch (e) {
      toast('err', e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(null);
    }
  }, [api, loadMgmt, toast]);

  const openDest = useCallback(async (platformId: string) => {
    if (!api) return;
    const r = await api.libraryOpenDest({ platformId });
    if (!r.ok) toast('err', r.error || '打开失败');
  }, [api, toast]);

  const togglePick = (index: number) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const pickPageAll = () => {
    setPicked((prev) => {
      const next = new Set(prev);
      const allOn = pageItems.every((p) => next.has(p.index));
      for (const p of pageItems) { if (allOn) next.delete(p.index); else next.add(p.index); }
      return next;
    });
  };

  const totalInjected = targets.reduce((a, t) => a + (t.injectedCount || 0), 0);

  /* ================================================================ 渲染 */

  if (!api) {
    return <div className="empty"><h3>请在桌面端打开</h3><p>词库功能依赖本地文件读写。</p></div>;
  }

  return (
    <div className="lib" data-testid="library-view">
      {/* ---------------- Hero ---------------- */}
      <div className="lib-hero">
        <div className="lib-hero-text">
          <h1>
            <LibraryIcon size={22} color="var(--sakura-deep)" />
            破甲词库
            {stats?.source === 'bundle' && <span className="badge badge-ok" style={{ fontSize: 10.5 }}>离线全量</span>}
            {stats?.source === 'meta' && <span className="badge badge-warn" style={{ fontSize: 10.5 }}>仅元数据 · 注入时联网补全</span>}
          </h1>
          <p>
            {stats ? `${stats.total.toLocaleString()} 条提示词 · ${Object.keys(stats.categories).length} 个分类 · 快照 ${stats.fetchedAt ? fmtAgo(stats.fetchedAt) : '未知'}` : '正在读取词库快照…'}
            {stats && stats.previewOnly > 0 ? ` · 其中 ${stats.previewOnly} 条本地只有预览` : ''}
          </p>
        </div>
        <div className="lib-hero-stats">
          <div className="lib-stat"><b>{stats?.total.toLocaleString() ?? '—'}</b><span>词条总数</span></div>
          <div className="lib-stat"><b style={{ color: 'var(--matcha-deep)' }}>{stats ? stats.rates.r90 + stats.rates.r80 : '—'}</b><span>成功率≥80%</span></div>
          <div className="lib-stat"><b style={{ color: 'var(--sakura-deep)' }}>{totalInjected}</b><span>当前生效注入</span></div>
        </div>
      </div>

      {/* ---------------- Tabs ---------------- */}
      <div className="lib-tabs" role="tablist">
        <button className={`lib-tab${tab === 'browse' ? ' active' : ''}`} onClick={() => setTab('browse')} data-testid="lib-tab-browse">
          <BookOpen size={15} /> 词库浏览
        </button>
        <button className={`lib-tab${tab === 'manage' ? ' active' : ''}`} onClick={() => setTab('manage')} data-testid="lib-tab-manage">
          <SlidersHorizontal size={15} /> 注入管理 <span className="cnt">{totalInjected}</span>
        </button>
        <button className={`lib-tab${tab === 'guide' ? ' active' : ''}`} onClick={() => setTab('guide')} data-testid="lib-tab-guide">
          <Settings2 size={15} /> 使用说明
        </button>
      </div>

      {loadError && (
        <div className="warn-box">
          <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
          词库快照加载失败：{loadError}
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 12 }} onClick={loadAll}><RefreshCw size={12} /> 重试</button>
        </div>
      )}

      {/* ---------------- 注入结果回执 ---------------- */}
      {lastResult && Date.now() - lastResult.at < 12000 && (
        <div className={`lib-result${lastResult.verify && lastResult.verify.verdict !== 'active' ? ' warn' : ''}`} data-testid="lib-result">
          {lastResult.verify?.verdict === 'active'
            ? <CheckCircle2 size={15} color="var(--matcha-deep)" />
            : <AlertTriangle size={15} color="#8a6316" />}
          <span>
            <b>{lastResult.name}</b> → {PLAT_LABEL[lastResult.platformId] || lastResult.platformId}
            {lastResult.verify
              ? lastResult.verify.verdict === 'active'
                ? ' · 已写入并复核通过（标记块在位 · 内容哈希一致）'
                : ` · 已写入，但复核状态：${lastResult.verify.verdict === 'drifted' ? '内容漂移' : '标记块丢失'}`
              : ''}
            {lastResult.verify?.breakActive === true ? ' · 平台破甲层生效中' : ''}
            {lastResult.verify?.breakActive === false ? ' · 注意：该平台破甲层未生效，先装破甲包' : ''}
          </span>
          {lastResult.displaced && lastResult.displaced.length > 0 && (
            <span className="lib-result-displaced">
              <RotateCcw size={12} /> 已替换旧注入 {lastResult.displaced.length} 条（原件备份在软件数据目录）
            </span>
          )}
          <code title={lastResult.dest}>{lastResult.dest.split(/[\\/]/).pop()}</code>
          <button className="modal-close" style={{ width: 26, height: 26, marginLeft: 'auto' }} onClick={() => setLastResult(null)} aria-label="关闭回执"><X size={13} /></button>
        </div>
      )}

      {/* ================= 浏览 ================= */}
      {tab === 'browse' && (
        <>
          {/* 注入目标：先选平台与方式，再选词 */}
          <div className="lib-inject-bar" data-testid="lib-inject-bar">
            <span className="bar-label"><Crosshair size={14} /> 注入到</span>
            {targets.map((t) => (
              <button
                key={t.id}
                className={`lib-plat${platform === t.id ? ' active' : ''}`}
                onClick={() => setPlatform(t.id)}
                data-testid={`lib-plat-${t.id}`}
                title={`${t.label}\n路径：${t.path}\n规则文件：${t.exists ? '已存在' : '将自动创建'}\n平台破甲层：${t.breakActive === true ? '已生效' : t.breakActive === false ? '未生效' : '无判定'}`}
              >
                <span className={`state${t.exists ? '' : ' off'}`} />
                {PLAT_LABEL[t.id] || t.id}
                {t.breakActive === true && <ShieldCheck size={11} className="lib-plat-shield ok" />}
                {t.breakActive === false && <ShieldAlert size={11} className="lib-plat-shield warn" />}
                {t.injectedCount > 0 && <span className="inj-n">{t.injectedCount}</span>}
              </button>
            ))}

            {/* 注入方式 */}
            <div className="lib-mode-toggle" role="radiogroup" aria-label="注入方式">
              <button
                className={`lib-mode${injectMode === 'replace' ? ' active' : ''}`}
                onClick={() => setInjectMode('replace')}
                data-testid="lib-mode-replace"
                title="替换模式：写入前清掉该平台其他词库注入，平台只保留这一条现役规则（推荐）"
              >
                <Replace size={12} /> 替换
              </button>
              <button
                className={`lib-mode${injectMode === 'append' ? ' active' : ''}`}
                onClick={() => setInjectMode('append')}
                data-testid="lib-mode-append"
                title="叠加模式：保留已有注入，新词条追加为另一块（多条规则共存，注意冲突）"
              >
                <PlusCircle size={12} /> 叠加
              </button>
            </div>

            {currentTarget && (
              <div className="lib-inject-hint">
                {currentTarget.mode === 'copy' ? '独立规则文件（.mdc）' : '标记块追加（可精准卸载）'} → <code>{currentTarget.path}</code>
                {currentTarget.exists ? '' : ' （尚不存在，注入时自动创建）'}
                {currentTarget.breakActive === false && <b style={{ color: '#c0504d', marginLeft: 6 }}>· 破甲层未生效，建议先在工具箱安装破甲包</b>}
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8, padding: '2px 10px' }} onClick={() => openDest(currentTarget.id)}>
                  <FolderOpen size={11} /> 打开位置
                </button>
              </div>
            )}
          </div>

          {/* 工具栏 */}
          <div className="lib-toolbar">
            <div className="lib-search">
              <Search size={14} color="var(--ink-faint)" />
              <input
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                placeholder="搜索名称 / 描述 / 内容预览 / 来源…"
                aria-label="搜索词条"
                data-testid="lib-search"
              />
              {kw && (
                <button onClick={() => setKw('')} aria-label="清空搜索" style={{ display: 'grid', placeItems: 'center' }}>
                  <X size={13} color="var(--ink-faint)" />
                </button>
              )}
            </div>
            <select className="lib-select" value={src} onChange={(e) => { setSrc(e.target.value); setPage(0); }} aria-label="按来源筛选" data-testid="lib-src">
              <option value="">全部来源</option>
              {sources.map(([s, n]) => <option key={s} value={s}>{s}（{n}）</option>)}
            </select>
            <select className="lib-select" value={rateFilter} onChange={(e) => { setRateFilter(e.target.value as RateFilter); setPage(0); }} aria-label="按成功率筛选" data-testid="lib-rate">
              <option value="">成功率不限</option>
              <option value="90">≥ 90%</option>
              <option value="80">80 - 89%</option>
              <option value="70">70 - 79%</option>
              <option value="none">未标注</option>
            </select>
            <select className="lib-select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="排序" data-testid="lib-sort">
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <button
              className={`btn btn-sm${onlyFav ? ' btn-primary' : ' btn-ghost'}`}
              onClick={() => { setOnlyFav((v) => !v); setPage(0); }}
              data-testid="lib-fav-filter"
            >
              <Star size={12} /> 收藏（{favs.length}）
            </button>
          </div>

          {/* 分类 chips */}
          <div className="lib-chips">
            <button className={`lib-chip${cat === '' ? ' active' : ''}`} onClick={() => { setCat(''); setPage(0); }}>
              全部 <span className="n">{items.length}</span>
            </button>
            {cats.map(([c, n]) => (
              <button key={c} className={`lib-chip${cat === c ? ' active' : ''}`} onClick={() => { setCat(cat === c ? '' : c); setPage(0); }} data-testid={`lib-cat-${c}`}>
                {c} <span className="n">{n}</span>
              </button>
            ))}
          </div>

          {/* 选择状态条 */}
          {picked.size > 0 && (
            <div className="lib-selection" data-testid="lib-selection">
              <CheckCircle2 size={15} />
              已选 {picked.size} 条
              <span className="grow" />
              <button className="btn btn-ghost btn-sm" onClick={pickPageAll}>本页全选/取消</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>清空选择</button>
              <button className="btn btn-primary btn-sm" disabled={batchRunning} onClick={injectBatch} data-testid="lib-batch-inject">
                {batchRunning
                  ? <><Loader2 size={13} className="spin" /> 注入中…</>
                  : <><Zap size={13} /> 批量注入到 {PLAT_LABEL[platform] || platform}（叠加）</>}
              </button>
            </div>
          )}

          {/* 结果计数 */}
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>
            匹配 <b style={{ color: 'var(--ink)' }}>{filtered.length.toLocaleString()}</b> 条
            {filtered.length !== items.length && (
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 10, padding: '2px 10px' }}
                onClick={() => { setKw(''); setCat(''); setSrc(''); setRateFilter(''); setOnlyFav(false); setPage(0); }}>
                重置筛选
              </button>
            )}
          </div>

          {/* 卡片列表 */}
          {loading ? (
            <div className="empty"><Loader2 size={30} className="spin" color="var(--sakura)" /><h3>正在加载词库…</h3></div>
          ) : filtered.length === 0 ? (
            <div className="empty" data-testid="lib-empty">
              <Search size={40} color="var(--ink-faint)" />
              <h3>没有匹配的词条</h3>
              <p>试试换个关键词，或点「重置筛选」回到全量列表。</p>
            </div>
          ) : (
            <>
              <div className="lib-grid" data-testid="lib-grid">
                {pageItems.map((item) => {
                  const isPicked = picked.has(item.index);
                  const isFav = favs.includes(item.index);
                  const isBusy = busyIdx === item.index;
                  const inj = injectedIndexMap.get(item.index);
                  return (
                    <div
                      key={item.index}
                      className={`lib-card${isPicked ? ' picked' : ''}${inj ? ' injected' : ''}`}
                      data-testid={`lib-card-${item.index}`}
                      onClick={() => openDetail(item)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter') openDetail(item); }}
                    >
                      <div className="lib-card-top">
                        <span className="lib-cat">{item.category_label || '通用安全'}</span>
                        <span className={rateClass(item.success_rate || 0)}>
                          {item.success_rate ? `${item.success_rate}%` : '未标注'}
                        </span>
                        {inj && (
                          <span className={`badge ${inj.verdict === 'active' ? 'badge-ok' : 'badge-warn'}`} title={inj.verdict === 'active' ? `已注入到 ${PLAT_LABEL[platform] || platform} 且复核生效` : '已注入但复核异常'}>
                            <ShieldCheck size={10} /> {inj.verdict === 'active' ? '现役' : '异常'}
                          </span>
                        )}
                        <div style={{ flex: 1 }} />
                        <button
                          className={`lib-fav${isFav ? ' on' : ''}`}
                          onClick={(e) => { e.stopPropagation(); toggleFav(item.index); }}
                          title={isFav ? '取消收藏' : '收藏'}
                          data-testid={`lib-fav-${item.index}`}
                        >
                          <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
                        </button>
                      </div>
                      <div className="lib-card-name" title={item.name}>{item.name}</div>
                      {item.desc
                        ? <div className="lib-desc">{item.desc}</div>
                        : <div className="lib-preview">{item.preview}</div>}
                      <div className="lib-card-meta">
                        <span className="src" title={item.source}>{item.source}</span>
                        <span>·</span>
                        <span>{(item.content_length || 0).toLocaleString()} 字</span>
                        <span>·</span>
                        <span>#{item.index}</span>
                      </div>
                      <div className="lib-card-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          className={`btn btn-sm${isPicked ? ' btn-primary' : ' btn-ghost'}`}
                          onClick={() => togglePick(item.index)}
                          data-testid={`lib-pick-${item.index}`}
                        >
                          {isPicked ? <><Check size={12} /> 已选</> : '选择'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => openDetail(item)} data-testid={`lib-detail-${item.index}`}>
                          <Eye size={12} /> 详情
                        </button>
                        <button className="btn btn-mint btn-sm" disabled={isBusy} onClick={() => injectOne(item)} data-testid={`lib-inject-${item.index}`}
                          title={injectMode === 'replace' ? `替换注入到 ${PLAT_LABEL[platform] || platform}（清掉该平台其他词库注入）` : `叠加注入到 ${PLAT_LABEL[platform] || platform}`}>
                          {isBusy ? <Loader2 size={12} className="spin" /> : inj ? <Replace size={12} /> : <Zap size={12} />}
                          {isBusy ? '注入中' : inj ? '替换' : '注入'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 分页 */}
              {pageCount > 1 && (
                <div className="lib-pager" data-testid="lib-pager">
                  <button className="btn btn-ghost btn-sm" disabled={page === 0} onClick={() => setPage(0)}>首页</button>
                  <button className="btn btn-ghost btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={13} /> 上一页</button>
                  <span className="page-info">{page + 1} / {pageCount} 页 · 共 {filtered.length.toLocaleString()} 条</span>
                  <button className="btn btn-ghost btn-sm" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>下一页 <ChevronRight size={13} /></button>
                  <button className="btn btn-ghost btn-sm" disabled={page >= pageCount - 1} onClick={() => setPage(pageCount - 1)}>末页</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ================= 注入管理 ================= */}
      {tab === 'manage' && (
        <div data-testid="lib-manage">
          <div className="deploy-bar" style={{ marginBottom: 14 }}>
            <button className="btn btn-sm" onClick={loadMgmt} disabled={mgmtLoading}>
              {mgmtLoading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} 重新扫描 + 复核
            </button>
            <span className="deploy-hint">
              直接扫描六个平台规则文件的磁盘现状，并对每个词库注入块做三重复核：
              <b>标记块在位</b> → <b>内容哈希与注入时一致</b>（被改过会标「内容漂移」）→ <b>平台破甲层状态</b>。
              「词库」= 本词库注入；「导入」= 导入功能加的规则，词库清空不碰它。
            </span>
          </div>
          {mgmtLoading && Object.keys(mgmt).length === 0 ? (
            <div className="empty"><Loader2 size={26} className="spin" color="var(--sakura)" /><h3>扫描中…</h3></div>
          ) : (
            <div className="lib-mgmt-grid">
              {Object.entries(mgmt).map(([pid, res]) => {
                const libItems = (res.items || []).filter((x) => x.fromLibrary);
                const otherItems = (res.items || []).filter((x) => !x.fromLibrary);
                const t = targets.find((x) => x.id === pid);
                return (
                  <div className="lib-mgmt-card" key={pid} data-testid={`lib-mgmt-${pid}`}>
                    <div className="lib-mgmt-head">
                      <b>{PLAT_LABEL[pid] || pid}</b>
                      <span className="badge badge-muted">{res.mode === 'copy' ? '独立文件' : '标记块'}</span>
                      <BreakBadge active={res.breakActive ?? t?.breakActive} />
                      <div style={{ flex: 1 }} />
                      <button className="btn btn-ghost btn-sm" onClick={() => openDest(pid)} title="打开目标位置"><FolderOpen size={12} /></button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={libItems.length === 0 || removing === 'clear-' + pid}
                        onClick={() => clearPlatform(pid)}
                        title="只移除词库注入的块，不动其他导入"
                        style={{ color: libItems.length ? '#c0504d' : undefined }}
                      >
                        {removing === 'clear-' + pid ? <Loader2 size={12} className="spin" /> : <Trash2 size={12} />} 清空词库注入
                      </button>
                    </div>
                    <div className="lib-mgmt-path">{res.path}{res.exists === false ? '（文件不存在）' : ''}</div>
                    {libItems.length === 0 && otherItems.length === 0 && (
                      <div className="lib-inj-empty">没有注入块 · 干净状态</div>
                    )}
                    {libItems.map((x) => (
                      <div className="lib-inj-item" key={x.key}>
                        <span className="badge badge-accent" style={{ flexShrink: 0 }}>词库</span>
                        <span className="t" title={x.key}>{x.title}</span>
                        <VerifyBadge v={x.verify} />
                        <span className="sz">{fmtBytes(x.bytes)}</span>
                        <span className="sz" title={x.injectedAt || ''}>{fmtAgo(x.injectedAt)}</span>
                        <button className="btn btn-ghost btn-sm" style={{ padding: '3px 9px' }} disabled={removing === x.key}
                          onClick={() => removeInjection(pid, x.key, x.title)} title="卸载这一块">
                          {removing === x.key ? <Loader2 size={11} className="spin" /> : <X size={11} />}
                        </button>
                      </div>
                    ))}
                    {otherItems.map((x) => (
                      <div className="lib-inj-item" key={x.key} style={{ opacity: 0.75 }}>
                        <span className="badge badge-ok" style={{ flexShrink: 0 }}>导入</span>
                        <span className="t" title={x.key}>{x.title}</span>
                        <span className="sz">{fmtBytes(x.bytes)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* 注入历史 */}
          {history.length > 0 && (
            <div className="panel" style={{ marginTop: 14 }}>
              <h2>注入历史（最近 {Math.min(history.length, 20)} 条）</h2>
              <p className="desc">本软件执行过的词库注入记录。替换掉的旧词条原件都自动备份在软件数据目录 backups 文件夹。</p>
              {history.slice(0, 20).map((h, i) => (
                <div className="log-row" key={`${h.key}-${h.at}-${i}`}>
                  <span className="log-time">{new Date(h.at).toLocaleString('zh-CN')}</span>
                  <span className="log-kind" style={{ color: 'var(--sakura-deep)' }}>{PLAT_LABEL[h.platformId] || h.platformId}</span>
                  <span className="log-text">
                    {h.injectMode === 'replace' ? '替换注入' : '注入'} <b>{h.name || h.key}</b> · {fmtBytes(h.bytes)}
                    {h.displaced && h.displaced.length > 0 ? ` · 顶掉 ${h.displaced.length} 条旧注入` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================= 使用说明 ================= */}
      {tab === 'guide' && (
        <div className="lib-guide" data-testid="lib-guide">
          <div className="panel">
            <h2>词库怎么用</h2>
            <p className="desc">三步完成一次注入：选平台 → 挑词条 → 注入。注入后到对应客户端新开一个会话即生效。</p>
            <div className="lib-steps">
              <div className="lib-step">
                <span className="lib-step-n">1</span>
                <div>
                  <b>选注入平台与方式</b>
                  <p>顶部粉色栏点一个平台。绿点 = 规则文件已存在，灰点 = 注入时自动创建；盾牌图标 = 该平台破甲层生效状态（悬停看详情）。
                     右侧「替换 / 叠加」决定写入方式：<b>替换</b>（推荐）= 清掉该平台其他词库注入，只留这一条现役规则，被顶掉的原件自动备份；
                     <b>叠加</b> = 保留已有注入再追加一块（多条规则可能互相冲突，慎用）。</p>
                </div>
              </div>
              <div className="lib-step">
                <span className="lib-step-n">2</span>
                <div>
                  <b>挑词条</b>
                  <p>默认按成功率从高到低。可按分类、来源、成功率区间筛选，搜索覆盖名称 / 描述 / 内容 / 来源。
                     点卡片打开详情通读全文，确认没有不想要的指令；点 ⭐ 收藏（本地保存）。
                     勾选多条后「批量注入」一次写入（批量固定为叠加模式，单次上限 50 条）。
                     已注入到当前平台的卡片会带「现役」徽章，注入按钮变成「替换」。</p>
                </div>
              </div>
              <div className="lib-step">
                <span className="lib-step-n">3</span>
                <div>
                  <b>注入 → 自动复核 → 验证</b>
                  <p>点「注入」后软件立即回读磁盘做三重复核：标记块在位、内容哈希与注入时一致、平台破甲层状态，结果在顶部绿色回执里。
                     然后到对应平台<b>新开一个会话</b>（规则文件在会话创建时读取），发「冷咖啡」验证身份层是否加载。
                     写入是幂等的：同一条重复注入 = 覆盖更新，不会越堆越多。</p>
                </div>
              </div>
              <div className="lib-step">
                <span className="lib-step-n">4</span>
                <div>
                  <b>卸载 / 回滚</b>
                  <p>「注入管理」页列出每个平台磁盘上真实生效的注入块，可随时重新扫描复核：
                     「生效中」= 在位且未被改动；「内容漂移」= 块还在但内容被客户端重写或手动改过，重新注入即可恢复；「已丢失」= 块被删了。
                     可单块卸载或一键清空（只清词库注入，导入的规则不动）。所有写操作前自动备份到软件数据目录 backups 文件夹。</p>
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <h2>六个平台分别写到哪</h2>
            <p className="desc">注入不是黑箱 —— 下表就是每个平台的确切落点、写入方式和当前状态。</p>
            <table className="lib-target-table">
              <thead>
                <tr><th>平台</th><th>目标文件</th><th>方式</th><th>破甲层</th><th>生效条件</th></tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t.id}>
                    <td><b>{PLAT_LABEL[t.id] || t.id}</b></td>
                    <td><code>{t.path}</code></td>
                    <td>{t.mode === 'copy' ? '独立 .mdc 文件' : '标记块追加'}</td>
                    <td><BreakBadge active={t.breakActive} /></td>
                    <td>{t.id === 'cursor' ? 'Cursor 重启后对所有项目生效（alwaysApply）' : '该平台新开会话时读取'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h2>成功率标记怎么读</h2>
            <p className="desc">
              成功率来自词库源站的社区实测标注：
              <b style={{ color: 'var(--matcha-deep)' }}> ≥90%（{stats?.rates.r90 ?? 0} 条）</b> 基本一次过；
              <b style={{ color: '#8a6316' }}> 70-89%（{stats ? stats.rates.r80 + stats.rates.r70 : 0} 条）</b> 多数情况可用，偶尔要重试或换措辞；
              <b> 未标注（{stats?.rates.rNone ?? 0} 条）</b> 没有社区数据，质量自行判断 —— 未标注≠不能用，很多长文档类词条就没走评分流程。
              建议先从「成功率≥80%」筛起。
            </p>
          </div>

          <div className="panel">
            <h2>注意事项</h2>
            <p className="desc">
              <FileText size={13} style={{ verticalAlign: -2 }} /> 一次别注入太多条 —— 规则文件越长，客户端读取越慢、上下文占用越高，多条规则还可能互相冲突。用「替换」模式保持每个平台 1 条现役规则最稳。
              <br /><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> 词条内容是社区提示词，注入前先在详情页通读一遍，确认里面没有你不想要的指令。
              <br /><ShieldAlert size={13} style={{ verticalAlign: -2 }} /> 平台破甲层未生效时，光注入词库没用 —— 先回工具箱把对应破甲包装上，词库是「装好破甲包之后换用哪套提示词」的事。
              <br /><CheckCircle2 size={13} style={{ verticalAlign: -2 }} /> 所有注入都可逆：「注入管理」页可随时卸载，写前备份自动落在软件数据目录。
            </p>
          </div>
        </div>
      )}

      {/* ---------------- 详情弹窗 ---------------- */}
      {detail && (
        <div className="overlay" onClick={() => setDetail(null)} data-testid="lib-detail-modal">
          <div className="modal lib-detail-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="lib-detail-head">
              <h2>{detail.item.name}</h2>
              <div className="lib-detail-tags">
                <span className="lib-cat">{detail.item.category_label || '通用安全'}</span>
                <span className={rateClass(detail.item.success_rate || 0)}>
                  成功率 {detail.item.success_rate ? `${detail.item.success_rate}%` : '未标注'}
                </span>
                <span className="badge badge-muted">{detail.item.source}</span>
                <span className="badge badge-muted">{(detail.item.content_length || 0).toLocaleString()} 字</span>
                {detail.injected && (
                  <span className={`badge ${detail.injected.verdict === 'active' ? 'badge-ok' : 'badge-warn'}`}>
                    <ShieldCheck size={10} />
                    {detail.injected.verdict === 'active' ? `已注入 ${PLAT_LABEL[platform] || platform} · 生效中` : detail.injected.verdict === 'drifted' ? '已注入但内容漂移' : '已注入但标记块丢失'}
                  </span>
                )}
              </div>
              {detail.item.desc && <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.7 }}>{detail.item.desc}</p>}
              {detail.error && (
                <div className="warn-box" style={{ margin: '10px 0 0' }}>
                  <AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {detail.error}
                </div>
              )}
              <button className="modal-close" style={{ position: 'absolute', top: 20, right: 24 }} onClick={() => setDetail(null)} aria-label="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="lib-detail-body">
              {detail.loading ? (
                <div className="v2-loading"><Loader2 size={20} className="spin" /> 正在读取全文…</div>
              ) : (
                <pre className="lib-detail-content">{detail.content || '（无内容）'}</pre>
              )}
            </div>
            <div className="lib-detail-foot">
              <div className="target-hint">
                {injectMode === 'replace' ? '替换注入' : '叠加注入'}到 <b>{PLAT_LABEL[platform] || platform}</b> → <code>{currentTarget?.path}</code>
                {injectMode === 'replace' && (currentTarget?.injectedCount ?? 0) > 0
                  ? <><br />将清掉该平台现有 {currentTarget?.injectedCount} 个词库注入块（自动备份）</>
                  : null}
              </div>
              <div className="grow" />
              <button className="btn btn-ghost btn-sm" onClick={copyDetail} disabled={!detail.content} data-testid="lib-copy">
                {copied ? <Check size={12} color="var(--matcha-deep)" /> : <Copy size={12} />} {copied ? '已复制' : '复制全文'}
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={detail.loading || busyIdx === detail.item.index}
                onClick={async () => {
                  const ok = await injectOne(detail.item, { silent: true, fromDetail: true });
                  if (ok) {
                    setDetail((d) => (d ? { ...d, injected: { key: `lib${d.item.index}`, verdict: 'active' } } : d));
                    toast('ok', `已${injectMode === 'replace' ? '替换注入' : '注入'} ${PLAT_LABEL[platform] || platform} ← ${detail.item.name}（复核通过）`);
                  }
                }}
                data-testid="lib-detail-inject"
              >
                {busyIdx === detail.item.index ? <Loader2 size={13} className="spin" /> : detail.injected ? <Replace size={13} /> : <Zap size={13} />}
                {detail.injected ? `替换 ${PLAT_LABEL[platform] || platform} 现役规则` : `注入到 ${PLAT_LABEL[platform] || platform}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
