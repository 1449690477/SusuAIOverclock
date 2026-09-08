import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderSearch, RefreshCw, FileDown, Search, Download, Trash2, Radar, Terminal } from 'lucide-react';
import MascotCat from './components/MascotCat';
import Sidebar, { type View } from './components/Sidebar';
import Hero from './components/Hero';
import PackCard from './components/PackCard';
import PackDetailModal from './components/PackDetailModal';
import ActivityView from './components/ActivityView';
import SettingsView from './components/SettingsView';
import ProgressBar from './components/ProgressBar';
import ConsolePanel from './components/ConsolePanel';
import DeepVerifyModal from './components/DeepVerifyModal';
import ImportModal from './components/ImportModal';
import Toasts, { type ToastItem } from './components/Toasts';
import type { Hub, Pack, ProgressPayload, PlatformInfo, BreakStatus, PlanInfo, LogLine, DeepVerifyResult } from './types';

const REDUCED_KEY = 'dango.reducedMotion';

export default function App() {
  const api = typeof window !== 'undefined' ? window.dango : undefined;

  const [hub, setHub] = useState<Hub | null>(null);
  const [view, setView] = useState<View>('toolbox');
  const [selected, setSelected] = useState<Pack | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'found' | 'changed'>('all');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressPayload>({});
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);

  const [platforms, setPlatforms] = useState<Record<string, PlatformInfo>>({});
  const [breaks, setBreaks] = useState<Record<string, BreakStatus>>({});
  const [plans, setPlans] = useState<Record<string, PlanInfo>>({});
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [deploying, setDeploying] = useState(false);

  const [deepFor, setDeepFor] = useState<Pack | null>(null);
  const [deepResult, setDeepResult] = useState<DeepVerifyResult | null>(null);
  const [deepLoading, setDeepLoading] = useState(false);

  const [importOpen, setImportOpen] = useState(false);

  const toastSeq = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  const toast = useCallback((kind: ToastItem['kind'], text: string) => {
    toastSeq.current += 1;
    const id = `t${toastSeq.current}`;
    setToasts((prev) => [...prev, { id, kind, text }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3600);
  }, []);

  useEffect(() => {
    try {
      setReducedMotion(window.localStorage.getItem(REDUCED_KEY) === '1');
    } catch {
      /* 忽略 */
    }
  }, []);

  const toggleReduced = (v: boolean) => {
    setReducedMotion(v);
    try {
      window.localStorage.setItem(REDUCED_KEY, v ? '1' : '0');
    } catch {
      /* 忽略 */
    }
  };

  const run = useCallback(
    async (
      fn: () => Promise<Hub | { ok: boolean; error?: string | null; canceled?: boolean; path?: string }>,
      opts?: { okText?: string }
    ) => {
      if (!api) return;
      setBusy(true);
      try {
        const r = await fn();
        if (r && 'packs' in r) {
          setHub(r as Hub);
          if (selected) {
            const fresh = (r as Hub).packs.find((p) => p.id === selected.id);
            if (fresh) setSelected(fresh);
          }
        }
        if (opts?.okText) toast('ok', opts.okText);
        return r;
      } catch (e: unknown) {
        toast('err', e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
        setProgress({});
      }
    },
    [api, selected, toast]
  );

  /** 重新探测六个平台 + 破甲生效状态 */
  const refreshDetect = useCallback(async () => {
    if (!api) return;
    try {
      const d = await api.detect();
      setPlatforms(d.platforms);
      setBreaks(d.breaks);
      setPlans(d.plans);
    } catch (e: unknown) {
      toast('err', e instanceof Error ? e.message : String(e));
    }
  }, [api, toast]);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    api
      .load()
      .then((h) => {
        if (alive) setHub(h);
      })
      .catch((e: unknown) => toast('err', e instanceof Error ? e.message : String(e)));

    const offProg = api.onProgress((p) => setProgress(p));
    const offLog = api.onLog((l) => setLogs((prev) => [...prev.slice(-2000), l]));

    refreshDetect();

    // 逐个取平台真实图标（从 exe 提取）
    (async () => {
      for (const id of ['codex', 'cursor', 'dsh', 'opencode', 'workbuddy', 'anti-gravity']) {
        // eslint-disable-next-line no-await-in-loop
        const r = await api.getIcon(id).catch(() => null);
        if (!alive) return;
        if (r && r.dataUrl) setIcons((prev) => ({ ...prev, [id]: r.dataUrl as string }));
      }
    })();

    return () => {
      alive = false;
      offProg();
      offLog();
    };
  }, [api, toast, refreshDetect]);

  const packs = hub?.packs ?? [];

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return packs.filter((p) => {
      if (filter === 'found' && !p.found) return false;
      if (filter === 'changed' && p.lastResult !== 'changed') return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.subtitle.toLowerCase().includes(q) ||
        p.target.toLowerCase().includes(q) ||
        p.folder.toLowerCase().includes(q)
      );
    });
  }, [packs, query, filter]);

  /** 安装 / 卸载单个包 */
  const deploy = useCallback(
    async (id: string, action: 'install' | 'uninstall') => {
      if (!api) return;
      const pack = packs.find((p) => p.id === id);
      const label = action === 'install' ? '安装' : '卸载';
      setConsoleOpen(true);
      setDeploying(true);
      setLogs((prev) => [...prev, { packId: id, action, kind: 'sys', line: `===== ${label}：${pack?.name || id} =====` }]);
      try {
        const r = await api.deploy(id, action);
        if (r.ok) toast('ok', `${pack?.name || id}：${label}完成`);
        else toast('err', `${pack?.name || id}：${label}失败（退出码 ${r.code}）`);
      } catch (e: unknown) {
        toast('err', e instanceof Error ? e.message : String(e));
      } finally {
        setDeploying(false);
        await refreshDetect();
      }
    },
    [api, packs, refreshDetect, toast]
  );

  /** 深度分层验证：拉起客户端发口令抓回复，定位失败层 */
  const verifyDeep = useCallback(
    async (id: string) => {
      if (!api) return;
      const pack = packs.find((p) => p.id === id) || null;
      setDeepFor(pack);
      setDeepResult(null);
      setDeepLoading(true);
      setConsoleOpen(true);
      try {
        const r = await api.verifyDeep(id);
        setDeepResult(r);
        if (r.failAt) toast('info', `${pack?.name || id}：失败在 ${r.failAt}`);
        else toast('ok', `${pack?.name || id}：四层全部通过`);
      } catch (e: unknown) {
        toast('err', e instanceof Error ? e.message : String(e));
        setDeepLoading(false);
      } finally {
        setDeepLoading(false);
        await refreshDetect();
      }
    },
    [api, packs, refreshDetect, toast]
  );

  /** 一键全部安装 / 卸载：串行执行，避免几个脚本同时改同一批文件 */
  const deployAll = useCallback(
    async (action: 'install' | 'uninstall') => {
      if (!api) return;
      const label = action === 'install' ? '安装' : '卸载';
      const targets = packs.filter((p) => p.found && (action === 'install' ? plans[p.id]?.hasInstall : plans[p.id]?.hasUninstall));
      if (!targets.length) {
        toast('info', `没有可${label}的包`);
        return;
      }
      setConsoleOpen(true);
      setDeploying(true);
      let okCount = 0;
      for (const p of targets) {
        setLogs((prev) => [...prev, { packId: p.id, action, kind: 'sys', line: `===== ${label}：${p.name} =====` }]);
        try {
          // eslint-disable-next-line no-await-in-loop
          const r = await api.deploy(p.id, action);
          if (r.ok) okCount += 1;
          else toast('err', `${p.name}：${label}失败（退出码 ${r.code}）`);
        } catch (e: unknown) {
          toast('err', `${p.name}：${e instanceof Error ? e.message : String(e)}`);
        }
      }
      setDeploying(false);
      toast(okCount === targets.length ? 'ok' : 'info', `${label}完成：${okCount}/${targets.length}`);
      await refreshDetect();
    },
    [api, packs, plans, refreshDetect, toast]
  );

  if (!api) {
    return (
      <div className="app">
        <div className="empty" style={{ margin: 'auto' }}>
          <MascotCat size={96} waving={false} />
          <h3>请在桌面端打开</h3>
          <p>
            这个界面依赖 Electron 主进程提供的本地文件接口，浏览器里无法工作。
            <br />
            请用构建出来的 DangoDesk 桌面端运行。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`app${reducedMotion ? ' reduced-motion' : ''}`}>
      <header className="titlebar">
        <div className="titlebar-logo">
          <MascotCat size={38} />
          <div>
            <div className="titlebar-title">苏苏 AI超频 · Susu AI Overclock</div>
            <div className="titlebar-sub">六大模型工作台 · 深度状态与会话监控</div>
          </div>
        </div>
        <div className="titlebar-spacer" />
        <div className="titlebar-actions">
          {/* 苏苏专属可爱社群与公益中转跳转链接 */}
          <div className="susu-cute-links">
            <button
              className="btn-cute-link btn-cute-link-qq"
              onClick={() => api?.openExternal('https://qm.qq.com/q/IKd1i5X64S')}
              title="点击链接加入群聊【古希腊掌管Token的词元喵喵】（苏苏的交流群）"
              data-testid="link-qq"
            >
              <span className="cute-emoji">🐾</span>
              <span className="cute-text">词元喵喵Q群</span>
            </button>
            <button
              className="btn-cute-link btn-cute-link-wiki"
              onClick={() => api?.openExternal('https://susu.wiki/')}
              title="苏苏的公益中转~ (https://susu.wiki/)"
              data-testid="link-wiki"
            >
              <span className="cute-emoji">💖</span>
              <span className="cute-text">苏苏的公益中转~</span>
            </button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => run(() => api.refresh())} disabled={busy || !hub?.root}>
            <RefreshCw size={13} /> 重新扫描
          </button>
          <button className="btn btn-sm" onClick={() => run(() => api.chooseRoot())} disabled={busy}>
            <FolderSearch size={13} /> {hub?.root ? '更换目录' : '选择根目录'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setImportOpen(true)} data-testid="open-import">
            <Download size={13} /> 导入包
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setConsoleOpen((v) => !v)}
            data-testid="toggle-console"
          >
            <Terminal size={13} /> 日志
          </button>
          <button
            className="btn btn-mint btn-sm"
            disabled={busy}
            onClick={async () => {
              const r = await run(() => api.exportReport());
              if (r && 'path' in r && r.path) toast('ok', `报告已导出：${r.path}`);
            }}
          >
            <FileDown size={13} /> 导出报告
          </button>
        </div>
      </header>

      <div className="body">
        <Sidebar view={view} onChange={setView} version={hub?.appVersion ?? '1.0.0'} />

        <main className="main" style={consoleOpen ? { paddingBottom: 316 } : undefined}>
          {view === 'toolbox' ? (
            !hub ? (
              <div className="empty" data-testid="hub-loading">
                <MascotCat size={110} />
                <h3>正在读取包状态…</h3>
              </div>
            ) : !hub.root && !hub.hasEmbedded ? (
              <div className="empty" data-testid="empty-guide">
                <MascotCat size={110} />
                <h3>先选一个根目录</h3>
                <p>
                  选择包含六个工具包文件夹的父目录（codex / cursor / dsh / opencode / workbuddy /
                  anti-gravity）。选好后可以一键安装、卸载、备份，并验证破甲是否生效。
                </p>
                <button className="btn btn-primary" onClick={() => run(() => api.chooseRoot())} disabled={busy}>
                  <FolderSearch size={14} /> 选择根目录
                </button>
              </div>
            ) : (
              <>
                <Hero packs={packs} lastScanAt={hub?.lastScanAt ?? null} root={hub?.root ?? null} />

                <div className="deploy-bar" data-testid="deploy-bar">
                  <button className="btn btn-sm" onClick={refreshDetect} disabled={busy}>
                    <Radar size={13} /> 重新检测
                  </button>
                  <button
                    className="btn btn-mint btn-sm"
                    onClick={() => deployAll('install')}
                    disabled={busy || deploying}
                    data-testid="deploy-all-install"
                  >
                    <Download size={13} /> 一键全部安装
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => deployAll('uninstall')}
                    disabled={busy || deploying}
                    data-testid="deploy-all-uninstall"
                  >
                    <Trash2 size={13} /> 一键全部卸载
                  </button>
                  <span className="deploy-hint">
                    安装 = 执行包内自带的安装脚本；卸载 = 执行包内自带的卸载脚本。日志实时可见。
                  </span>
                </div>

                <div className="section-head">
                  <h2>工具包</h2>
                  <div className="line" />
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ position: 'relative' }}>
                      <Search size={13} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--ink-faint)' }} />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="搜索"
                        aria-label="搜索工具包"
                        data-testid="search-input"
                        style={{
                          padding: '7px 12px 7px 28px',
                          borderRadius: 999,
                          border: '1px solid var(--line-2)',
                          background: '#fff',
                          fontFamily: 'inherit',
                          fontSize: 12,
                          outline: 'none',
                          width: 150
                        }}
                      />
                    </div>
                    {(
                      [
                        ['all', '全部'],
                        ['found', '已找到'],
                        ['changed', '有变更']
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        className={`btn btn-sm${filter === k ? ' btn-mint' : ' btn-ghost'}`}
                        onClick={() => setFilter(k)}
                        data-testid={`filter-${k}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {visible.length === 0 ? (
                  <div className="empty">
                    <p style={{ margin: 0 }}>没有匹配的工具包。</p>
                  </div>
                ) : (
                  <div className="grid" data-testid="pack-grid">
                    {visible.map((p) => (
                      <PackCard
                        key={p.id}
                        pack={p}
                        platform={platforms[p.id]}
                        breakStatus={breaks[p.id]}
                        plan={plans[p.id]}
                        icon={icons[p.id]}
                        busy={busy || deploying}
                        onOpen={setSelected}
                        onDeploy={deploy}
                        onDeepVerify={verifyDeep}
                      />
                    ))}
                  </div>
                )}
              </>
            )
          ) : null}

          {view === 'activity' ? <ActivityView items={hub?.activity ?? []} /> : null}

          {view === 'settings' && hub ? (
            <SettingsView
              hub={hub}
              reducedMotion={reducedMotion}
              setReducedMotion={toggleReduced}
              onChooseRoot={() => run(() => api.chooseRoot())}
              onClearRoot={() => run(() => api.clearRoot(), { okText: '已清除根目录' })}
              onOpenRoot={async () => {
                const r = await api.openRoot();
                if (!r.ok) toast('err', r.error || '打开失败');
              }}
              onExport={async () => {
                const r = await run(() => api.exportReport());
                if (r && 'path' in r && r.path) toast('ok', `报告已导出：${r.path}`);
              }}
            />
          ) : null}
        </main>
      </div>

      {consoleOpen ? (
        <ConsolePanel
          lines={logs}
          running={deploying}
          onClear={() => setLogs([])}
          onCancel={async () => {
            await api.cancelDeploy();
            setDeploying(false);
          }}
          onClose={() => setConsoleOpen(false)}
        />
      ) : null}

      {selected ? (
        <PackDetailModal
          pack={selected}
          platform={platforms[selected.id]}
          breakStatus={breaks[selected.id]}
          plan={plans[selected.id]}
          busy={busy || deploying}
          onClose={() => setSelected(null)}
          onCapture={(id) => run(() => api.captureBaseline(id), { okText: '基线快照已建立' })}
          onVerify={(id) => run(() => api.verify(id), { okText: '检查完成' })}
          onClear={(id) => run(() => api.clearBaseline(id), { okText: '基线已清除' })}
          onOpenFolder={async (id) => {
            const r = await api.openPack(id);
            if (!r.ok) toast('err', r.error || '打开失败');
          }}
          onDeploy={deploy}
          onBackup={async (id) => {
            const r = await run(() => api.backup(id));
            if (r && 'name' in r && r.name) toast('ok', `已备份：${r.name}`);
          }}
          onVerifyBreak={async (id) => {
            const r = await api.verifyBreak(id);
            setBreaks((prev) => ({ ...prev, [id]: r }));
            toast(r.active ? 'ok' : 'info', r.active ? '破甲已生效' : '未检测到生效标记');
          }}
          onDeepVerify={verifyDeep}
        />
      ) : null}

      {deepFor ? (
        <DeepVerifyModal
          pack={deepFor}
          result={deepResult}
          loading={deepLoading}
          onClose={() => {
            setDeepFor(null);
            setDeepResult(null);
          }}
          onRerun={verifyDeep}
        />
      ) : null}

      {importOpen && api ? (
        <ImportModal
          packs={packs}
          onClose={() => setImportOpen(false)}
          toast={toast}
          onChoosePath={(kind) => api.chooseImportPath(kind)}
          onAnalyze={(p) => api.analyzeImport(p)}
          onImportDir={async (p, platformId) => {
            const h = await api.importPackDir(p, platformId);
            setHub(h);
            await refreshDetect();
          }}
          onImportFile={async (p, platformId) => {
            const r = await api.importSingleFile(p, platformId);
            await refreshDetect();
            return r;
          }}
        />
      ) : null}

      <ProgressBar p={progress} />
      <Toasts items={toasts} />
    </div>
  );
}
