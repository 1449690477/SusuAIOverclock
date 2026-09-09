export type Accent = 'sakura' | 'matcha' | 'yuzu' | 'kuromi' | 'soda' | 'grape';

export type BaselineResult = 'untracked' | 'recorded' | 'unchanged' | 'changed';

export interface ChangeItem {
  path: string;
  size?: number;
  from?: number;
}

export interface DiffResult {
  added: ChangeItem[];
  removed: ChangeItem[];
  modified: ChangeItem[];
  unchanged: number;
  changed: number;
  truncated?: boolean;
}

export interface Pack {
  id: string;
  name: string;
  subtitle: string;
  folder: string;
  target: string;
  accent: Accent;
  note: string;
  path: string | null;
  /** 包目录来源：imported=导入覆盖 / external=外部根目录 / embedded=内嵌包 / none=未找到 */
  source?: 'imported' | 'external' | 'embedded' | 'none';
  found: boolean;
  version: string | null;
  versionSource: string | null;
  fileCount: number;
  dirCount: number;
  bytes: number;
  modifiedAt: string | null;
  entries: string[];
  missingEntries: string[];
  skippedDirs: number;
  warnings: string[];
  baselineAt: string | null;
  lastCheckedAt: string | null;
  lastResult: BaselineResult;
  lastChanges: DiffResult | null;
}

export interface ActivityItem {
  id: string;
  at: string;
  kind: string;
  text: string;
}

export interface Hub {
  root: string | null;
  lastScanAt: string | null;
  prefs: { autoRefresh: boolean };
  activity: ActivityItem[];
  packs: Pack[];
  appVersion: string;
  userDir: string;
  embeddedRoot?: string | null;
  hasEmbedded?: boolean;
}

export interface ProgressPayload {
  busy?: boolean;
  done?: boolean;
  stage?: 'collect' | 'hash';
  packId?: string;
  /** 已完成数量 */
  value?: number;
  total?: number;
  current?: string;
}

/* ---------------- 部署引擎 ---------------- */

export interface PlatformInfo {
  id: string;
  displayName: string;
  installed: boolean;
  installDir: string | null;
  exePath: string | null;
  configDirs: string[];
  iconPath: string | null;
}

export interface EvidenceItem {
  ok: boolean;
  label: string;
  path: string;
}

export interface BreakStatus {
  id: string;
  hasCheck: boolean;
  /** true=已生效 / false=未生效 / null=无判定依据 */
  active: boolean | null;
  items: EvidenceItem[];
}

export interface PlanInfo {
  hasInstall: boolean;
  hasUninstall: boolean;
  installFile: string | null;
  uninstallFile: string | null;
}

export interface DeployResult {
  ok: boolean;
  code: number;
  verify: BreakStatus;
}

export interface LogLine {
  id?: string;
  packId: string;
  action: 'install' | 'uninstall';
  kind: 'cmd' | 'sys' | 'out' | 'err' | 'ok' | 'fail' | 'warn';
  line: string;
}

export interface BackupItem {
  name: string;
  time: string;
}

/* ---------------- 第三方破甲包导入 ---------------- */

export interface ImportCandidate {
  platform: string;
  score: number;
}

export interface ImportedDirAnalysis {
  platform: string;
  dir: string;
  readable: boolean;
  entries: string[];
  missing: string[];
  fitRatio?: number;
  installScript: string | null;
  uninstallScript: string | null;
  version: string | null;
  versionSource: string | null;
}

export interface ImportDetection {
  kind: 'single' | 'multi-root' | 'unknown';
  inputKind?: 'file' | 'dir';
  platform?: string;
  confidence?: number;
  path: string;
  candidates?: ImportCandidate[];
  platforms?: { platform: string; folder: string; path: string; analysis?: ImportedDirAnalysis }[];
  scores?: Record<string, number>;
  error?: string;
  analysis?: ImportedDirAnalysis;
  /** 规则文件含破甲协议通用特征（石井/冷咖啡等） */
  genericHit?: boolean;
  /** 是文本规则文件、允许用户手动指定平台注入 */
  canPickManually?: boolean;
}

export interface ImportFileResult {
  ok: boolean;
  mode: 'copy' | 'append';
  dest: string;
  label: string;
}

export interface LibraryItem {
  id?: number | null;
  name: string;
  desc?: string;
  category?: string;
  category_label?: string;
  source?: string;
  success_rate?: number | null;
  content_preview?: string;
  content_length?: number;
  content?: string;
}

/* ---------------- 深度分层验证 ---------------- */

export interface VerifyLayer {
  layer: 'L1' | 'L2' | 'L3' | 'L4';
  name: string;
  ok: boolean;
  label: string;
  detail: string;
}

export interface ReplyAnalysis {
  hasShiyi: boolean;
  hasRefusal: boolean;
  hasThinking: boolean;
  hasDisclosure: boolean;
  hasRoute: boolean;
  verdict: 'active' | 'refused' | 'empty' | 'ambiguous' | 'send-failed' | string;
  length: number;
  excerpt: string;
}

export interface DeepVerifyResult {
  id: string;
  layers: VerifyLayer[];
  passAt: string | null;
  failAt: string | null;
  reply: string | null;
  analysis: ReplyAnalysis | null;
  checkedAt: string;
}

export interface DangoApi {
  load: () => Promise<Hub>;
  chooseRoot: () => Promise<Hub>;
  clearRoot: () => Promise<Hub>;
  refresh: () => Promise<Hub>;
  openRoot: () => Promise<{ ok: boolean; error?: string | null }>;
  openPack: (id: string) => Promise<{ ok: boolean; error?: string | null }>;
  captureBaseline: (id: string) => Promise<Hub>;
  verify: (id: string) => Promise<Hub>;
  clearBaseline: (id: string) => Promise<Hub>;
  exportReport: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;

  detect: () => Promise<{ platforms: Record<string, PlatformInfo>; breaks: Record<string, BreakStatus>; plans: Record<string, PlanInfo> }>;
  getIcon: (id: string) => Promise<{ id: string; dataUrl: string | null }>;
  verifyBreak: (id: string) => Promise<BreakStatus>;
  verifyDeep: (id: string) => Promise<DeepVerifyResult>;
  deploy: (id: string, action: 'install' | 'uninstall') => Promise<DeployResult>;
  cancelDeploy: () => Promise<{ ok: boolean }>;
  backup: (id: string) => Promise<{ ok: boolean; name?: string; dirs?: string[] }>;
  restore: (id: string, name: string) => Promise<{ ok: boolean }>;
  listBackups: (id: string) => Promise<BackupItem[]>;

  chooseImportPath: (kind?: 'file' | 'dir') => Promise<{ canceled: boolean; path?: string }>;
  analyzeImport: (p: string) => Promise<ImportDetection>;
  importPackDir: (p: string, platformId: string) => Promise<Hub>;
  importSingleFile: (p: string, platformId: string) => Promise<ImportFileResult>;
  clearImport: (platformId: string) => Promise<Hub>;
  listImports: () => Promise<Record<string, { kind: string; path: string; importedAt: string }>>;

  /* ---------------- 内嵌词库 ---------------- */
  libraryList: () => Promise<{ ok: boolean; prompts: LibraryItem[]; total?: number; dir?: string | null; source?: string }>;
  libraryStats: () => Promise<{ ok: boolean; total: number; categories: Record<string, number>; rates: Record<string, number>; dir: string | null; source?: string; fetchedAt?: string | null }>;
  libraryDetail: (index: number) => Promise<{ ok: boolean; detail?: LibraryItem & { content: string }; error?: string; source?: string }>;
  libraryImport: (args: { platformId: string; index: number; name: string; content: string; backup?: boolean }) => Promise<ImportFileResult>;

  onLog: (cb: (l: LogLine) => void) => () => void;
  onProgress: (cb: (p: ProgressPayload) => void) => () => void;
}

declare global {
  interface Window {
    dango?: DangoApi;
  }
}
