export type AppLocale = 'en' | 'ja';

export const APP_LOCALE_STORAGE_KEY = 'phase-field-dendrite-lab.locale';

const messages = {
  en: {
    appTitle: 'Phase-Field Dendrite Lab',
    appDescription: "A qualitative browser implementation of Ryo Kobayashi's phase-field dendrite model in 2D and 3D.",
    primaryNavigation: 'Primary navigation',
    language: 'Language',
    lab: 'Lab',
    reproductions: 'Reproductions',
    model: 'Model & Method',
    references: 'References',
    qualitativeSolver: 'Qualitative browser solver',
    githubRepository: 'GitHub repository',
    projectLinks: 'Project links',
    liveSite: 'Live site',
    copyright: '© 2026 dueyama. Released under the MIT License.',
    run: 'Run',
    pause: 'Pause',
    step: 'Step',
    reset: 'Reset',
    newSeed: 'New seed',
    loading: 'Loading',
    failed: 'Failed',
    mesh: 'Mesh',
    domain: 'Domain',
    boundary: 'Boundary',
    anisotropy: 'Anisotropy',
    noise: 'Noise',
    nucleus: 'Nucleus',
    solver: 'Solver',
    render: 'Render',
    isotropic: 'isotropic',
    noFlux: 'no-flux',
    fixedTemperature: 'fixed temperature',
    leftFixedTemperature: 'left fixed T',
    initializing: 'Initializing',
    initializingWebGpu: 'Initializing WebGPU...',
    cpuFallback: 'CPU fallback',
    webGpuExperimental: 'WebGPU experimental',
    cpuImplicitT: 'CPU implicit T',
    finalStateViewer: 'Final state viewer',
    isosurface: 'Isosurface',
    slices: 'Slices',
    volume: 'Volume'
  },
  ja: {
    appTitle: 'フェーズフィールド・デンドライト・ラボ',
    appDescription: '小林亮のフェーズフィールド・デンドライトモデルを2D・3Dで定性的に試せるブラウザシミュレータです。',
    primaryNavigation: 'メインナビゲーション',
    language: '言語',
    lab: 'ラボ',
    reproductions: '再現図',
    model: 'モデルと手法',
    references: '参考文献',
    qualitativeSolver: '定性的ブラウザソルバー',
    githubRepository: 'GitHubリポジトリ',
    projectLinks: 'プロジェクトリンク',
    liveSite: '公開サイト',
    copyright: '© 2026 dueyama. MIT License.',
    run: '実行',
    pause: '一時停止',
    step: '1ステップ',
    reset: 'リセット',
    newSeed: '乱数を変更',
    loading: '読み込み中',
    failed: '失敗',
    mesh: 'メッシュ',
    domain: '計算領域',
    boundary: '境界条件',
    anisotropy: '異方性',
    noise: 'ノイズ',
    nucleus: '初期核',
    solver: 'ソルバー',
    render: '表示',
    isotropic: '等方',
    noFlux: '断熱・流束なし',
    fixedTemperature: '固定温度',
    leftFixedTemperature: '左壁温度固定',
    initializing: '初期化中',
    initializingWebGpu: 'WebGPUを初期化中...',
    cpuFallback: 'CPUへ切替',
    webGpuExperimental: 'WebGPU実験版',
    cpuImplicitT: 'CPU・T陰解法',
    finalStateViewer: '最終状態ビューア',
    isosurface: '等値面',
    slices: '断面',
    volume: 'ボリューム'
  }
} as const;

export type MessageKey = keyof (typeof messages)['en'];

let activeLocale: AppLocale = 'en';

export function detectInitialLocale(
  storedLocale: string | null = readStoredLocale(),
  browserLanguage: string | undefined = typeof navigator === 'undefined' ? undefined : navigator.language
): AppLocale {
  if (storedLocale === 'en' || storedLocale === 'ja') return storedLocale;
  return browserLanguage?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export function initializeLocale(): AppLocale {
  activeLocale = detectInitialLocale();
  applyLocaleToDocument(activeLocale);
  return activeLocale;
}

export function getLocale(): AppLocale {
  return activeLocale;
}

export function setLocale(locale: AppLocale, persist = true): void {
  activeLocale = locale;
  if (persist && typeof localStorage !== 'undefined') {
    localStorage.setItem(APP_LOCALE_STORAGE_KEY, locale);
  }
  applyLocaleToDocument(locale);
}

export function isJapanese(): boolean {
  return activeLocale === 'ja';
}

export function t(key: MessageKey): string {
  return messages[activeLocale][key];
}

export function localeTag(): string {
  return activeLocale === 'ja' ? 'ja-JP' : 'en-US';
}

function readStoredLocale(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(APP_LOCALE_STORAGE_KEY);
}

function applyLocaleToDocument(locale: AppLocale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.title = messages[locale].appTitle;
  document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content', messages[locale].appDescription);
}
