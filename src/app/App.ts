import { SceneRenderer } from '../render/scene';
import { PhaseField2D } from '../simulation/phaseField2D';
import { PhaseField2DWebGpu, webGpuAvailability } from '../simulation/phaseField2DWebGpu';
import { PhaseField3D } from '../simulation/phaseField3D';
import { PhaseField3DWebGpu } from '../simulation/phaseField3DWebGpu';
import { PhaseField3DWorkerProxy } from '../simulation/phaseField3DWorkerProxy';
import { clonePreset, labPresets, presets } from '../simulation/presets';
import { createStateExportBlob, parseStateExportArrayBuffer } from '../simulation/stateExport';
import { createIsosurfaceStlBlob } from '../simulation/stlExport';
import {
  getLocale,
  initializeLocale,
  isJapanese,
  localeTag,
  setLocale as setAppLocale,
  t,
  type AppLocale
} from './i18n';
import {
  localizedPaperDetails,
  localizedPresetDescription,
  localizedPresetName
} from './presetLocalization';
import { detectRuntimeProfile } from './runtimeProfile';
import type {
  BoundaryCondition,
  Dimension,
  PhaseFieldConfig,
  RenderMode3D,
  SimulationSnapshot,
  SolverBackend,
  StepStats,
  ViewMode
} from '../simulation/types';

type Solver = PhaseField2D | PhaseField2DWebGpu | PhaseField3D | PhaseField3DWebGpu | PhaseField3DWorkerProxy;
type Page = 'lab' | 'reproduction' | 'model' | 'references';

const APP_LINKS = {
  github: 'https://github.com/dueyama/kobayashi-phase-field-lab',
  liveSite: 'https://kobayashi-phase-field-lab.vercel.app'
};

const DEFAULT_LAB_PRESET_ID = 'paper-fig8-k200-sixfold';
const DEFAULT_2D_SOLVER_BACKEND: SolverBackend = 'webgpu-experimental';
const DEFAULT_3D_SOLVER_BACKEND: SolverBackend = 'webgpu-experimental';
const WEBGPU_DT_QUANTUM = 0.000025;
const WEBGPU_MAX_DT = 0.0001;
const WEBGPU_3D_MAX_DT = 0.00005;
const WEBGPU_HIGH_K_MAX_DT = 0.00005;
const WEBGPU_STABILITY_SAFETY = 0.8;
const WEBGPU_MAX_STEPS_PER_FRAME = 120;
const WEBGPU_3D_MAX_STEPS_PER_FRAME = 1000;
const WEBGPU_3D_TARGET_TIME_PER_FRAME = 0.00225;
const WEBGPU_REPRODUCTION_VERSION = 'dt50-matched-20260619';

function labConfigForPreset(presetId: string): PhaseFieldConfig {
  const config = clonePreset(presetId);
  if (config.dimension === '2d') {
    config.solverBackend = DEFAULT_2D_SOLVER_BACKEND;
    if (config.solverBackend === 'webgpu-experimental') applyWebGpuNumerics(config, { forcePresetSteps: true });
  } else {
    config.solverBackend = DEFAULT_3D_SOLVER_BACKEND;
    config.surfaceFrameGuarantee3D ??= true;
    if (config.solverBackend === 'webgpu-experimental') applyWebGpuNumerics(config, { forcePresetSteps: true });
  }
  return config;
}

function applyWebGpuNumerics(config: PhaseFieldConfig, options: { forcePresetSteps?: boolean } = {}): void {
  config.noiseReferenceDt ??= config.dt;
  const recommendedDt = recommendedWebGpuDt(config);
  if (config.dt > recommendedDt) config.dt = recommendedDt;

  if (config.dimension === '3d') {
    const defaultSteps = webGpu3DDefaultStepsPerFrame(config);
    const nextSteps = options.forcePresetSteps ? defaultSteps : Math.max(config.stepsPerFrame, defaultSteps);
    config.stepsPerFrame = clampInteger(nextSteps, 1, WEBGPU_3D_MAX_STEPS_PER_FRAME);
    return;
  }

  const targetFrameTime = Math.max(config.dt * config.stepsPerFrame, config.dt);
  config.stepsPerFrame = Math.max(
    1,
    Math.min(WEBGPU_MAX_STEPS_PER_FRAME, Math.max(config.stepsPerFrame, Math.round(targetFrameTime / config.dt)))
  );
}

function webGpu3DDefaultStepsPerFrame(config: PhaseFieldConfig): number {
  if (config.id === 'paper-fig9-3d-left-target') return 500;
  if (config.id === 'paper-fig9-3d-right-target') return 1000;
  return Math.max(config.stepsPerFrame, Math.round(WEBGPU_3D_TARGET_TIME_PER_FRAME / config.dt));
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function recommendedWebGpuDt(config: PhaseFieldConfig): number {
  const stabilityLimit = explicitTStabilityLimit(config, config.dimension === '3d' ? 3 : 2);
  const dimensionLimit = config.dimension === '3d' ? WEBGPU_3D_MAX_DT : WEBGPU_MAX_DT;
  const highKLimit = config.latentHeat >= 3 ? WEBGPU_HIGH_K_MAX_DT : dimensionLimit;
  const target = Math.min(config.dt, dimensionLimit, highKLimit, stabilityLimit * WEBGPU_STABILITY_SAFETY);
  const quantized = Math.floor((target + Number.EPSILON) / WEBGPU_DT_QUANTUM) * WEBGPU_DT_QUANTUM;
  return Math.max(WEBGPU_DT_QUANTUM, quantized);
}

function dtSliderRange(config: PhaseFieldConfig): { min: number; max: number; step: number } {
  const practicalMax = config.dimension === '3d' || config.solverBackend === 'webgpu-experimental' ? 0.0005 : 0.001;
  return {
    min: WEBGPU_DT_QUANTUM,
    max: Math.max(practicalMax, config.dt),
    step: WEBGPU_DT_QUANTUM
  };
}

function restorePresetCpuNumerics(config: PhaseFieldConfig): void {
  const preset = presets.find((item) => item.id === config.id);
  if (!preset) return;
  config.dt = preset.dt;
  config.stepsPerFrame = preset.stepsPerFrame;
  config.noiseReferenceDt = undefined;
}

export class PhaseFieldApp {
  private locale: AppLocale = initializeLocale();
  private config: PhaseFieldConfig = labConfigForPreset(DEFAULT_LAB_PRESET_ID);
  private solver: Solver = new PhaseField2D({ ...this.config, solverBackend: 'cpu' });
  private renderer: SceneRenderer | null = null;
  private running = false;
  private page: Page = 'lab';
  private lastFrame = performance.now();
  private fps = 0;
  private animationFrameId: number | null = null;
  private unstable = false;
  private stepping = false;
  private solverStatus = t('initializingWebGpu');
  private activeBackendLabel = t('initializing');
  private computeStepsPerSecond = 0;
  private benchmarkRunning = false;
  private viewRoot: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private latestStepStats: StepStats | null = null;
  private reproductionState:
    | {
        snapshot: SimulationSnapshot;
        config: PhaseFieldConfig;
      }
    | null = null;

  constructor(private readonly root: HTMLElement) {}

  start(): void {
    this.root.innerHTML = shellTemplate(this.page);
    this.viewRoot = this.root.querySelector<HTMLElement>('[data-view-root]');
    this.bindTopNav();
    void this.recreateSolver(true).then(() => this.showLab());
    window.addEventListener('resize', () => this.renderer?.resize());
  }

  private async tick(time: number): Promise<void> {
    this.animationFrameId = null;
    if (!this.running || this.page !== 'lab' || this.stepping) return;

    const delta = Math.max(1, time - this.lastFrame);
    this.fps = this.fps * 0.88 + (1000 / delta) * 0.12;
    this.lastFrame = time;

    if (!this.unstable) {
      let stats: StepStats;
      const computeStartedAt = performance.now();
      try {
        stats = await this.stepSolver(this.config.stepsPerFrame);
      } catch (error: unknown) {
        if (!this.running) return;
        this.running = false;
        this.solverStatus = solverStoppedMessage(error);
        this.showLab();
        return;
      }
      const computeMilliseconds = Math.max(performance.now() - computeStartedAt, 0.01);
      const currentStepsPerSecond = (this.config.stepsPerFrame * 1000) / computeMilliseconds;
      this.computeStepsPerSecond =
        this.computeStepsPerSecond === 0
          ? currentStepsPerSecond
          : this.computeStepsPerSecond * 0.75 + currentStepsPerSecond * 0.25;
      if (!this.running || this.page !== 'lab') return;
      this.latestStepStats = stats;
      this.unstable = stats.unstable;
    }

    const snapshot = this.solver.snapshot();
    const renderPromise = this.renderer?.render(snapshot, this.config);
    this.updateTelemetry(snapshot);
    if (this.shouldWaitForSurfaceFrame(renderPromise)) {
      await renderPromise;
      if (!this.running || this.page !== 'lab') return;
    }

    if (this.running && !this.unstable) {
      this.animationFrameId = requestAnimationFrame((next) => void this.tick(next));
    } else {
      this.running = false;
      this.updateRunButton();
      this.updateTelemetry(snapshot);
    }
  }

  private startLoop(): void {
    if (this.animationFrameId !== null) return;
    this.fps = 0;
    this.lastFrame = performance.now();
    this.animationFrameId = requestAnimationFrame((time) => void this.tick(time));
  }

  private stopLoop(): void {
    if (this.animationFrameId === null) return;
    cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
  }

  private renderCurrentState(force = true): void {
    const snapshot = this.solver.snapshot();
    void this.renderer?.render(snapshot, this.config, force);
    this.updateTelemetry(snapshot);
  }

  private shouldWaitForSurfaceFrame(renderPromise: Promise<void> | undefined): renderPromise is Promise<void> {
    return (
      renderPromise !== undefined &&
      this.config.dimension === '3d' &&
      this.config.renderMode3D === 'surface' &&
      this.config.surfaceFrameGuarantee3D === true
    );
  }

  private bindTopNav(): void {
    this.root.querySelectorAll<HTMLButtonElement>('.nav-tab').forEach((button) => {
      button.addEventListener('click', () => {
        const next = button.dataset.page as Page;
        this.setPage(next);
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-locale]').forEach((button) => {
      button.addEventListener('click', () => {
        const locale = button.dataset.locale as AppLocale | undefined;
        if (locale) this.setLocale(locale);
      });
    });
  }

  private setLocale(locale: AppLocale): void {
    if (locale === this.locale) return;
    this.stopLoop();
    this.renderer?.dispose();
    this.renderer = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.locale = locale;
    setAppLocale(locale);
    this.solverStatus = localizedSolverStatus(this.solverStatus);
    this.activeBackendLabel = localizedActiveBackendLabel(this.activeBackendLabel);
    this.root.innerHTML = shellTemplate(this.page);
    this.viewRoot = this.root.querySelector<HTMLElement>('[data-view-root]');
    this.bindTopNav();
    if (this.page === 'lab') this.showLab();
    if (this.page === 'reproduction') this.showReproduction();
    if (this.page === 'model') this.showModel();
    if (this.page === 'references') this.showReferences();
  }

  private setPage(page: Page): void {
    if (page === this.page) return;
    if (page !== 'lab') {
      this.running = false;
      this.stopLoop();
    }
    this.page = page;
    this.root.querySelectorAll<HTMLButtonElement>('.nav-tab').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.page === page));
    });
    this.renderer?.dispose();
    this.renderer = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (page === 'lab') this.showLab();
    if (page === 'reproduction') this.showReproduction();
    if (page === 'model') this.showModel();
    if (page === 'references') this.showReferences();
  }

  private showLab(): void {
    if (!this.viewRoot) return;
    this.renderer?.dispose();
    this.renderer = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.viewRoot.innerHTML = labTemplate(this.config, this.running, this.solverStatus, this.benchmarkRunning);
    const viewport = this.viewRoot.querySelector<HTMLElement>('[data-viewport]');
    if (!viewport) throw new Error('Missing viewport host.');
    this.renderer = new SceneRenderer(viewport);
    this.resizeObserver = new ResizeObserver(() => this.renderer?.resize());
    this.resizeObserver.observe(viewport);
    this.bindLabControls();
    this.renderCurrentState(true);
    if (this.running) this.startLoop();
  }

  private showModel(): void {
    if (!this.viewRoot) return;
    this.viewRoot.innerHTML = modelTemplate();
  }

  private showReferences(): void {
    if (!this.viewRoot) return;
    this.viewRoot.innerHTML = referencesTemplate();
  }

  private showReproduction(): void {
    if (!this.viewRoot) return;
    this.reproductionState = null;
    this.viewRoot.innerHTML = reproductionTemplate();
    this.bindReproductionControls();
  }

  private bindReproductionControls(): void {
    this.viewRoot?.querySelectorAll<HTMLButtonElement>('[data-reproduction-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        const presetId = button.dataset.reproductionPreset;
        if (presetId) void this.openPresetInLab(presetId);
      });
    });
    this.viewRoot?.querySelectorAll<HTMLButtonElement>('[data-reproduction-state]').forEach((button) => {
      button.addEventListener('click', () => {
        const stateUrl = button.dataset.reproductionState;
        const presetId = button.dataset.reproductionStatePreset;
        if (stateUrl && presetId) void this.loadReproductionState(stateUrl, presetId);
      });
    });
    this.viewRoot?.querySelectorAll<HTMLButtonElement>('[data-k2002-render-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        const renderMode = button.dataset.k2002RenderMode as RenderMode3D | undefined;
        if (renderMode) this.setReproductionRenderMode(renderMode);
      });
    });
  }

  private async openPresetInLab(presetId: string): Promise<void> {
    if (!presets.some((preset) => preset.id === presetId)) return;
    this.config = labConfigForPreset(presetId);
    this.running = false;
    this.stopLoop();
    await this.recreateSolver(true);
    if (this.page === 'lab') {
      this.showLab();
      return;
    }
    this.setPage('lab');
  }

  private async loadReproductionState(stateUrl: string, presetId: string): Promise<void> {
    const viewer = this.viewRoot?.querySelector<HTMLElement>('[data-k2002-state-viewer]');
    const host = this.viewRoot?.querySelector<HTMLElement>('[data-k2002-state-host]');
    const status = this.viewRoot?.querySelector<HTMLElement>('[data-k2002-state-status]');
    const title = this.viewRoot?.querySelector<HTMLElement>('[data-k2002-state-title]');
    if (!viewer || !host || !status || !title) return;

    viewer.hidden = false;
    title.textContent = ui('Loading final state', '最終状態を読み込み中');
    status.textContent = ui('Fetching public .pfstate field data...', '公開.pfstate場データを取得しています...');
    host.replaceChildren();

    try {
      const response = await fetch(stateUrl);
      if (!response.ok) throw new Error(`failed to load state: ${response.status}`);
      const parsed = parseStateExportArrayBuffer(await response.arrayBuffer());
      const preset = presets.find((item) => item.id === presetId);
      const viewerConfig: PhaseFieldConfig = {
        ...parsed.config,
        renderMode3D: 'surface',
        surfaceStyle3D: 'gold',
        presentationView3D: parsed.config.presentationView3D ?? preset?.presentationView3D,
        interactiveView3D: true
      };

      this.renderer?.dispose();
      this.renderer = new SceneRenderer(host);
      this.resizeObserver?.disconnect();
      this.resizeObserver = new ResizeObserver(() => {
        this.renderer?.resize();
        this.renderer?.render(parsed.snapshot, viewerConfig, true);
      });
      this.resizeObserver.observe(host);
      this.reproductionState = { snapshot: parsed.snapshot, config: viewerConfig };
      this.renderer.render(parsed.snapshot, viewerConfig, true);
      this.syncReproductionRenderMode('surface');

      title.textContent = preset ? localizedPresetName(preset) : t('finalStateViewer');
      status.textContent = this.reproductionStateStatus(parsed.snapshot, viewerConfig);
      viewer.scrollIntoView({ block: 'nearest' });
    } catch (error: unknown) {
      title.textContent = ui('Final state failed to load', '最終状態を読み込めませんでした');
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  private setReproductionRenderMode(renderMode: RenderMode3D): void {
    if (!this.reproductionState || !this.renderer) return;
    this.reproductionState.config.renderMode3D = renderMode;
    this.renderer.render(this.reproductionState.snapshot, this.reproductionState.config, true);
    this.syncReproductionRenderMode(renderMode);
    const status = this.viewRoot?.querySelector<HTMLElement>('[data-k2002-state-status]');
    if (status) status.textContent = this.reproductionStateStatus(this.reproductionState.snapshot, this.reproductionState.config);
  }

  private syncReproductionRenderMode(renderMode: RenderMode3D): void {
    this.viewRoot?.querySelectorAll<HTMLButtonElement>('[data-k2002-render-mode]').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.k2002RenderMode === renderMode));
    });
  }

  private reproductionStateStatus(snapshot: SimulationSnapshot, config: PhaseFieldConfig): string {
    const mode =
      config.renderMode3D === 'surface'
        ? 'p=0.5 isosurface'
        : config.renderMode3D === 'volume'
          ? 'Data3DTexture ray-marched volume'
          : 'orthogonal slices';
    const mirrorNote = config.nucleusPlacement === 'bottom-corner-halfcell' ? ', x-y mirrored for display' : '';
    if (isJapanese()) {
      const japaneseMode =
        config.renderMode3D === 'surface'
          ? 'p=0.5等値面'
          : config.renderMode3D === 'volume'
            ? 'Data3DTextureレイマーチング・ボリューム'
            : '直交断面';
      const japaneseMirror = config.nucleusPlacement === 'bottom-corner-halfcell' ? '、表示はx-y反転' : '';
      return `${meshLabel(config)}メッシュ${japaneseMirror}、t=${snapshot.time.toFixed(3)}、step=${snapshot.step.toLocaleString(localeTag())}、${japaneseMode}。ドラッグで回転、スクロールまたはピンチで拡大縮小できます。`;
    }
    return `${meshLabel(config)} mesh${mirrorNote}, t=${snapshot.time.toFixed(3)}, step=${snapshot.step.toLocaleString(localeTag())}, ${mode}. Drag to rotate; scroll or pinch to zoom.`;
  }

  private bindLabControls(): void {
    const root = this.viewRoot;
    if (!root) return;

    root.querySelector<HTMLSelectElement>('[data-field="preset"]')?.addEventListener('change', (event) => {
      const id = (event.currentTarget as HTMLSelectElement).value;
      this.config = labConfigForPreset(id);
      this.running = false;
      this.stopLoop();
      void this.recreateSolver(true).then(() => this.showLab());
    });

    root.querySelectorAll<HTMLButtonElement>('[data-dimension]').forEach((button) => {
      button.addEventListener('click', () => {
        const dimension = button.dataset.dimension as Dimension;
        const preset = labPresets.find((item) => item.dimension === dimension) ?? labPresets[0] ?? presets[0];
        this.config = labConfigForPreset(preset.id);
        this.running = false;
        this.stopLoop();
        void this.recreateSolver(true).then(() => this.showLab());
      });
    });

    root.querySelectorAll<HTMLButtonElement>('[data-action="run"]').forEach((button) => {
      button.addEventListener('click', () => {
        this.running = !this.running;
        if (!this.running) this.stopLoop();
        this.showLab();
        if (this.running) this.startLoop();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-action="step"]').forEach((button) => {
      button.addEventListener('click', () => {
        void this.stepOnce();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-action="reset"]').forEach((button) => {
      button.addEventListener('click', () => {
        void this.recreateSolver(true).then(() => this.renderCurrentState(true));
      });
    });
    root.querySelector<HTMLButtonElement>('[data-action="random-seed"]')?.addEventListener('click', () => {
      this.config.seed = Math.floor(1 + Math.random() * 999999);
      void this.recreateSolver(true).then(() => this.showLab());
    });
    root.querySelector<HTMLButtonElement>('[data-action="export"]')?.addEventListener('click', () => {
      this.exportParameters();
    });
    root.querySelector<HTMLButtonElement>('[data-action="save-state"]')?.addEventListener('click', () => {
      this.exportState();
    });
    root.querySelector<HTMLButtonElement>('[data-action="stl"]')?.addEventListener('click', () => {
      this.exportStl(false);
    });
    root.querySelector<HTMLButtonElement>('[data-action="stl-mirror"]')?.addEventListener('click', () => {
      this.exportStl(true);
    });
    root.querySelector<HTMLButtonElement>('[data-action="screenshot"]')?.addEventListener('click', () => {
      this.exportScreenshot();
    });
    root.querySelector<HTMLButtonElement>('[data-action="benchmark"]')?.addEventListener('click', () => {
      void this.runBenchmark();
    });
    root.querySelector<HTMLButtonElement>('[data-action="dt-sweep"]')?.addEventListener('click', () => {
      void this.runDtSweep();
    });

    bindNumber(root, 'stepsPerFrame', (value) => {
      this.config.stepsPerFrame = Math.max(1, Math.round(value));
    });
    bindNumber(root, 'seed', (value) => {
      this.config.seed = Math.max(1, Math.round(value));
      void this.recreateSolver(true).then(() => this.renderCurrentState(true));
    });
    bindSelect(root, 'viewMode', (value) => {
      this.config.viewMode = value as ViewMode;
      this.renderCurrentState(true);
    });
    bindSelect(root, 'renderMode3D', (value) => {
      this.config.renderMode3D = value as RenderMode3D;
      this.renderCurrentState(true);
    });
    bindCheckbox(root, 'surfaceFrameGuarantee3D', (checked) => {
      this.config.surfaceFrameGuarantee3D = checked;
    });
    bindSelect(root, 'boundaryCondition', (value) => {
      this.config.boundaryCondition = value as BoundaryCondition;
    });
    bindSelect(root, 'solverBackend', (value) => {
      this.config.solverBackend = value as SolverBackend;
      if (this.config.solverBackend === 'webgpu-experimental') {
        applyWebGpuNumerics(this.config);
      } else {
        restorePresetCpuNumerics(this.config);
      }
      this.running = false;
      this.stopLoop();
      void this.recreateSolver(true).then(() => this.showLab());
    });
    bindRange(root, 'anisotropyStrength', (value) => {
      this.config.anisotropyStrength = value;
      this.syncRangeLabel('anisotropyStrength', value.toFixed(3));
    });
    bindRange(root, 'latentHeat', (value) => {
      this.config.latentHeat = value;
      if (this.config.solverBackend === 'webgpu-experimental') {
        applyWebGpuNumerics(this.config);
        this.syncRangeLabel('dt', formatDt(this.config.dt));
      }
      this.syncRangeLabel('latentHeat', value.toFixed(2));
    });
    bindRange(root, 'undercooling', (value) => {
      this.config.undercooling = value;
      this.syncRangeLabel('undercooling', value.toFixed(2));
    });
    bindRange(root, 'noiseAmplitude', (value) => {
      this.config.noiseAmplitude = value;
      this.syncRangeLabel('noiseAmplitude', value.toFixed(3));
    });
    bindRange(root, 'dt', (value) => {
      this.config.dt = value;
      if (this.config.solverBackend === 'webgpu-experimental') this.config.noiseReferenceDt ??= value;
      this.syncRangeLabel('dt', formatDt(value));
    });
    bindSelect(root, 'gridSize', (value) => {
      const [nx, ny = nx, nz = nx] = value.split('x').map(Number);
      this.config.nx = nx;
      this.config.ny = ny;
      this.config.nz = this.config.dimension === '3d' ? nz : 1;
      this.config.nucleusRadius =
        this.config.nucleusPlacement === 'left-wall'
          ? Math.max(4, Math.round(nx * 0.045))
          : Math.max(4, Math.round(Math.min(nx, ny) * (this.config.dimension === '3d' ? 0.13 : 0.055)));
      void this.recreateSolver(true).then(() => this.showLab());
    });
  }

  private async stepOnce(): Promise<void> {
    if (this.stepping) return;
    let stats: StepStats;
    try {
      stats = await this.stepSolver(1);
    } catch (error: unknown) {
      this.solverStatus = solverStoppedMessage(error);
      this.showLab();
      return;
    }
    this.latestStepStats = stats;
    this.unstable = stats.unstable;
    this.renderCurrentState(true);
  }

  private async stepSolver(count: number): Promise<StepStats> {
    this.stepping = true;
    try {
      return await this.solver.step(count);
    } finally {
      this.stepping = false;
    }
  }

  private async recreateSolver(resetUnstable: boolean): Promise<void> {
    this.disposeSolver();
    this.latestStepStats = null;
    if ((this.config.solverBackend ?? 'cpu') === 'webgpu-experimental') {
      try {
        this.solver =
          this.config.dimension === '2d' ? await PhaseField2DWebGpu.create(this.config) : await PhaseField3DWebGpu.create(this.config);
        this.activeBackendLabel = 'GPU · WebGPU';
        this.solverStatus =
          this.config.dimension === '2d'
            ? ui('WebGPU experimental 2D: explicit p / explicit T', 'WebGPU実験版2D: p陽解法 / T陽解法')
            : ui(
                `WebGPU experimental 3D: explicit p / explicit T · ${detectRuntimeProfile()} batch`,
                `WebGPU実験版3D: p陽解法 / T陽解法 · ${detectRuntimeProfile()}バッチ`
              );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.config.solverBackend = 'cpu';
        restorePresetCpuNumerics(this.config);
        if (this.config.dimension === '2d') {
          this.solver = new PhaseField2D(this.config);
          this.activeBackendLabel = 'CPU';
          this.solverStatus = `${t('cpuFallback')}: ${message}`;
        } else {
          this.solver = await PhaseField3DWorkerProxy.create(this.config);
          this.activeBackendLabel = ui('CPU · Worker', 'CPU · ワーカー');
          this.solverStatus = `${ui('CPU worker fallback', 'CPUワーカーへ切替')}: ${message}`;
        }
      }
    } else {
      if (this.config.dimension === '2d') {
        this.solver = new PhaseField2D(this.config);
        this.activeBackendLabel = 'CPU';
        this.solverStatus = ui('CPU: explicit p / implicit T', 'CPU: p陽解法 / T陰解法');
      } else {
        this.solver = await PhaseField3DWorkerProxy.create(this.config);
        this.activeBackendLabel = ui('CPU · Worker', 'CPU · ワーカー');
        this.solverStatus = ui('CPU worker: 3D explicit p / implicit T', 'CPUワーカー: 3D p陽解法 / T陰解法');
      }
    }
    this.computeStepsPerSecond = 0;
    if (resetUnstable) this.unstable = false;
  }

  private disposeSolver(): void {
    if (
      this.solver instanceof PhaseField2DWebGpu ||
      this.solver instanceof PhaseField3DWebGpu ||
      this.solver instanceof PhaseField3DWorkerProxy
    ) {
      this.solver.dispose();
    }
  }

  private updateTelemetry(snapshot: SimulationSnapshot): void {
    const set = (key: string, value: string) => {
      const node = this.viewRoot?.querySelector<HTMLElement>(`[data-telemetry="${key}"]`);
      if (node) node.textContent = value;
    };
    set('step', snapshot.step.toLocaleString(localeTag()));
    set('time', snapshot.time.toFixed(2));
    set(
      'rate',
      this.running && this.computeStepsPerSecond > 0
        ? `${this.computeStepsPerSecond.toFixed(1)} ${ui('steps/s', 'ステップ/秒')}`
        : ui('Idle', '停止中')
    );
    set(
      'grid',
      snapshot.dimension === '2d'
        ? `${snapshot.nx} x ${snapshot.ny}`
        : snapshot.nx === snapshot.ny && snapshot.ny === snapshot.nz
          ? `${snapshot.nx}^3`
          : `${snapshot.nx} x ${snapshot.ny} x ${snapshot.nz}`
    );
    set('phi', `${snapshot.minPhi.toFixed(2)} / ${snapshot.maxPhi.toFixed(2)}`);
    set('temp', `${snapshot.minTemperature.toFixed(2)} / ${snapshot.maxTemperature.toFixed(2)}`);
    const backend = this.viewRoot?.querySelector<HTMLElement>('[data-active-backend]');
    if (backend) backend.textContent = this.activeBackendLabel;
    const warning = this.viewRoot?.querySelector<HTMLElement>('[data-warning]');
    const diagnostics = this.viewRoot?.querySelector<HTMLElement>('[data-solver-diagnostics]');
    if (diagnostics) diagnostics.textContent = formatSolverDiagnostics(this.latestStepStats, this.config);
    if (warning && this.latestStepStats) {
      warning.textContent = instabilityWarning(this.latestStepStats);
    }
    warning?.classList.toggle('visible', this.unstable);
  }

  private updateRunButton(): void {
    this.viewRoot?.querySelectorAll<HTMLButtonElement>('[data-action="run"]').forEach((button) => {
      button.textContent = this.running ? t('pause') : t('run');
    });
  }

  private syncRangeLabel(field: string, value: string): void {
    const node = this.viewRoot?.querySelector<HTMLElement>(`[data-value="${field}"]`);
    if (node) node.textContent = value;
  }

  private async runBenchmark(): Promise<void> {
    if (this.benchmarkRunning) return;
    this.running = false;
    this.stopLoop();
    this.benchmarkRunning = true;
    const status = this.viewRoot?.querySelector<HTMLElement>('[data-benchmark-status]');
    const button = this.viewRoot?.querySelector<HTMLButtonElement>('[data-action="benchmark"]');
    if (button) {
      button.disabled = true;
      button.textContent = ui('Benchmarking...', '計測中...');
    }
    if (status) status.textContent = ui('Running CPU benchmark...', 'CPUベンチマークを実行中...');

    const benchmarkConfig: PhaseFieldConfig = {
      ...this.config,
      nz: this.config.dimension === '2d' ? 1 : this.config.nz,
      solverBackend: 'cpu'
    };
    const steps = benchmarkStepCount(benchmarkConfig);
    try {
      const cpuSolver = benchmarkConfig.dimension === '2d' ? new PhaseField2D(benchmarkConfig) : new PhaseField3D(benchmarkConfig);
      const cpuStart = performance.now();
      cpuSolver.step(steps);
      const cpuMs = performance.now() - cpuStart;
      const cpuSnapshot = cpuSolver.snapshot();
      const targetTime = benchmarkConfig.dt * steps;
      const availability = webGpuAvailability();
      if (!availability.available) {
        if (status) {
          status.textContent = ui(
            `CPU ${steps} steps: ${formatBenchmark(cpuMs, steps)}. WebGPU unavailable: ${availability.reason}`,
            `CPU ${steps}ステップ: ${formatBenchmark(cpuMs, steps)}。WebGPUは利用不可: ${availability.reason}`
          );
        }
        return;
      }

      if (status) status.textContent = ui('Running WebGPU benchmark...', 'WebGPUベンチマークを実行中...');
      const gpuConfig: PhaseFieldConfig = { ...benchmarkConfig, solverBackend: 'webgpu-experimental' };
      if (gpuConfig.solverBackend === 'webgpu-experimental') applyWebGpuNumerics(gpuConfig);
      const gpuSteps = Math.max(1, Math.round(targetTime / gpuConfig.dt));
      const gpuSolver =
        benchmarkConfig.dimension === '2d' ? await PhaseField2DWebGpu.create(gpuConfig) : await PhaseField3DWebGpu.create(gpuConfig);
      try {
        const gpuStart = performance.now();
        await gpuSolver.step(gpuSteps);
        const gpuMs = performance.now() - gpuStart;
        const speedup = cpuMs / Math.max(gpuMs, 1e-6);
        const gpuSnapshot = gpuSolver.snapshot();
        const phiDifference = compareFields(cpuSnapshot.phi, gpuSnapshot.phi);
        const temperatureDifference = compareFields(cpuSnapshot.temperature, gpuSnapshot.temperature);
        if (status) {
          status.textContent = ui(
            `${benchmarkConfig.dimension.toUpperCase()} same-time t=${compactNumber(targetTime)}: CPU ${steps} steps ${formatBenchmark(cpuMs, steps)}; WebGPU ${gpuSteps} steps ${formatBenchmark(gpuMs, gpuSteps)} at dt=${compactNumber(gpuConfig.dt)}; wall-clock speedup ${speedup.toFixed(2)}x; Δp max/RMS ${phiDifference.max.toExponential(2)}/${phiDifference.rms.toExponential(2)}, ΔT max/RMS ${temperatureDifference.max.toExponential(2)}/${temperatureDifference.rms.toExponential(2)}.`,
            `${benchmarkConfig.dimension.toUpperCase()} 同一時刻 t=${compactNumber(targetTime)}: CPU ${steps}ステップ ${formatBenchmark(cpuMs, steps)}、WebGPU ${gpuSteps}ステップ ${formatBenchmark(gpuMs, gpuSteps)}（dt=${compactNumber(gpuConfig.dt)}）、実時間速度比 ${speedup.toFixed(2)}倍、Δp 最大/RMS ${phiDifference.max.toExponential(2)}/${phiDifference.rms.toExponential(2)}、ΔT 最大/RMS ${temperatureDifference.max.toExponential(2)}/${temperatureDifference.rms.toExponential(2)}。`
          );
        }
      } finally {
        gpuSolver.dispose();
      }
    } catch (error: unknown) {
      if (status) {
        const message = error instanceof Error ? error.message : String(error);
        status.textContent = `${ui('Benchmark failed', 'ベンチマーク失敗')}: ${message}`;
      }
    } finally {
      this.benchmarkRunning = false;
      if (button) {
        button.disabled = false;
        button.textContent = ui('Benchmark CPU / WebGPU', 'CPU / WebGPU速度比較');
      }
    }
  }

  private async runDtSweep(): Promise<void> {
    if (this.benchmarkRunning) return;
    this.running = false;
    this.stopLoop();
    this.benchmarkRunning = true;
    const status = this.viewRoot?.querySelector<HTMLElement>('[data-benchmark-status]');
    const buttons = this.viewRoot?.querySelectorAll<HTMLButtonElement>('[data-action="benchmark"], [data-action="dt-sweep"]');
    buttons?.forEach((button) => {
      button.disabled = true;
    });

    const availability = webGpuAvailability();
    if (!availability.available) {
      if (status) status.textContent = `${ui('dt sweep needs WebGPU', 'dt比較にはWebGPUが必要です')}: ${availability.reason}`;
      buttons?.forEach((button) => {
        button.disabled = false;
      });
      this.benchmarkRunning = false;
      return;
    }

    const baseConfig: PhaseFieldConfig = {
      ...this.config,
      nz: this.config.dimension === '2d' ? 1 : this.config.nz,
      noiseAmplitude: 0
    };
    const baseSteps = Math.min(32, benchmarkStepCount(baseConfig));
    const targetTime = baseConfig.dt * baseSteps;
    const dtValues = [baseConfig.dt, baseConfig.dt / 2, baseConfig.dt / 4, baseConfig.dt / 8].filter(
      (value, index, values) => value > 0 && values.indexOf(value) === index
    );
    const rows: string[] = [];

    try {
      for (const dt of dtValues) {
        const steps = Math.max(1, Math.round(targetTime / dt));
        if (status) {
          status.textContent = ui(
            `Running dt sweep: dt=${compactNumber(dt)}, steps=${steps}...`,
            `dt比較を実行中: dt=${compactNumber(dt)}、${steps}ステップ...`
          );
        }
        const testConfig: PhaseFieldConfig = { ...baseConfig, dt };
        const cpuConfig: PhaseFieldConfig = { ...testConfig, solverBackend: 'cpu' };
        const gpuConfig: PhaseFieldConfig = { ...testConfig, noiseReferenceDt: baseConfig.dt, solverBackend: 'webgpu-experimental' };
        const cpuSolver = testConfig.dimension === '2d' ? new PhaseField2D(cpuConfig) : new PhaseField3D(cpuConfig);
        const gpuSolver =
          testConfig.dimension === '2d' ? await PhaseField2DWebGpu.create(gpuConfig) : await PhaseField3DWebGpu.create(gpuConfig);
        try {
          const cpuStats = cpuSolver.step(steps);
          const gpuStats = await gpuSolver.step(steps);
          const cpuSnapshot = cpuSolver.snapshot();
          const gpuSnapshot = gpuSolver.snapshot();
          const phiDifference = compareFields(cpuSnapshot.phi, gpuSnapshot.phi);
          const temperatureDifference = compareFields(cpuSnapshot.temperature, gpuSnapshot.temperature);
          const unstable = cpuStats.unstable || gpuStats.unstable ? ui(', unstable', '、不安定') : '';
          rows.push(
            ui(
              `dt=${compactNumber(dt)} (${steps} steps): Δp ${phiDifference.max.toExponential(2)}/${phiDifference.rms.toExponential(2)}, ΔT ${temperatureDifference.max.toExponential(2)}/${temperatureDifference.rms.toExponential(2)}${unstable}`,
              `dt=${compactNumber(dt)}（${steps}ステップ）: Δp ${phiDifference.max.toExponential(2)}/${phiDifference.rms.toExponential(2)}、ΔT ${temperatureDifference.max.toExponential(2)}/${temperatureDifference.rms.toExponential(2)}${unstable}`
            )
          );
        } finally {
          gpuSolver.dispose();
        }
      }
      if (status) {
        status.textContent = ui(
          `Implicit-vs-explicit sweep at K=${baseConfig.latentHeat.toFixed(2)}, noise=0, target t=${targetTime.toExponential(2)}: ${rows.join(' | ')}`,
          `陰解法・陽解法dt比較 K=${baseConfig.latentHeat.toFixed(2)}、ノイズ=0、目標時刻 t=${targetTime.toExponential(2)}: ${rows.join(' | ')}`
        );
      }
    } catch (error: unknown) {
      if (status) {
        const message = error instanceof Error ? error.message : String(error);
        status.textContent = `${ui('dt sweep failed', 'dt比較失敗')}: ${message}`;
      }
    } finally {
      this.benchmarkRunning = false;
      buttons?.forEach((button) => {
        button.disabled = false;
      });
    }
  }

  private exportParameters(): void {
    const data = JSON.stringify(this.config, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    downloadBlob(blob, `phase-field-parameters-${Date.now()}.json`);
  }

  private exportState(): void {
    const snapshot = this.solver.snapshot();
    const blob = createStateExportBlob(snapshot, this.config);
    const step = snapshot.step.toString().padStart(6, '0');
    downloadBlob(blob, `phase-field-state-${this.config.id}-step-${step}-${Date.now()}.pfstate`);
  }

  private exportStl(mirrorXY: boolean): void {
    const snapshot = this.solver.snapshot();
    if (snapshot.dimension !== '3d') return;
    const blob = createIsosurfaceStlBlob(snapshot, this.config, { iso: 0.5, mirrorXY });
    const step = snapshot.step.toString().padStart(6, '0');
    const mirrorLabel = mirrorXY ? '-xy-mirror' : '';
    downloadBlob(blob, `phase-field-surface-${this.config.id}-step-${step}${mirrorLabel}-${Date.now()}.stl`);
  }

  private exportScreenshot(): void {
    if (!this.renderer) return;
    const dataUrl = this.renderer.screenshot();
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `phase-field-screenshot-${Date.now()}.png`;
    link.click();
  }
}

function shellTemplate(page: Page): string {
  const locale = getLocale();
  return `
    <main class="app-shell">
      <header class="topbar">
        <div class="brand">
          <img class="brand-mark" src="/icon-192.png" alt="" aria-hidden="true" />
          <div class="brand-title">${t('appTitle')}</div>
        </div>
        <nav class="nav-tabs" aria-label="${t('primaryNavigation')}">
          ${navButton('lab', t('lab'), page)}
          ${navButton('reproduction', t('reproductions'), page)}
          ${navButton('model', t('model'), page)}
          ${navButton('references', t('references'), page)}
        </nav>
        <div class="top-actions">
          <div class="language-switch" role="group" aria-label="${t('language')}">
            <button type="button" data-locale="en" aria-pressed="${locale === 'en'}">EN</button>
            <button type="button" data-locale="ja" aria-pressed="${locale === 'ja'}">日本語</button>
          </div>
          ${githubLinkTemplate()}
          <div class="top-status"><span class="status-dot"></span><span>${t('qualitativeSolver')}</span></div>
        </div>
      </header>
      <section class="view-root" data-view-root></section>
      <footer class="site-footer">
        <span>${t('copyright')}</span>
        ${footerLinksTemplate()}
      </footer>
    </main>
  `;
}

function githubLinkTemplate(): string {
  const icon = githubIconSvg();
  if (!APP_LINKS.github) {
    const pending = isJapanese() ? 'GitHubリポジトリURLは準備中です' : 'GitHub repository URL pending';
    return `<span class="top-icon-link is-disabled" aria-label="${pending}" title="${pending}">${icon}</span>`;
  }
  return `<a class="top-icon-link" href="${APP_LINKS.github}" target="_blank" rel="noreferrer" aria-label="${t('githubRepository')}">${icon}</a>`;
}

function githubIconSvg(): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.18-3.37-1.18-.45-1.15-1.1-1.46-1.1-1.46-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.02c.85 0 1.7.11 2.5.34 1.9-1.29 2.74-1.02 2.74-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86v2.76c0 .26.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>`;
}

function footerLinksTemplate(): string {
  const links = [
    APP_LINKS.liveSite ? `<a href="${APP_LINKS.liveSite}" target="_blank" rel="noreferrer">${t('liveSite')}</a>` : ''
  ].filter(Boolean);
  return links.length > 0 ? `<nav class="site-footer-links" aria-label="${t('projectLinks')}">${links.join('')}</nav>` : '';
}

function navButton(page: Page, label: string, active: Page): string {
  return `<button class="nav-tab" data-page="${page}" aria-selected="${page === active}">${label}</button>`;
}

function ui(english: string, japanese: string): string {
  return isJapanese() ? japanese : english;
}

function labTemplate(config: PhaseFieldConfig, running: boolean, solverStatus: string, benchmarkRunning: boolean): string {
  const baseGridOptions = config.dimension === '2d' ? [96, 128, 160, 192, 256, 300] : [36, 48, 64, 80, 100, 128];
  const gridOptions = [...new Set([...baseGridOptions, config.nx])].sort((a, b) => a - b);
  const hasReproducedFigure = Boolean(reproductionThumbnail(config.id));
  const latentHeatMax = Math.max(2.2, Math.ceil(config.latentHeat * 10) / 10);
  const dtRange = dtSliderRange(config);
  return `
    <div class="lab-layout">
      <section class="visual-stage ${hasReproducedFigure ? 'has-comparison' : ''}" aria-label="${ui('Simulation view', 'シミュレーション表示')}">
        <div class="viewport-stack ${hasReproducedFigure ? 'with-comparison' : ''}">
          <div class="viewport-panel" data-viewport>
            <div class="viewport-overlay"></div>
            <div class="active-backend" data-active-backend>${t('initializing')}</div>
          </div>
          ${comparisonPanel(config)}
        </div>
        <div class="telemetry">
          ${telemetryItem(ui('Step', 'ステップ'), 'step')}
          ${telemetryItem(ui('Time', '時刻'), 'time')}
          ${telemetryItem(ui('Compute', '計算速度'), 'rate')}
          ${telemetryItem(t('mesh'), 'grid')}
          ${telemetryItem('p min / max', 'phi')}
          ${telemetryItem('T min / max', 'temp')}
        </div>
      </section>
      <div class="mobile-run-dock" aria-label="${ui('Quick simulation controls', 'クイック計算操作')}">
        <button class="primary" data-action="run">${running ? t('pause') : t('run')}</button>
        <button data-action="step">${t('step')}</button>
        <button data-action="reset">${t('reset')}</button>
      </div>
      <aside class="inspector" aria-label="${ui('Simulation controls', 'シミュレーション操作')}">
        <div class="inspector-inner">
          <section class="control-section">
            <div class="section-title"><span>${ui('Experiment', '実験条件')}</span><span>${config.dimension.toUpperCase()}</span></div>
            <div class="section-body">
              <div class="control-row">
                <label class="control-label" for="preset">${ui('Preset', 'プリセット')}</label>
                <select id="preset" data-field="preset">
                  ${labPresets.map((preset) => `<option value="${preset.id}" ${preset.id === config.id ? 'selected' : ''}>${localizedPresetName(preset)}</option>`).join('')}
                </select>
              </div>
              ${presetNote(config)}
              <div class="segmented" aria-label="${ui('Dimension', '次元')}">
                <button data-dimension="2d" class="${config.dimension === '2d' ? 'active' : ''}">2D</button>
                <button data-dimension="3d" class="${config.dimension === '3d' ? 'active' : ''}">3D</button>
              </div>
              <div class="action-row">
                <button class="primary" data-action="run">${running ? t('pause') : t('run')}</button>
                <button data-action="reset">${t('reset')}</button>
              </div>
              <div class="action-row">
                <button data-action="step">${t('step')}</button>
                <button data-action="random-seed">${t('newSeed')}</button>
              </div>
              <div class="warning" data-warning>${ui('Numerical instability detected. Reduce dt, noise, anisotropy strength, or mesh size.', '数値的不安定性を検出しました。dt、ノイズ、異方性強度、またはメッシュ数を下げてください。')}</div>
            </div>
          </section>

          <section class="control-section">
            <div class="section-title"><span>${ui('Numerics', '数値計算')}</span><span>${solverBackendLabel(config)}</span></div>
            <div class="section-body">
              <div class="control-row">
                <label class="control-label" for="solverBackend">${ui('Solver backend', '計算バックエンド')}</label>
                <select id="solverBackend" data-field="solverBackend">
                  ${option('cpu', t('cpuImplicitT'), config.solverBackend ?? 'cpu')}
                  ${option('webgpu-experimental', t('webGpuExperimental'), config.solverBackend ?? 'cpu')}
                </select>
              </div>
              <div class="solver-status" data-solver-status>${escapeHtml(localizedSolverStatus(solverStatus))}</div>
              <div class="benchmark-status" data-solver-diagnostics>${formatSolverDiagnostics(null, config)}</div>
              ${numberControl(
                ui('Steps / frame', '1フレームのステップ数'),
                'stepsPerFrame',
                config.stepsPerFrame,
                1,
                config.solverBackend === 'webgpu-experimental'
                  ? config.dimension === '3d'
                    ? WEBGPU_3D_MAX_STEPS_PER_FRAME
                    : WEBGPU_MAX_STEPS_PER_FRAME
                  : 24
              )}
              ${gridSizeControl(config.dimension, gridOptions, config.nx, config.ny, config.nz)}
              <div class="control-row">
                <label class="control-label" for="boundaryCondition">${t('boundary')}</label>
                <select id="boundaryCondition" data-field="boundaryCondition">
                  ${option('neumann', ui('Adiabatic / no-flux', '断熱・流束なし'), config.boundaryCondition)}
                  ${option('fixed-temperature', ui('Fixed temperature edge', '外周温度固定'), config.boundaryCondition)}
                  ${option('left-fixed-temperature', ui('Left wall fixed T', '左壁温度固定'), config.boundaryCondition)}
                </select>
              </div>
              ${rangeControl('dt', 'dt', config.dt, dtRange.min, dtRange.max, dtRange.step, formatDt(config.dt))}
              ${numberControl(ui('Seed', '乱数シード'), 'seed', config.seed, 1, 999999)}
              <div class="action-row single">
                <button data-action="benchmark" ${benchmarkRunning ? 'disabled' : ''}>${benchmarkRunning ? ui('Benchmarking...', '計測中...') : ui('Benchmark CPU / WebGPU', 'CPU / WebGPU速度比較')}</button>
              </div>
              <div class="action-row single">
                <button data-action="dt-sweep" ${benchmarkRunning ? 'disabled' : ''}>${ui('dt sweep at current K', '現在のKでdt比較')}</button>
              </div>
              <div class="benchmark-status" data-benchmark-status>${webGpuStatusText(config)}</div>
            </div>
          </section>

          <section class="control-section">
            <div class="section-title"><span>${ui('Physics', '物理パラメータ')}</span><span>${localizedAnisotropyMode(config.anisotropyMode)}</span></div>
            <div class="section-body">
              ${rangeControl(t('anisotropy'), 'anisotropyStrength', config.anisotropyStrength, 0, 0.22, 0.001, config.anisotropyStrength.toFixed(3))}
              ${rangeControl(ui('Latent heat', '潜熱 K'), 'latentHeat', config.latentHeat, 0, latentHeatMax, 0.01, config.latentHeat.toFixed(2))}
              ${rangeControl(ui('Equilibrium T', '平衡温度 T'), 'undercooling', config.undercooling, 0.05, 1.2, 0.01, config.undercooling.toFixed(2))}
              ${rangeControl(t('noise'), 'noiseAmplitude', config.noiseAmplitude, 0, 0.06, 0.001, config.noiseAmplitude.toFixed(3))}
            </div>
          </section>

          <section class="control-section">
            <div class="section-title"><span>${ui('View', '表示')}</span><span>${renderModeLabel(config.renderMode3D)}</span></div>
            <div class="section-body">
              <div class="control-row">
                <label class="control-label" for="viewMode">${ui('Scalar view', 'スカラー場')}</label>
                <select id="viewMode" data-field="viewMode">
                  ${option('phase', ui('Phase', '相 p'), config.viewMode)}
                  ${option('temperature', ui('Temperature', '温度 T'), config.viewMode)}
                  ${option('combined', ui('Combined', '重ね合わせ'), config.viewMode)}
                </select>
              </div>
              <div class="control-row">
                <label class="control-label" for="renderMode3D">${ui('3D render mode', '3D表示方式')}</label>
                <select id="renderMode3D" data-field="renderMode3D" ${config.dimension === '2d' ? 'disabled' : ''}>
                  ${option('surface', t('isosurface'), config.renderMode3D)}
                  ${option('slices', t('slices'), config.renderMode3D)}
                  ${option('volume', t('volume'), config.renderMode3D)}
                </select>
              </div>
              <label class="toggle-row ${config.dimension === '2d' ? 'disabled' : ''}" for="surfaceFrameGuarantee3D">
                <span>
                  <span class="toggle-title">${ui('Surface guarantee', '等値面更新を保証')}</span>
                  <span class="toggle-hint">${ui('Wait for one 3D surface update before the next compute frame.', '次の計算フレームへ進む前に、3D等値面を1回更新します。')}</span>
                </span>
                <input id="surfaceFrameGuarantee3D" type="checkbox" data-field="surfaceFrameGuarantee3D" ${config.surfaceFrameGuarantee3D ? 'checked' : ''} ${config.dimension === '2d' ? 'disabled' : ''}>
              </label>
              <div class="action-row">
                <button data-action="stl" ${config.dimension === '2d' ? 'disabled' : ''}>${ui('STL surface', 'STL等値面')}</button>
                <button data-action="stl-mirror" ${config.dimension === '2d' ? 'disabled' : ''}>${ui('STL x-y mirror', 'STL x-y反転')}</button>
              </div>
              <div class="action-row">
                <button data-action="screenshot">${ui('Screenshot', 'スクリーンショット')}</button>
                <button data-action="save-state">${ui('State file', '場データ')}</button>
              </div>
              <div class="action-row single">
                <button data-action="export">${ui('Params JSON', 'パラメータJSON')}</button>
              </div>
            </div>
          </section>
        </div>
      </aside>
    </div>
  `;
}

function presetNote(config: PhaseFieldConfig): string {
  const paperDetails = localizedPaperDetails(config);
  const geometryDetails = [
    `${t('mesh')}: ${meshLabel(config)}`,
    `${t('domain')}: ${domainSizeLabel(config)}`,
    `dx = ${compactNumber(config.dx)}, dt = ${compactNumber(config.dt)}`,
    `${ui('Initial size', '初期サイズ')}: ${nucleusSizeLabel(config)}`
  ];
  return `
    <div class="preset-note">
      ${config.description ? `<p>${renderPresetDetail(localizedPresetDescription(config))}</p>` : ''}
      <div class="preset-paper-label">${ui('Simulation geometry', '計算形状')}</div>
      <ul>${geometryDetails.map((detail) => `<li>${renderPresetDetail(detail)}</li>`).join('')}</ul>
      ${
        config.paperReference
          ? `<div class="preset-paper-label">${presetReferenceLabel(config.paperReference.label)}</div>
             <ul>${paperDetails.map((detail) => `<li>${renderPresetDetail(detail)}</li>`).join('')}</ul>`
          : ''
      }
    </div>
  `;
}

function presetReferenceLabel(label: string): string {
  return escapeHtml(label.replace(/^Kobayashi\s+1993/i, 'K1993'));
}

function renderPresetDetail(detail: string): string {
  const formulas: string[] = [];
  let text = detail;
  const stash = (html: string): string => {
    const token = `@@MATH_${formulas.length}@@`;
    formulas.push(html);
    return token;
  };

  text = text.replace(/\bdx\s*=\s*dy\s*=\s*dz\s*=\s*(-?\d+(?:\.\d+)?)/gi, (_match, value: string) =>
    stash(
      mathInline(
        `<mrow><mi mathvariant="normal">Δx</mi><mo>=</mo><mi mathvariant="normal">Δy</mi><mo>=</mo><mi mathvariant="normal">Δz</mi><mo>=</mo>${mathValueMarkup(value)}</mrow>`,
        'uniform grid spacing'
      )
    )
  );

  text = text.replace(/\b(?:phi|p)\s*\(\s*1\s*-\s*(?:phi|p)\s*\)\s*X\b/gi, () =>
    stash(
      mathInline(
        '<mrow><mi>p</mi><mo stretchy="false">(</mo><mn>1</mn><mo>-</mo><mi>p</mi><mo stretchy="false">)</mo><mi>X</mi></mrow>',
        'p times one minus p times X'
      )
    )
  );

  text = text.replace(
    /\b(epsilon_bar|theta0|delta|tau|alpha|gamma|dx|dy|dz|dt|K|a|r|j|t|phi|p)\s*(~=|>=|<=|=)\s*(-?\d+(?:\.\d+)?|pi\/2|pi)\b/gi,
    (_match, variable: string, operator: string, value: string) =>
      stash(
        mathInline(
          `<mrow>${mathVariableMarkup(variable)}${mathOperatorMarkup(operator)}${mathValueMarkup(value)}</mrow>`,
          `${variable} ${operator} ${value}`
        )
      )
  );

  text = text.replace(/\bphi\b/gi, () => stash(mathInline('<mi>p</mi>', 'p')));

  return escapeHtml(text).replace(/@@MATH_(\d+)@@/g, (_match, index: string) => formulas[Number(index)] ?? '');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mathVariableMarkup(variable: string): string {
  const normalized = variable.toLowerCase();
  if (normalized === 'epsilon_bar') return '<mover><mi>ε</mi><mo>¯</mo></mover>';
  if (normalized === 'theta0') return '<msub><mi>θ</mi><mn>0</mn></msub>';
  if (normalized === 'delta') return '<mi>δ</mi>';
  if (normalized === 'tau') return '<mi>τ</mi>';
  if (normalized === 'alpha') return '<mi>α</mi>';
  if (normalized === 'gamma') return '<mi>γ</mi>';
  if (normalized === 'phi') return '<mi>p</mi>';
  if (normalized === 'p') return '<mi>p</mi>';
  if (normalized === 'dx') return '<mi mathvariant="normal">Δx</mi>';
  if (normalized === 'dy') return '<mi mathvariant="normal">Δy</mi>';
  if (normalized === 'dz') return '<mi mathvariant="normal">Δz</mi>';
  if (normalized === 'dt') return '<mi mathvariant="normal">Δt</mi>';
  return `<mi>${escapeHtml(variable)}</mi>`;
}

function mathOperatorMarkup(operator: string): string {
  if (operator === '~=') return '<mo>≈</mo>';
  if (operator === '>=') return '<mo>≥</mo>';
  if (operator === '<=') return '<mo>≤</mo>';
  return '<mo>=</mo>';
}

function mathValueMarkup(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === 'pi') return '<mi>π</mi>';
  if (normalized === 'pi/2') return '<mfrac><mi>π</mi><mn>2</mn></mfrac>';
  return `<mn>${escapeHtml(value)}</mn>`;
}

function comparisonPanel(config: PhaseFieldConfig): string {
  const thumbnail = reproductionThumbnail(config.id);
  if (!thumbnail) return '';
  return `
    <aside class="comparison-panel">
      <div class="comparison-header">
        <span>${ui('Reproduced figure', '再現図')}</span>
        <span>${ui('CPU implicit-T final state', 'CPU・T陰解法の最終状態')}</span>
      </div>
      <div class="comparison-image-box">
        <img src="${thumbnail.src}" alt="${config.paperReference?.label ?? localizedPresetName(config)} ${ui('reproduced final state', '再現した最終状態')}" />
      </div>
      <p class="comparison-caption">${ui('Generated with the CPU implicit-temperature solver from the selected preset parameters.', '選択したプリセットをCPU・T陰解法ソルバーで計算した結果です。')}</p>
    </aside>
  `;
}

function telemetryItem(label: string, key: string): string {
  return `<div class="telemetry-item"><div class="telemetry-label">${label}</div><div class="telemetry-value" data-telemetry="${key}">--</div></div>`;
}

function numberControl(label: string, field: string, value: number, min: number, max: number): string {
  return `
    <div class="control-row">
      <label class="control-label" for="${field}">${label}</label>
      <input id="${field}" data-field="${field}" type="number" min="${min}" max="${max}" value="${value}" />
    </div>
  `;
}

function gridSizeControl(dimension: Dimension, options: number[], nx: number, ny: number, nz: number): string {
  const currentValue = dimension === '3d' ? `${nx}x${ny}x${nz}` : `${nx}x${ny}`;
  const squareOptions = options.map((item) => (dimension === '3d' ? `${item}x${item}x${item}` : `${item}x${item}`));
  const allOptions = [...new Set([...squareOptions, currentValue])];
  return `
    <div class="control-row">
      <label class="control-label" for="gridSize">${ui('Mesh size', 'メッシュ数')}</label>
      <select id="gridSize" data-field="gridSize">
        ${allOptions
          .map((item) => {
            const parts = item.split('x').map(Number);
            const label =
              dimension === '3d'
                ? parts[0] === parts[1] && parts[1] === parts[2]
                  ? `${parts[0]}^3`
                  : `${parts[0]} x ${parts[1]} x ${parts[2]}`
                : `${parts[0]} x ${parts[1]}`;
            return `<option value="${item}" ${item === currentValue ? 'selected' : ''}>${label}</option>`;
          })
          .join('')}
      </select>
    </div>
  `;
}

function rangeControl(label: string, field: string, value: number, min: number, max: number, step: number, display: string): string {
  return `
    <div class="control-row">
      <label class="control-label" for="${field}"><span>${label}</span><span class="control-value" data-value="${field}">${display}</span></label>
      <input id="${field}" data-field="${field}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" />
    </div>
  `;
}

function formatDt(value: number): string {
  return value < 0.001 ? compactNumber(value) : value.toFixed(3);
}

function solverBackendLabel(config: PhaseFieldConfig): string {
  const backend = (config.solverBackend ?? 'cpu') === 'webgpu-experimental' ? ui('WebGPU trial', 'WebGPU実験版') : 'CPU';
  return config.dimension === '3d' ? `${backend} 3D` : backend;
}

function localizedAnisotropyMode(mode: PhaseFieldConfig['anisotropyMode']): string {
  if (!isJapanese()) return mode;
  if (mode === 'isotropic') return '等方';
  if (mode === 'fourFold') return '4回対称';
  if (mode === 'sixFold') return '6回対称';
  return '立方対称';
}

function localizedSolverStatus(status: string): string {
  const pairs: Array<[string, string]> = [
    ['Initializing WebGPU...', 'WebGPUを初期化中...'],
    ['Initializing', '初期化中'],
    ['CPU: explicit p / implicit T', 'CPU: p陽解法 / T陰解法'],
    ['CPU worker: 3D explicit p / implicit T', 'CPUワーカー: 3D p陽解法 / T陰解法'],
    ['WebGPU experimental 2D: explicit p / explicit T', 'WebGPU実験版2D: p陽解法 / T陽解法']
  ];
  for (const [english, japanese] of pairs) {
    if (isJapanese() && status === english) return japanese;
    if (!isJapanese() && status === japanese) return english;
  }
  const runtime3d = status.match(/^(?:WebGPU experimental 3D: explicit p \/ explicit T · |WebGPU実験版3D: p陽解法 \/ T陽解法 · )(.+?)(?: batch|バッチ)$/);
  if (runtime3d) {
    return ui(
      `WebGPU experimental 3D: explicit p / explicit T · ${runtime3d[1]} batch`,
      `WebGPU実験版3D: p陽解法 / T陽解法 · ${runtime3d[1]}バッチ`
    );
  }
  return status;
}

function localizedActiveBackendLabel(label: string): string {
  if (label === 'CPU · Worker' || label === 'CPU · ワーカー') {
    return ui('CPU · Worker', 'CPU · ワーカー');
  }
  return label;
}

function solverStoppedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${ui('Solver stopped', 'ソルバー停止')}: ${message}`;
}

function formatSolverDiagnostics(stats: StepStats | null, config: PhaseFieldConfig): string {
  if (!stats) {
    return config.solverBackend === 'webgpu-experimental'
      ? ui('GPU diagnostics update after each compute batch.', 'GPU診断値は計算バッチごとに更新されます。')
      : ui('ICCG convergence and pre-clamp diagnostics update after stepping.', 'ICCG収束値とクランプ前診断はステップ後に更新されます。');
  }

  const parts: string[] = [];
  if (stats.temperatureSolverIterations !== undefined) {
    const residual =
      stats.temperatureSolverResidual !== undefined && Number.isFinite(stats.temperatureSolverResidual)
        ? stats.temperatureSolverResidual.toExponential(2)
        : 'n/a';
    parts.push(
      ui(
        `T solver ${stats.temperatureSolverIterations} iterations, residual ${residual}`,
        `Tソルバー ${stats.temperatureSolverIterations}反復、残差 ${residual}`
      )
    );
  }
  const clippedPhi = stats.clampedPhiCells ?? 0;
  const clippedTemperature = stats.clampedTemperatureCells ?? 0;
  parts.push(
    ui(
      `pre-clamp hits p=${clippedPhi.toLocaleString(localeTag())}, T=${clippedTemperature.toLocaleString(localeTag())}`,
      `クランプ前の範囲外セル p=${clippedPhi.toLocaleString(localeTag())}, T=${clippedTemperature.toLocaleString(localeTag())}`
    )
  );
  return parts.join('; ');
}

function instabilityWarning(stats: StepStats): string {
  if (stats.temperatureSolverConverged === false) {
    return ui(
      `Temperature solve did not converge (residual ${stats.temperatureSolverResidual?.toExponential(2) ?? 'unknown'}).`,
      `温度計算が収束しませんでした（残差 ${stats.temperatureSolverResidual?.toExponential(2) ?? '不明'}）。`
    );
  }
  if ((stats.clampedPhiCells ?? 0) > 0 || (stats.clampedTemperatureCells ?? 0) > 0) {
    return ui(
      `Numerical instability detected before clamping: p=${stats.rawMinPhi?.toExponential(2) ?? '?'}..${stats.rawMaxPhi?.toExponential(2) ?? '?'}, T=${stats.rawMinTemperature?.toExponential(2) ?? '?'}..${stats.rawMaxTemperature?.toExponential(2) ?? '?'}.`,
      `クランプ前に数値的不安定性を検出しました: p=${stats.rawMinPhi?.toExponential(2) ?? '?'}..${stats.rawMaxPhi?.toExponential(2) ?? '?'}, T=${stats.rawMinTemperature?.toExponential(2) ?? '?'}..${stats.rawMaxTemperature?.toExponential(2) ?? '?'}。`
    );
  }
  return ui(
    'Numerical instability detected. Reduce dt, noise, anisotropy strength, or mesh size.',
    '数値的不安定性を検出しました。dt、ノイズ、異方性強度、またはメッシュ数を下げてください。'
  );
}

function webGpuStatusText(config: PhaseFieldConfig): string {
  const availability = webGpuAvailability();
  if (availability.available) return `${ui('WebGPU available.', 'WebGPUを利用できます。')} ${explicitTStabilityText(config)}`;
  return `${ui('WebGPU unavailable here:', 'この環境ではWebGPUを利用できません:')} ${availability.reason}`;
}

function explicitTStabilityText(config: PhaseFieldConfig): string {
  const currentLimit = explicitTStabilityLimit(config, config.dimension === '3d' ? 3 : 2);
  const k2002Limit = explicitTStabilityLimit({ ...config, latentHeat: 3.5, dx: 0.03, temperatureDiffusivity: 1, tau: 0.0003 }, 3);
  return ui(
    `Explicit T estimate: current dtmax≈${compactNumber(currentLimit)}, K=3.5 3D dtmax≈${compactNumber(k2002Limit)}; 3D WebGPU uses dt≈0.00005 and large steps/frame for throughput.`,
    `T陽解法の推定安定限界: 現在 dtmax≈${compactNumber(currentLimit)}、K=3.5の3Dでは dtmax≈${compactNumber(k2002Limit)}。3D WebGPUは dt≈0.00005 と大きなsteps/frameを使います。`
  );
}

function explicitTStabilityLimit(config: PhaseFieldConfig, dimensions: 2 | 3): number {
  const diffusionMagnitude = (4 * dimensions * config.temperatureDiffusivity) / (config.dx * config.dx);
  const maxDriveDerivative = (config.driveAlpha * config.driveGamma) / Math.PI;
  const latentFeedbackMagnitude = (config.latentHeat / config.tau) * 0.25 * maxDriveDerivative;
  return 2 / (diffusionMagnitude + latentFeedbackMagnitude);
}

function benchmarkStepCount(config: PhaseFieldConfig): number {
  const cells = config.nx * config.ny * (config.dimension === '3d' ? config.nz : 1);
  if (config.dimension === '3d') {
    if (cells >= 1_000_000) return 1;
    if (cells >= 400_000) return 2;
    if (cells >= 100_000) return 4;
    return 8;
  }
  if (cells >= 90_000) return 32;
  if (cells >= 40_000) return 64;
  return 96;
}

function formatBenchmark(milliseconds: number, steps: number): string {
  return `${milliseconds.toFixed(1)} ms total, ${(milliseconds / steps).toFixed(2)} ms/step`;
}

function compareFields(a: Float32Array, b: Float32Array): { max: number; rms: number } {
  const length = Math.min(a.length, b.length);
  if (length === 0) return { max: 0, rms: 0 };
  let max = 0;
  let sumSquares = 0;
  for (let i = 0; i < length; i += 1) {
    const delta = Math.abs(a[i] - b[i]);
    if (delta > max) max = delta;
    sumSquares += delta * delta;
  }
  return { max, rms: Math.sqrt(sumSquares / length) };
}

function option<T extends string>(value: T, label: string, current: T): string {
  return `<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`;
}

function renderModeLabel(mode: RenderMode3D): string {
  if (mode === 'surface') return t('isosurface');
  if (mode === 'slices') return t('slices');
  return t('volume');
}

type ReproductionGroup = {
  title: string;
  description: string;
  presetIds: string[];
};

type ReproductionThumbnail = {
  src: string;
  label: string;
};

type K2002Asset = {
  presetId: string;
  title: string;
  subtitle: string;
  poster: string;
  video: string;
  state: string;
  stl: string;
  notes: string[];
};

const kobayashi1993ReproductionGroups: ReproductionGroup[] = [
  {
    title: 'Fig.3-4: planar validation',
    description: 'Cooled-wall and left-wall planar-front checks before the dendrite cases.',
    presetIds: ['paper-fig3-inward-walls', 'paper-fig4-planar-k100']
  },
  {
    title: 'Fig.5: isotropic directional solidification',
    description: 'Rectangular channel, adiabatic supercooled melt, K sweep from stable planar growth to branch competition.',
    presetIds: [
      'paper-fig5-k080-planar',
      'paper-fig5-k090-slight',
      'paper-fig5-k100-cellular',
      'paper-fig5-k110-cellular-slits',
      'paper-fig5-k120-splitting',
      'paper-fig5-k140-splitting',
      'paper-fig5-k160-competition',
      'paper-fig5-k180-spreading',
      'paper-fig5-k200-slow'
    ]
  },
  {
    title: 'Fig.6: four-fold anisotropic directional solidification',
    description: 'Same channel as Fig.5, with delta = 0.050 four-fold anisotropy.',
    presetIds: [
      'paper-fig6-k080-anisotropic',
      'paper-fig6-k090-anisotropic',
      'paper-fig6-k100-anisotropic',
      'paper-fig6-k110-anisotropic',
      'paper-fig6-k120-anisotropic',
      'paper-fig6-k140-anisotropic',
      'paper-fig6-k160-anisotropic',
      'paper-fig6-k180-anisotropic',
      'paper-fig6-k200-anisotropic'
    ]
  },
  {
    title: 'Fig.7: four-fold anisotropy strength',
    description: 'Bottom-edge nucleus, K = 2.0, default interface noise, delta sweep.',
    presetIds: ['paper-fig7-delta000', 'paper-fig7-delta005', 'paper-fig7-delta010', 'paper-fig7-delta020', 'paper-fig7-delta050']
  },
  {
    title: 'Fig.8: six-fold anisotropy',
    description: 'Center nucleus, six-fold anisotropy, K sweep from convex hexagon to snowflake-like branching.',
    presetIds: [
      'paper-fig8-k080-sixfold',
      'paper-fig8-k100-sixfold',
      'paper-fig8-k120-sixfold',
      'paper-fig8-k160-sixfold',
      'paper-fig8-k200-sixfold'
    ]
  },
  {
    title: 'Fig.9-10: side-branch noise comparison',
    description: 'Bottom-edge four-fold dendrites used to compare noise sensitivity and oscillatory side branches.',
    presetIds: [
      'paper-fig9-noise010',
      'paper-fig9-noise001',
      'paper-fig9-no-noise',
      'paper-fig10-noise010',
      'paper-fig10-noise001',
      'paper-fig10-no-noise'
    ]
  }
];

const reproductionThumbnails: Record<string, ReproductionThumbnail> = {
      'paper-fig3-inward-walls': { src: '/reproductions/fig3_k100_step_48000.png', label: 'CPU implicit-T final state' },
      'paper-fig4-planar-k100': {
        src: '/reproductions/fig4_k100_step_10000.png',
        label: 'CPU implicit-T final state'
      }
      ,
      'paper-fig5-k080-planar': { src: '/reproductions/fig5_k080_step_03500.png', label: 'CPU implicit-T final state' },
      'paper-fig5-k090-slight': { src: '/reproductions/fig5_k090_step_03500.png', label: 'CPU implicit-T final state' },
      'paper-fig5-k100-cellular': { src: '/reproductions/fig5_k100_step_03500.png', label: 'CPU implicit-T final state' },
      'paper-fig5-k110-cellular-slits': { src: '/reproductions/fig5_k110_step_03500.png', label: 'CPU implicit-T final state' },
      'paper-fig5-k120-splitting': { src: '/reproductions/fig5_k120_step_03500.png', label: 'CPU implicit-T final state' },
      'paper-fig5-k140-splitting': { src: '/reproductions/fig5_k140_step_03500.png', label: 'CPU implicit-T final state' },
      'paper-fig5-k160-competition': { src: '/reproductions/fig5_k160_step_05000.png', label: 'CPU implicit-T final state' },
      'paper-fig5-k180-spreading': { src: '/reproductions/fig5_k180_step_10000.png', label: 'CPU implicit-T final state' },
      'paper-fig5-k200-slow': { src: '/reproductions/fig5_k200_step_14000.png', label: 'CPU implicit-T final state' },
      'paper-fig6-k080-anisotropic': { src: '/reproductions/fig6_k080_step_03500.png', label: 'CPU implicit-T final state' },
      'paper-fig6-k090-anisotropic': { src: '/reproductions/fig6_k090_step_03500.png', label: 'CPU implicit-T final state' },
      'paper-fig6-k100-anisotropic': { src: '/reproductions/fig6_k100_step_03500.png', label: 'CPU implicit-T final state' },
      'paper-fig6-k110-anisotropic': { src: '/reproductions/fig6_k110_step_03500.png', label: 'CPU implicit-T final state' },
      'paper-fig6-k120-anisotropic': { src: '/reproductions/fig6_k120_step_03500.png', label: 'CPU implicit-T final state' },
      'paper-fig6-k140-anisotropic': { src: '/reproductions/fig6_k140_step_03500.png', label: 'CPU implicit-T final state' },
      'paper-fig6-k160-anisotropic': { src: '/reproductions/fig6_k160_step_05000.png', label: 'CPU implicit-T final state' },
      'paper-fig6-k180-anisotropic': { src: '/reproductions/fig6_k180_step_05000.png', label: 'CPU implicit-T final state' },
      'paper-fig6-k200-anisotropic': { src: '/reproductions/fig6_k200_step_05000.png', label: 'CPU implicit-T final state' },
      'paper-fig7-delta000': { src: '/reproductions/fig7_delta000_step_07000.png', label: 'CPU implicit-T final state' },
      'paper-fig7-delta005': { src: '/reproductions/fig7_delta005_step_07000.png', label: 'CPU implicit-T final state' },
      'paper-fig7-delta010': { src: '/reproductions/fig7_delta010_step_07000.png', label: 'CPU implicit-T final state' },
      'paper-fig7-delta020': { src: '/reproductions/fig7_delta020_step_07000.png', label: 'CPU implicit-T final state' },
      'paper-fig7-delta050': { src: '/reproductions/fig7_delta050_step_07000.png', label: 'CPU implicit-T final state' },
      'paper-fig8-k080-sixfold': { src: '/reproductions/fig8_k080_step_01000.png', label: 'CPU implicit-T final state' },
      'paper-fig8-k100-sixfold': { src: '/reproductions/fig8_k100_step_01250.png', label: 'CPU implicit-T final state' },
      'paper-fig8-k120-sixfold': { src: '/reproductions/fig8_k120_step_01400.png', label: 'CPU implicit-T final state' },
      'paper-fig8-k160-sixfold': { src: '/reproductions/fig8_k160_step_01800.png', label: 'CPU implicit-T final state' },
      'paper-fig8-k200-sixfold': { src: '/reproductions/fig8_k200_step_02400.png', label: 'CPU implicit-T final state' },
      'paper-fig9-noise010': { src: '/reproductions/fig9_noise010_step_05000.png', label: 'CPU implicit-T final state' },
      'paper-fig9-noise001': { src: '/reproductions/fig9_noise001_step_05000.png', label: 'CPU implicit-T final state' },
      'paper-fig9-no-noise': { src: '/reproductions/fig9_noise000_step_05000.png', label: 'CPU implicit-T final state' },
      'paper-fig10-noise010': { src: '/reproductions/fig10_noise010_step_06500.png', label: 'CPU implicit-T final state' },
      'paper-fig10-noise001': { src: '/reproductions/fig10_noise001_step_06500.png', label: 'CPU implicit-T final state' },
      'paper-fig10-no-noise': { src: '/reproductions/fig10_noise000_step_06500.png', label: 'CPU implicit-T final state' },
      'paper-fig9-3d-left-target': {
        src: '/reproductions/k2002_fig9_left_ts_webgl_gold_160x160x100_k2p5_t04_poster.png',
        label: 'CPU implicit-T / WebGL poster'
      },
      'paper-fig9-3d-right-target': {
        src: '/reproductions/k2002_fig9_right_ts_webgl_gold_50x50x200_k3p5_t09_poster.png',
        label: 'CPU implicit-T / WebGL poster'
      }
};

const k2002ReproductionAssets: K2002Asset[] = [
  {
    presetId: 'paper-fig9-3d-left-target',
    title: 'Fig.9 left: isotropic 3D seed',
    subtitle: 'Full-domain 3D run, bottom-face-centered nucleus, reproduced as a public WebGL animation.',
    poster: '/reproductions/k2002_fig9_left_ts_webgl_gold_160x160x100_k2p5_t04_poster.png',
    video: '/reproductions/k2002_fig9_left_ts_webgl_gold_160x160x100_k2p5_t04.mp4',
    state: '/reproductions/k2002_fig9_left_final_160x160x100_k2p5_t04.pfstate',
    stl: '/reproductions/k2002_fig9_left_final_160x160x100_k2p5_t04_iso05.stl',
    notes: [
      'estimated parameters selected by visual comparison',
      '160 x 160 x 100 mesh',
      'domain 4.8 x 4.8 x 3.0',
      'K=2.5, delta=0, a=0.01, r=7',
      't=0.4, 200 frames at 30 fps'
    ]
  },
  {
    presetId: 'paper-fig9-3d-right-target',
    title: 'Fig.9 right: four-fold 3D estimate',
    subtitle: 'Quarter-domain calculation mirrored in x-y for display; z is rendered left-to-right.',
    poster: '/reproductions/k2002_fig9_right_ts_webgl_gold_50x50x200_k3p5_t09_poster.png',
    video: '/reproductions/k2002_fig9_right_ts_webgl_gold_50x50x200_k3p5_t09.mp4',
    state: '/reproductions/k2002_fig9_right_final_50x50x200_k3p5_t09.pfstate',
    stl: '/reproductions/k2002_fig9_right_final_100x100x200_k3p5_t09_mirrored_iso05.stl',
    notes: [
      'estimated parameters selected by visual comparison',
      '50 x 50 x 200 quarter mesh',
      'display domain 100 x 100 x 200',
      'K=3.5, delta=0.020, a=0.005, r=7',
      't=0.9, 450 frames at 30 fps'
    ]
  }
];

function reproductionTemplate(): string {
  return `
    <article class="content-page reproduction-page">
      <div class="content-inner reproduction-inner">
        <h1>${t('reproductions')}</h1>
        <p>${ui(
          'This page collects simulator-generated outputs for the Kobayashi references. It does not distribute paper figures. K1993 entries show simulator-generated final-state thumbnails, and K2002 entries use public CPU/WebGL animations, final-state viewers, and STL isosurfaces generated from the listed presets.',
          'このページには、小林の文献を対象に本シミュレータで生成した結果をまとめています。論文の図そのものは掲載していません。K1993ではシミュレータ生成の最終状態画像を、K2002では公開用CPU/WebGLアニメーション、最終状態ビューア、プリセットから生成したSTL等値面を示します。'
        )}</p>
        <p class="reproduction-note">${ui(
          'All media on this page is simulator-generated. CPU implicit-temperature output is the reproduction sample path; WebGPU thumbnails show the experimental explicit-temperature backend. The comparison is qualitative; exact reproduction is not claimed. In the current Fig.9 low-noise cases, WebGPU suppresses side branching relative to the CPU reference.',
          'このページのメディアはすべて本シミュレータで生成しています。再現用サンプルにはCPU・温度陰解法を用い、WebGPU画像は実験的な温度陽解法の結果です。比較は定性的で、厳密な一致を主張するものではありません。現在のFig.9低ノイズ条件では、WebGPU結果のサイドブランチがCPU基準より少なくなります。'
        )}</p>
        <nav class="reproduction-section-nav" aria-label="${ui('Reproduction sections', '再現図の区分')}">
          <a href="#k1993-reproductions">K1993</a>
          <a href="#k2002-reproductions">K2002</a>
        </nav>
        <section class="reproduction-family" id="k2002-reproductions">
          <div class="reproduction-family-header">
            <h2>${ui('K2002 3D Reproduction', 'K2002 3D再現')}</h2>
        <p>${ui(
          "Public animation and final-state assets generated by this simulator's CPU implicit-temperature solver and three.js/WebGL renderer. The exact 3D numerical conditions were not available, so these parameters are estimates selected by qualitative comparison with the K2002 figure. Select the Lab action to load the same preset parameters for an interactive rerun.",
          '本シミュレータのCPU・温度陰解法ソルバーとthree.js/WebGLレンダラーで生成した公開アニメーションおよび最終状態です。3Dの厳密な数値条件が得られなかったため、K2002の図との定性的比較から推定したパラメータを使用しています。「ラボで開く」を選ぶと、同じプリセットで再計算できます。'
        )}</p>
          </div>
          <div class="k2002-media-grid">
            ${k2002ReproductionAssets.map(k2002AssetCardTemplate).join('')}
          </div>
          <div class="k2002-state-viewer" data-k2002-state-viewer hidden>
            <div class="k2002-state-header">
              <div>
                <div class="reproduction-figure">${ui('Interactive final state', '操作可能な最終状態')}</div>
                <h3 data-k2002-state-title>${t('finalStateViewer')}</h3>
              </div>
              <p data-k2002-state-status>${ui('Select View final state on a K2002 card.', 'K2002カードの「最終状態を表示」を選んでください。')}</p>
            </div>
            <div class="k2002-state-toolbar" aria-label="${ui('Final state render mode', '最終状態の表示方法')}">
              <button type="button" data-k2002-render-mode="surface" aria-selected="true">${t('isosurface')}</button>
              <button type="button" data-k2002-render-mode="slices" aria-selected="false">${t('slices')}</button>
              <button type="button" data-k2002-render-mode="volume" aria-selected="false">${t('volume')}</button>
            </div>
            <div class="k2002-state-host" data-k2002-state-host></div>
          </div>
        </section>
        <section class="reproduction-family" id="k1993-reproductions">
          <div class="reproduction-family-header">
            <h2>${ui('K1993 2D Reproduction', 'K1993 2D再現')}</h2>
            <p>${ui(
              'Paper-target planar, cellular, dendrite, anisotropy, and noise-sensitivity presets. Select a card to open the same parameter set in Lab.',
              '論文を対象とした平面成長、セル状成長、デンドライト、異方性、ノイズ感度のプリセットです。カードを選ぶと同じパラメータをラボで開きます。'
            )}</p>
          </div>
        <div class="reproduction-groups">
          ${kobayashi1993ReproductionGroups.map(reproductionGroupTemplate).join('')}
        </div>
        </section>
      </div>
    </article>
  `;
}

function k2002AssetCardTemplate(asset: K2002Asset): string {
  const config = presets.find((preset) => preset.id === asset.presetId);
  const rows = config ? threeDPresetRows(config) : [];
  return `
    <article class="k2002-asset-card">
      <div class="k2002-media-frame">
        <video controls muted playsinline preload="metadata" poster="${asset.poster}">
          <source src="${asset.video}" type="video/mp4" />
        </video>
      </div>
      <div class="k2002-asset-copy">
        <div class="reproduction-figure">K2002 Fig.9</div>
        <h3>${k2002AssetTitle(asset)}</h3>
        <p>${k2002AssetSubtitle(asset)}</p>
        <dl class="reproduction-params">
          ${rows
            .filter((_, index) => [0, 1, 2, 4, 5, 6, 7].includes(index))
            .map((row) => `<div><dt>${row.label}</dt><dd>${row.value}</dd></div>`)
            .join('')}
        </dl>
        <ul class="k2002-asset-notes">
          ${k2002AssetNotes(asset).map((note) => `<li>${note}</li>`).join('')}
        </ul>
        <div class="k2002-asset-actions">
          <button type="button" data-reproduction-state="${asset.state}" data-reproduction-state-preset="${asset.presetId}">${ui('View final state', '最終状態を表示')}</button>
          <button type="button" data-reproduction-preset="${asset.presetId}">${ui('Open in Lab', 'ラボで開く')}</button>
          <a href="${asset.video}" download>MP4</a>
          <a href="${asset.stl}" download>STL</a>
        </div>
      </div>
    </article>
  `;
}

function reproductionGroupTemplate(group: ReproductionGroup): string {
  const cards = group.presetIds
    .map((presetId) => presets.find((preset) => preset.id === presetId))
    .filter((preset): preset is PhaseFieldConfig => Boolean(preset))
    .map(reproductionCardTemplate)
    .join('');

  return `
    <section class="reproduction-group">
      <div class="reproduction-group-header">
        <h2>${localizedReproductionGroup(group).title}</h2>
        <p>${localizedReproductionGroup(group).description}</p>
      </div>
      <div class="reproduction-card-grid">
        ${cards}
      </div>
    </section>
  `;
}

function reproductionCardTemplate(config: PhaseFieldConfig): string {
  const thumbnail = reproductionThumbnail(config.id);
  const gpuThumbnail = webGpuReproductionThumbnail(thumbnail);
  const figureLabel = shortFigureLabel(config.paperReference?.label ?? config.name);
  const displayTitle = reproductionDisplayTitle(config);
  return `
    <button type="button" class="reproduction-card" data-reproduction-preset="${config.id}" aria-label="${ui(`Open ${config.name} in Lab`, `${localizedPresetName(config)}をラボで開く`)}">
      <div class="reproduction-card-copy">
        <div class="reproduction-figure">${figureLabel}</div>
        <div class="reproduction-title">${displayTitle}</div>
        <dl class="reproduction-params">
          ${reproductionParameterRows(config)
            .map((row) => `<div><dt>${row.label}</dt><dd>${row.value}</dd></div>`)
            .join('')}
        </dl>
      </div>
      <div class="reproduction-thumb">
        ${
          gpuThumbnail
            ? `<div class="reproduction-thumb-pair">
                ${reproductionThumbItem(thumbnail, figureLabel, ui('CPU implicit-T', 'CPU・T陰解法'))}
                ${reproductionThumbItem(gpuThumbnail, figureLabel, ui('WebGPU explicit-T', 'WebGPU・T陽解法'))}
              </div>`
            : `${reproductionThumbFrame(thumbnail, figureLabel)}<div class="reproduction-thumb-label">${localizedThumbnailLabel(thumbnail?.label)}</div>`
        }
      </div>
    </button>
  `;
}

function reproductionThumbItem(thumbnail: ReproductionThumbnail | undefined, figureLabel: string, label: string): string {
  return `
    <div class="reproduction-thumb-item">
      ${reproductionThumbFrame(thumbnail, figureLabel)}
      <div class="reproduction-thumb-label">${label}</div>
    </div>
  `;
}

function reproductionThumbFrame(thumbnail: ReproductionThumbnail | undefined, figureLabel: string): string {
  return `
    <div class="reproduction-thumb-frame">
      ${
        thumbnail
          ? `<img src="${thumbnail.src}" alt="${figureLabel} ${thumbnail.label}" />`
          : `<div class="reproduction-thumb-placeholder">${ui('Preview<br />pending', 'プレビュー<br />未作成')}</div>`
      }
    </div>
  `;
}

function shortFigureLabel(label: string): string {
  const match = label.match(/Fig\.\d+(?:\(\d+\))?/);
  return match?.[0] ?? label.replace(/^K(?:obayashi)?\s*1993\s*/i, '').trim();
}

function reproductionDisplayTitle(config: PhaseFieldConfig): string {
  return localizedPresetName(config)
    .replace(/^K1993\s+Fig\.\d+(?:\(\d+\))?\s*/i, '')
    .replace(/^Kobayashi\s+1993\s+Fig\.\d+(?:\(\d+\))?\s*/i, '')
    .trim();
}

function reproductionParameterRows(config: PhaseFieldConfig): Array<{ label: string; value: string }> {
  const rows = [
    { label: ui('mesh', 'メッシュ'), value: meshLabel(config) },
    { label: ui('domain', '計算領域'), value: domainSizeLabel(config) },
    { label: 'dx / dt', value: `${compactNumber(config.dx)} / ${compactNumber(config.dt)}` },
    { label: 'K', value: compactNumber(config.latentHeat) },
    { label: ui('anisotropy', '異方性'), value: anisotropyLabel(config) },
    { label: ui('noise', 'ノイズ'), value: `a=${compactNumber(config.noiseAmplitude)}, seed=${config.seed}` },
    { label: ui('boundary', '境界・初期核'), value: `${boundaryLabel(config.boundaryCondition)}, ${placementLabel(config)} ${nucleusSizeLabel(config)}` }
  ];

  if (config.nucleusPlacement === 'left-wall' && config.frontPerturbationAmplitude > 0) {
    rows.push({
      label: ui('initial front', '初期界面'),
      value: ui(
        `${config.frontPerturbationModeCount} cosine modes, phase=${angleLabel(config.frontPerturbationPhase)}`,
        `余弦${config.frontPerturbationModeCount}モード、位相=${angleLabel(config.frontPerturbationPhase)}`
      )
    });
  }

  return rows;
}

function reproductionThumbnail(presetId: string): ReproductionThumbnail | undefined {
  return reproductionThumbnails[presetId];
}

function webGpuReproductionThumbnail(thumbnail: ReproductionThumbnail | undefined): ReproductionThumbnail | undefined {
  if (!thumbnail?.src.startsWith('/reproductions/fig')) return undefined;
  const src = thumbnail.src.replace('/reproductions/', '/reproductions/webgpu/');
  return {
    src: `${src}?v=${WEBGPU_REPRODUCTION_VERSION}`,
    label: ui('WebGPU explicit-T final state', 'WebGPU・T陽解法の最終状態')
  };
}

function localizedThumbnailLabel(label: string | undefined): string {
  if (!label) return ui('run in Lab', 'ラボで実行');
  if (!isJapanese()) return label;
  if (label.includes('CPU implicit-T / WebGL')) return 'CPU・T陰解法 / WebGL画像';
  if (label.includes('CPU implicit-T')) return 'CPU・T陰解法の最終状態';
  if (label.includes('WebGPU explicit-T')) return 'WebGPU・T陽解法の最終状態';
  return label;
}

function localizedReproductionGroup(group: ReproductionGroup): ReproductionGroup {
  if (!isJapanese()) return group;
  const copies: Record<string, Pick<ReproductionGroup, 'title' | 'description'>> = {
    'Fig.3-4: planar validation': {
      title: 'Fig.3-4：平面界面の検証',
      description: 'デンドライト条件へ進む前に、全壁冷却と左壁冷却による平面界面を確認します。'
    },
    'Fig.5: isotropic directional solidification': {
      title: 'Fig.5：等方的な方向凝固',
      description: '断熱された過冷却融液の長方形流路で、安定平面から枝の競合までKを変化させます。'
    },
    'Fig.6: four-fold anisotropic directional solidification': {
      title: 'Fig.6：4回対称異方性を持つ方向凝固',
      description: 'Fig.5と同じ流路に、delta = 0.050の4回対称異方性を加えます。'
    },
    'Fig.7: four-fold anisotropy strength': {
      title: 'Fig.7：4回対称異方性の強さ',
      description: '底辺核、K = 2.0、標準界面ノイズの条件でdeltaを変化させます。'
    },
    'Fig.8: six-fold anisotropy': {
      title: 'Fig.8：6回対称異方性',
      description: '中央核と6回対称異方性を用い、凸六角形から雪片状分岐までKを変化させます。'
    },
    'Fig.9-10: side-branch noise comparison': {
      title: 'Fig.9-10：サイドブランチとノイズの比較',
      description: '底辺から成長する4回対称デンドライトで、ノイズ感度と振動性サイドブランチを比較します。'
    }
  };
  return { ...group, ...(copies[group.title] ?? {}) };
}

function k2002AssetTitle(asset: K2002Asset): string {
  if (!isJapanese()) return asset.title;
  return asset.presetId === 'paper-fig9-3d-left-target'
    ? 'Fig.9左：等方3D核'
    : 'Fig.9右：4回対称3D推定条件';
}

function k2002AssetSubtitle(asset: K2002Asset): string {
  if (!isJapanese()) return asset.subtitle;
  return asset.presetId === 'paper-fig9-3d-left-target'
    ? '底面中央に核を置いた全領域3D計算を、公開WebGLアニメーションとして再現しています。'
    : '1/4領域を計算し、表示時にx-y方向へ反転しています。z軸は左から右へ表示します。';
}

function k2002AssetNotes(asset: K2002Asset): string[] {
  if (!isJapanese()) return asset.notes;
  return asset.presetId === 'paper-fig9-3d-left-target'
    ? [
        '図との比較から選んだ推定パラメータ',
        '160 x 160 x 100メッシュ',
        '計算領域 4.8 x 4.8 x 3.0',
        'K=2.5, delta=0, a=0.01, r=7',
        't=0.4、30 fps・200フレーム'
      ]
    : [
        '図との比較から選んだ推定パラメータ',
        '50 x 50 x 200の1/4領域メッシュ',
        '表示領域 100 x 100 x 200',
        'K=3.5, delta=0.020, a=0.005, r=7',
        't=0.9、30 fps・450フレーム'
      ];
}

function threeDModelNotes(): string {
  if (isJapanese()) return threeDModelNotesJapanese();
  return `
        <h2>3D method and visualization</h2>
        <p>The 3D implementation is the browser extension of the same phase-field system. It is documented here rather than as a separate preset page: K2002 final states live in Reproductions, and Lab is the place to load a target and then change parameters.</p>
        <section class="method-grid" aria-label="3D solver method">
          <div class="method-card">
            <h2>State And Grid</h2>
            <p>${mathInline('<mrow><mi>p</mi><mo stretchy="false">(</mo><mi>x</mi><mo>,</mo><mi>y</mi><mo>,</mo><mi>z</mi><mo stretchy="false">)</mo></mrow>', 'p as a function of x y z')} and ${mathInline('<mrow><mi>T</mi><mo stretchy="false">(</mo><mi>x</mi><mo>,</mo><mi>y</mi><mo>,</mo><mi>z</mi><mo stretchy="false">)</mo></mrow>', 'temperature as a function of x y z')} are stored as flat <code>Float32Array</code> fields. The solver assumes ${mathInline('<mrow><mi mathvariant="normal">Δx</mi><mo>=</mo><mi mathvariant="normal">Δy</mi><mo>=</mo><mi mathvariant="normal">Δz</mi></mrow>', 'uniform grid spacing')}. K2002 right-type runs use a quarter domain with Neumann symmetry planes in <code>x</code> and <code>y</code>, then mirror the data only for display. K2002 Fig.9-left is a full-domain run with a bottom-face-centered nucleus and no x-y mirror.</p>
          </div>
          <div class="method-card">
            <h2>Phase Step</h2>
            ${explicitPhaseStepMath()}
            <p>${mathInline('<mi>p</mi>', 'p')} is advanced explicitly from anisotropic flux divergence, reaction, and deterministic interface-localized noise. This keeps the browser solver simple but makes high ${mathInline('<mrow><mi mathvariant="normal">Δt</mi></mrow>', 'time step')}, strong anisotropy, and large 3D grids stability-sensitive.</p>
          </div>
          <div class="method-card">
            <h2>Temperature Step</h2>
            ${mathBlock(implicitTemperatureMathMarkup(), 'implicit temperature update equation')}
            <p>Neumann cases use the memory-saving ICCG solver; fixed-temperature boundaries fall back to Jacobi iteration. The latent heat increment ${mathInline('<mrow><mi>K</mi><mi>Δ</mi><mi>p</mi></mrow>', 'K delta p')} is coupled to the temperature update without making ${mathInline('<mi>p</mi>', 'p')} itself implicit.</p>
          </div>
          <div class="method-card">
            <h2>3D Anisotropy</h2>
            <p>The four-fold 3D paper target uses the vector form from K2002 ${cite('K2002')}, with ${mathInline('<mrow><mi>v</mi><mo>=</mo><mo>-</mo><mo>∇</mo><mi>p</mi></mrow>', 'v equals minus gradient p')}.</p>
            ${sigma3DMath()}
            ${anisotropicFlux3DMath()}
            <p>Fluxes include the derivative of ${mathInline('<mi>σ</mi>', 'sigma')} with respect to ${mathInline('<mi>v</mi>', 'v')}, so coordinate-axis directions become preferred growth directions.</p>
          </div>
          <div class="method-card">
            <h2>Rendering</h2>
            <p><code>Isosurface</code> renders the interpolated ${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>0.5</mn></mrow>', 'p equals zero point five')} surface as a three.js <code>BufferGeometry</code>. <code>Slices</code> shows three scalar planes. <code>Volume</code> uploads ${mathInline('<mi>p</mi>', 'p')} as a three.js <code>Data3DTexture</code> and ray-marches it in a WebGL2 GLSL fragment shader. The K2002 Fig.9-left presentation view uses the same WebGL isosurface renderer with a blue background, gold material, and simulation <code>z</code> nearly vertical.</p>
          </div>
          <div class="method-card">
            <h2>Outputs</h2>
            <p>Lab can export the current view as PNG, the active parameters as JSON, the full fields as <code>.pfstate</code>, and the current isosurface as binary STL. The mirrored STL option expands quarter-domain x-y symmetry into a full displayed domain.</p>
          </div>
        </section>

        <section class="method-grid" aria-label="3D visualization notes">
          <div class="method-card">
            <h2>Viewer Interaction</h2>
            <p>Final-state viewers use OrbitControls for rotation and zoom. Presentation-specific orientation is applied to the model, not by changing the camera up-vector, so mouse movement remains screen-relative. The K2002 right viewer presents simulation <code>z</code> from left to right; the K2002 left viewer presents simulation <code>z</code> nearly upward.</p>
          </div>
          <div class="method-card">
            <h2>Public Assets</h2>
            <p>Published 3D assets are generated outputs: MP4 animations, poster PNGs, public final-state field files for the interactive viewer, and downloadable <code>p=0.5</code> STL isosurfaces. The STL files are generated from the same public <code>.pfstate</code> final states rather than from paper figures.</p>
          </div>
          <div class="method-card">
            <h2>Exploration Policy</h2>
            <p>K2002 parameter values that were not available in the source material are marked as estimates. Future K or ${mathInline('<mi>δ</mi>', 'delta')} sweeps should be described as right-type exploratory runs, not as additional paper reproductions.</p>
          </div>
          <div class="method-card">
            <h2>WebGPU GPGPU Step</h2>
            <p>The WebGPU backend is an explicit stencil solver. Each compute invocation updates one grid cell from the previous ${mathInline('<mi>p</mi>', 'p')} and ${mathInline('<mi>T</mi>', 'temperature')} buffers, reads only neighboring cells, writes the next buffers, and then ping-pongs the buffers for the next step. This local, uniform work is the part of the phase-field calculation that maps cleanly to GPGPU hardware.</p>
            <p>The CPU reproduction path solves temperature diffusion implicitly with ICCG/Jacobi iteration. That allows a larger <code>dt</code>, but it is a coupled linear solve with repeated sweeps and synchronization. The current browser WebGPU path therefore uses explicit temperature integration: smaller <code>dt</code>, but much more parallel work per wall-clock second.</p>
          </div>
          <div class="method-card">
            <h2>WebGPU Display Rate</h2>
            <p>Because the WebGPU temperature update is explicit, <code>dt</code> must stay below the stability limit set by diffusion and by latent-heat feedback. Larger <code>K</code> strengthens the <code>K Δp</code> coupling, so high-<code>K</code> runs need a smaller <code>dt</code>. The app lowers <code>dt</code> when WebGPU is selected instead of hiding this numerical difference.</p>
            <p>WebGPU can still be faster because it advances many small steps before a visible frame is needed. A larger <code>steps/frame</code> does not change <code>dt</code>; it batches solver steps and amortizes readback plus marching-cubes work over more model time. The K2002 3D WebGPU defaults use <code>dt=5e-5</code>, with <code>steps/frame=500</code> for Fig.9-left and <code>steps/frame=1000</code> for Fig.9-right.</p>
          </div>
          <div class="method-card">
            <h2>Browser Limits</h2>
            <p>Published 3D reproduction media were generated with the CPU implicit-temperature solver. On the Apple M1 Max development machine, TypeScript/WebGL animation runs took about 44 minutes for the K2002 Fig.9-left <code>160 x 160 x 100</code>, 2000-step case and about 48 minutes for the K2002 Fig.9-right <code>50 x 50 x 200</code>, 4500-step case. Lab also includes an experimental 3D WebGPU backend for faster exploratory stepping, but it uses explicit temperature integration and is not the public reproduction sample path.</p>
          </div>
        </section>

        <p class="reproduction-note">Use Reproductions for K2002 final states and Lab for live parameter changes. This tab is intentionally explanatory so the public app does not mix documented solver behavior with provisional preset experiments.</p>
  `;
}

function threeDModelNotesJapanese(): string {
  return `
        <h2>3Dの計算法と可視化</h2>
        <p>3D実装は、同じフェーズフィールド系をブラウザ上で3次元へ拡張したものです。K2002の最終状態は「再現図」で表示し、ラボでは対象プリセットを読み込んでパラメータを変更できます。</p>
        <section class="method-grid" aria-label="3Dソルバーの計算法">
          <div class="method-card">
            <h2>状態変数と格子</h2>
            <p>${mathInline('<mrow><mi>p</mi><mo stretchy="false">(</mo><mi>x</mi><mo>,</mo><mi>y</mi><mo>,</mo><mi>z</mi><mo stretchy="false">)</mo></mrow>', 'p as a function of x y z')}と${mathInline('<mrow><mi>T</mi><mo stretchy="false">(</mo><mi>x</mi><mo>,</mo><mi>y</mi><mo>,</mo><mi>z</mi><mo stretchy="false">)</mo></mrow>', 'temperature as a function of x y z')}を、平坦な<code>Float32Array</code>として保持します。格子幅は${mathInline('<mrow><mi mathvariant="normal">Δx</mi><mo>=</mo><mi mathvariant="normal">Δy</mi><mo>=</mo><mi mathvariant="normal">Δz</mi></mrow>', 'uniform grid spacing')}です。K2002 Fig.9右型では、<code>x</code>と<code>y</code>のノイマン対称面を使って1/4領域だけを計算し、表示時だけ反転します。Fig.9左は底面中央核を持つ全領域計算で、x-y反転は行いません。</p>
          </div>
          <div class="method-card">
            <h2>フェーズ場の更新</h2>
            ${explicitPhaseStepMath()}
            <p>${mathInline('<mi>p</mi>', 'p')}は、異方性流束の発散、反応項、決定論的に再現可能な界面局在ノイズから陽的に更新します。構成は単純ですが、大きな${mathInline('<mrow><mi mathvariant="normal">Δt</mi></mrow>', 'time step')}、強い異方性、大規模3D格子では安定性に注意が必要です。</p>
          </div>
          <div class="method-card">
            <h2>温度場の更新</h2>
            ${mathBlock(implicitTemperatureMathMarkup(), 'implicit temperature update equation')}
            <p>ノイマン境界では省メモリ型ICCGを使い、温度固定境界ではヤコビ反復へ切り替えます。潜熱増分${mathInline('<mrow><mi>K</mi><mi>Δ</mi><mi>p</mi></mrow>', 'K delta p')}は温度更新に結合しますが、${mathInline('<mi>p</mi>', 'p')}自体は陰解法にはしていません。</p>
          </div>
          <div class="method-card">
            <h2>3D異方性</h2>
            <p>4回対称の3D対象には、${mathInline('<mrow><mi>v</mi><mo>=</mo><mo>-</mo><mo>∇</mo><mi>p</mi></mrow>', 'v equals minus gradient p')}としてK2002のベクトル形式${cite('K2002')}を使います。</p>
            ${sigma3DMath()}
            ${anisotropicFlux3DMath()}
            <p>流束には${mathInline('<mi>σ</mi>', 'sigma')}の${mathInline('<mi>v</mi>', 'v')}に関する微分も含まれるため、座標軸方向が優先成長方向になります。</p>
          </div>
          <div class="method-card">
            <h2>レンダリング</h2>
            <p>「等値面」は、補間した${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>0.5</mn></mrow>', 'p equals zero point five')}面をthree.jsの<code>BufferGeometry</code>として描画します。「断面」は3枚のスカラー断面を表示します。「ボリューム」は${mathInline('<mi>p</mi>', 'p')}をthree.jsの<code>Data3DTexture</code>へ転送し、WebGL2のGLSLフラグメントシェーダーでレイマーチングします。K2002 Fig.9左の提示用表示も同じWebGL等値面レンダラーを使い、青い背景、金色の材質、ほぼ鉛直なシミュレーション<code>z</code>軸で表示します。</p>
          </div>
          <div class="method-card">
            <h2>出力</h2>
            <p>ラボから、現在の表示をPNG、パラメータをJSON、全場を<code>.pfstate</code>、等値面をバイナリSTLとして出力できます。反転STLでは、x-y対称な1/4領域を表示用の全領域へ展開します。</p>
          </div>
        </section>

        <section class="method-grid" aria-label="3D可視化の補足">
          <div class="method-card">
            <h2>ビューアの操作</h2>
            <p>最終状態ビューアはOrbitControlsで回転・拡大します。提示用の向きはカメラの上方向ではなくモデル側へ適用するため、マウス操作は画面の向きに一致します。K2002右ビューアではシミュレーション<code>z</code>軸を左から右へ、左ビューアではほぼ上向きに表示します。</p>
          </div>
          <div class="method-card">
            <h2>公開データ</h2>
            <p>公開3Dデータは、本シミュレータで生成したMP4、ポスターPNG、最終状態場ファイル、ダウンロード可能な<code>p=0.5</code>のSTL等値面です。STLは論文図ではなく、公開している同じ<code>.pfstate</code>最終状態から生成しています。</p>
          </div>
          <div class="method-card">
            <h2>探索条件の扱い</h2>
            <p>資料から得られなかったK2002のパラメータは推定値と明記します。今後のKや${mathInline('<mi>δ</mi>', 'delta')}の掃引は、追加の論文再現ではなく、Fig.9右型の探索計算として扱います。</p>
          </div>
          <div class="method-card">
            <h2>WebGPUによるGPGPU計算</h2>
            <p>WebGPUバックエンドは陽的ステンシルソルバーです。各compute invocationは、前ステップの${mathInline('<mi>p</mi>', 'p')}と${mathInline('<mi>T</mi>', 'temperature')}から1格子点を更新し、近傍点だけを読み、次のバッファへ書き込みます。各ステップでバッファを交換します。この局所的で一様な処理はGPGPUで並列化しやすい部分です。</p>
            <p>CPU再現経路では温度拡散をICCGまたはヤコビ反復で陰的に解くため大きな<code>dt</code>を使えますが、連立一次方程式の反復と同期が必要です。WebGPU経路は温度も陽的に更新し、小さな<code>dt</code>を多数並列に進めます。</p>
          </div>
          <div class="method-card">
            <h2>WebGPUの表示間隔</h2>
            <p>WebGPUの温度更新は陽解法なので、<code>dt</code>は拡散と潜熱フィードバックから定まる安定限界より小さくする必要があります。大きな<code>K</code>は<code>K Δp</code>結合を強めるため、より小さな<code>dt</code>が必要です。アプリはこの差を隠さず、WebGPU選択時に<code>dt</code>を下げます。</p>
            <p>それでもWebGPUは、表示1回の間に多数の小ステップを進められるため高速です。大きな<code>steps/frame</code>は<code>dt</code>を変えず、読み戻しとMarching Cubesの負荷をより長いモデル時間へ分散します。K2002 3DのWebGPU既定値は<code>dt=5e-5</code>で、Fig.9左が<code>steps/frame=500</code>、右が<code>steps/frame=1000</code>です。</p>
          </div>
          <div class="method-card">
            <h2>ブラウザでの計算時間</h2>
            <p>公開3D再現メディアはCPU・温度陰解法で生成しました。開発機のApple M1 Maxでは、TypeScript/WebGLアニメーションの所要時間は、K2002 Fig.9左の<code>160 x 160 x 100</code>・2000ステップで約44分、Fig.9右の<code>50 x 50 x 200</code>・4500ステップで約48分でした。ラボの実験的3D WebGPUバックエンドは探索計算を高速化できますが、温度陽解法であり公開再現サンプルの計算経路とは異なります。</p>
          </div>
        </section>

        <p class="reproduction-note">K2002の最終状態は「再現図」、パラメータを変えたライブ計算は「ラボ」を使ってください。説明済みの計算法と暫定的なプリセット探索を混同しないため、このページは手法の説明に限定しています。</p>
  `;
}

function threeDPresetRows(config: PhaseFieldConfig): Array<{ label: string; value: string }> {
  return [
    { label: ui('mesh', 'メッシュ'), value: meshLabel(config) },
    { label: ui('domain', '計算領域'), value: domainSizeLabel(config) },
    { label: 'dx / dt', value: `${compactNumber(config.dx)} / ${compactNumber(config.dt)}` },
    { label: ui('solver', 'ソルバー'), value: ui(`${config.temperatureSolver ?? 'iccg'} T, explicit p`, `${config.temperatureSolver ?? 'iccg'}・T、p陽解法`) },
    { label: 'K / tau', value: `${compactNumber(config.latentHeat)} / ${compactNumber(config.tau)}` },
    { label: ui('anisotropy', '異方性'), value: anisotropyLabel(config) },
    { label: ui('noise', 'ノイズ'), value: `a=${compactNumber(config.noiseAmplitude)}, seed=${config.seed}` },
    { label: ui('nucleus', '初期核'), value: `${placementLabel(config)} ${nucleusSizeLabel(config)}` },
    { label: ui('render', '表示'), value: renderModeLabel(config.renderMode3D) }
  ];
}

function meshLabel(config: PhaseFieldConfig): string {
  return config.dimension === '3d' ? `${config.nx} x ${config.ny} x ${config.nz}` : `${config.nx} x ${config.ny}`;
}

function domainSizeLabel(config: PhaseFieldConfig): string {
  const x = config.nx * config.dx;
  const y = config.ny * config.dx;
  if (config.dimension === '2d') {
    return `${compactNumber(x)} x ${compactNumber(y)}`;
  }

  const z = config.nz * config.dx;
  const quarterDomain = `${compactNumber(x)} x ${compactNumber(y)} x ${compactNumber(z)}`;
  if (isXYMirroredQuarterDomain(config)) {
    return ui(
      `quarter ${quarterDomain}; mirrored ${compactNumber(2 * x)} x ${compactNumber(2 * y)} x ${compactNumber(z)}`,
      `1/4領域 ${quarterDomain}、反転表示 ${compactNumber(2 * x)} x ${compactNumber(2 * y)} x ${compactNumber(z)}`
    );
  }
  return quarterDomain;
}

function isXYMirroredQuarterDomain(config: PhaseFieldConfig): boolean {
  return config.dimension === '3d' && config.nucleusPlacement === 'bottom-corner-halfcell';
}

function nucleusSizeLabel(config: PhaseFieldConfig): string {
  const physicalRadius = config.nucleusRadius * config.dx;
  const label =
    config.nucleusPlacement === 'left-wall'
      ? ui('front thickness', '界面厚さ')
      : config.nucleusPlacement === 'walls'
        ? ui('wall thickness', '壁面厚さ')
        : 'r';
  return ui(
    `${label}=${compactNumber(config.nucleusRadius)} cells (${compactNumber(physicalRadius)} units)`,
    `${label}=${compactNumber(config.nucleusRadius)}セル（${compactNumber(physicalRadius)}モデル長）`
  );
}

function anisotropyLabel(config: PhaseFieldConfig): string {
  if (config.anisotropyMode === 'isotropic' || config.anisotropyStrength === 0) return t('isotropic');
  return `delta=${compactNumber(config.anisotropyStrength)}, j=${config.anisotropyFold}, theta0=${angleLabel(config.anisotropyAngle)}`;
}

function boundaryLabel(boundary: BoundaryCondition): string {
  if (boundary === 'neumann') return t('noFlux');
  if (boundary === 'left-fixed-temperature') return t('leftFixedTemperature');
  return ui('fixed T edge', '境界温度固定');
}

function placementLabel(config: PhaseFieldConfig): string {
  if (config.nucleusPlacement === 'left-wall') return ui('left front', '左壁界面');
  if (config.nucleusPlacement === 'bottom-edge') return ui('bottom seed', '底辺核');
  if (config.nucleusPlacement === 'walls') return ui('wall seed', '壁面核');
  if (config.nucleusPlacement === 'bottom-corner-halfcell') return ui('corner half-cell seed', '角・半セル外核');
  if (config.nucleusPlacement === 'bottom-face-center-halfcell') return ui('bottom-face center half-cell seed', '底面中央・半セル外核');
  if (config.nucleusPlacement === 'bottom-corner') return ui('corner seed', '角核');
  return ui('center seed', '中央核');
}

function angleLabel(value: number): string {
  if (Math.abs(value) < 1e-9) return '0';
  if (Math.abs(value - Math.PI / 2) < 1e-9) return 'pi/2';
  if (Math.abs(value - Math.PI) < 1e-9) return 'pi';
  return compactNumber(value);
}

function compactNumber(value: number): string {
  if (Object.is(value, -0) || Math.abs(value) < 1e-12) return '0';
  if (Math.abs(value) < 0.001) return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (Math.abs(value) < 0.01) return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  if (Math.abs(value) < 1) return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

type ModelReference = {
  key: string;
  authors: string;
  meta: string;
  url?: string;
};

const modelReferences: ModelReference[] = [
  {
    key: 'K1993',
    authors: 'Ryo Kobayashi',
    meta: '“Modeling and numerical simulations of dendritic crystal growth,” Physica D: Nonlinear Phenomena 63(3-4), 410-423, 1993. DOI: 10.1016/0167-2789(93)90120-P.',
    url: 'https://doi.org/10.1016/0167-2789(93)90120-P'
  },
  {
    key: 'K2002',
    authors: 'Ryo Kobayashi (小林亮)',
    meta: '“フェーズフィールドモデル入門,” unpublished Japanese notes on the phase-field model, private communication, 2002.'
  },
  {
    key: 'WMS1992',
    authors: 'A. A. Wheeler, B. T. Murray, R. J. Schaefer',
    meta: '“Computation of dendrites using a phase field model,” NISTIR 4894, 1992. DOI: 10.6028/NIST.IR.4894.',
    url: 'https://doi.org/10.6028/NIST.IR.4894'
  },
  {
    key: 'T2014',
    authors: 'Tomohiro Takaki',
    meta: '“Phase-field Modeling and Simulations of Dendrite Growth,” ISIJ International 54(2), 437-444, 2014. DOI: 10.2355/isijinternational.54.437.',
    url: 'https://doi.org/10.2355/isijinternational.54.437'
  },
  {
    key: 'S2014',
    authors: 'R. Sanal',
    meta: '“Numerical Simulation of Dendritic crystal growth using Phase Field method,” arXiv: 1412.3197, 2014.',
    url: 'https://arxiv.org/abs/1412.3197'
  }
];

function cite(referenceKey: string): string {
  const reference = modelReferences.find((candidate) => candidate.key === referenceKey);
  if (!reference) return `<span class="citation">${referenceKey}</span>`;
  if (!reference.url) {
    return `<span class="citation" title="${escapeHtml(reference.meta)}">${referenceKey}</span>`;
  }
  return `<a class="citation" href="${escapeHtml(reference.url)}" target="_blank" rel="noreferrer">${referenceKey}</a>`;
}

function mathInline(markup: string, label: string): string {
  return `<span class="math-inline"><math aria-label="${label}">${markup}</math></span>`;
}

function mathBlock(markup: string, label: string): string {
  return `<div class="math-block"><math display="block" aria-label="${label}">${markup}</math></div>`;
}

function phaseEquationMath(): string {
  return mathBlock(
    `<mrow>
      <mi>τ</mi><mfrac><mrow><mo>∂</mo><mi>p</mi></mrow><mrow><mo>∂</mo><mi>t</mi></mrow></mfrac>
      <mo>=</mo>
      <mo>∇</mo><mo>·</mo><mi>F</mi><mo stretchy="false">(</mo><mi>p</mi><mo stretchy="false">)</mo>
      <mo>+</mo>
      <mi>p</mi><mo stretchy="false">(</mo><mn>1</mn><mo>-</mo><mi>p</mi><mo stretchy="false">)</mo>
      <mo stretchy="false">(</mo><mi>p</mi><mo>-</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><mo>+</mo><mi>m</mi><mo stretchy="false">(</mo><mi>T</mi><mo stretchy="false">)</mo><mo stretchy="false">)</mo>
      <mo>+</mo><mi>η</mi>
    </mrow>`,
    'phase-field evolution equation'
  );
}

function temperatureEquationMath(): string {
  return mathBlock(
    `<mrow>
      <mfrac><mrow><mo>∂</mo><mi>T</mi></mrow><mrow><mo>∂</mo><mi>t</mi></mrow></mfrac>
      <mo>=</mo>
      <msub><mi>D</mi><mi>T</mi></msub><msup><mo>∇</mo><mn>2</mn></msup><mi>T</mi>
      <mo>+</mo>
      <mi>K</mi><mfrac><mrow><mo>∂</mo><mi>p</mi></mrow><mrow><mo>∂</mo><mi>t</mi></mrow></mfrac>
    </mrow>`,
    'temperature evolution equation'
  );
}

function driveEquationMath(): string {
  return mathBlock(
    `<mrow>
      <mi>m</mi><mo stretchy="false">(</mo><mi>T</mi><mo stretchy="false">)</mo>
      <mo>=</mo>
      <mfrac><mi>α</mi><mi>π</mi></mfrac>
      <msup><mi>tan</mi><mrow><mo>-</mo><mn>1</mn></mrow></msup>
      <mo stretchy="false">(</mo><mi>γ</mi><mo stretchy="false">(</mo><msub><mi>T</mi><mi>e</mi></msub><mo>-</mo><mi>T</mi><mo stretchy="false">)</mo><mo stretchy="false">)</mo>
    </mrow>`,
    'thermal driving function'
  );
}

function epsilon2DMath(): string {
  return mathInline(
    `<mrow>
      <mi>ε</mi><mo stretchy="false">(</mo><mi>θ</mi><mo stretchy="false">)</mo>
      <mo>=</mo>
      <mover><mi>ε</mi><mo>¯</mo></mover>
      <mo stretchy="false">(</mo><mn>1</mn><mo>+</mo><mi>δ</mi><mi>cos</mi><mo stretchy="false">(</mo><mi>j</mi><mo stretchy="false">(</mo><mi>θ</mi><mo>-</mo><msub><mi>θ</mi><mn>0</mn></msub><mo stretchy="false">)</mo><mo stretchy="false">)</mo><mo stretchy="false">)</mo>
    </mrow>`,
    'epsilon theta equals epsilon bar times one plus delta cosine j theta minus theta zero'
  );
}

function implicitTemperatureMathMarkup(): string {
  return (
    `<mrow>
      <mo stretchy="false">(</mo><mi>I</mi><mo>-</mo><mi mathvariant="normal">Δt</mi><msub><mi>D</mi><mi>T</mi></msub><msup><mo>∇</mo><mn>2</mn></msup><mo stretchy="false">)</mo>
      <msup><mi>T</mi><mrow><mi>n</mi><mo>+</mo><mn>1</mn></mrow></msup>
      <mo>=</mo>
      <msup><mi>T</mi><mi>n</mi></msup>
      <mo>+</mo>
      <mi>K</mi><mo stretchy="false">(</mo><msup><mi>p</mi><mrow><mi>n</mi><mo>+</mo><mn>1</mn></mrow></msup><mo>-</mo><msup><mi>p</mi><mi>n</mi></msup><mo stretchy="false">)</mo>
    </mrow>`
  );
}

function implicitTemperatureMath(): string {
  return mathInline(implicitTemperatureMathMarkup(), 'implicit temperature update equation');
}

function explicitPhaseStepMath(): string {
  return mathBlock(
    `<mrow>
      <msup><mi>p</mi><mrow><mi>n</mi><mo>+</mo><mn>1</mn></mrow></msup>
      <mo>=</mo>
      <msup><mi>p</mi><mi>n</mi></msup>
      <mo>+</mo>
      <mfrac><mrow><mi mathvariant="normal">Δt</mi></mrow><mi>τ</mi></mfrac>
      <mo stretchy="false">[</mo>
      <mo>∇</mo><mo>·</mo><mi>F</mi>
      <mo>+</mo>
      <mi>p</mi><mo stretchy="false">(</mo><mn>1</mn><mo>-</mo><mi>p</mi><mo stretchy="false">)</mo>
      <mo stretchy="false">(</mo><mi>p</mi><mo>-</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><mo>+</mo><mi>m</mi><mo stretchy="false">(</mo><mi>T</mi><mo stretchy="false">)</mo><mo stretchy="false">)</mo>
      <mo>+</mo><mi>η</mi>
      <mo stretchy="false">]</mo>
    </mrow>`,
    'explicit phase update equation'
  );
}

function sigma3DMath(): string {
  return mathBlock(
    `<mrow>
      <mi>σ</mi><mo stretchy="false">(</mo><mi>v</mi><mo stretchy="false">)</mo>
      <mo>=</mo>
      <mn>1</mn>
      <mo>+</mo>
      <mi>δ</mi>
      <mo stretchy="false">(</mo>
      <mfrac><mrow><mn>4</mn><msub><mo>∑</mo><mi>i</mi></msub><msubsup><mi>v</mi><mi>i</mi><mn>4</mn></msubsup></mrow><msup><mrow><mo>|</mo><mi>v</mi><mo>|</mo></mrow><mn>4</mn></msup></mfrac>
      <mo>-</mo><mn>3</mn>
      <mo stretchy="false">)</mo>
    </mrow>`,
    'three dimensional four fold anisotropy sigma'
  );
}

function anisotropicFlux3DMath(): string {
  return mathBlock(
    `<mrow>
      <msub><mi>F</mi><mi>i</mi></msub>
      <mo>=</mo>
      <msup><mi>ε</mi><mn>2</mn></msup><msub><mi>p</mi><mi>i</mi></msub>
      <mo>-</mo>
      <msup><mrow><mo>|</mo><mo>∇</mo><mi>p</mi><mo>|</mo></mrow><mn>2</mn></msup>
      <mi>ε</mi>
      <mfrac><mrow><mo>∂</mo><mi>ε</mi></mrow><mrow><mo>∂</mo><msub><mi>v</mi><mi>i</mi></msub></mrow></mfrac>
    </mrow>`,
    'anisotropic flux component'
  );
}

function initialConditionMath(): string {
  return mathBlock(
    `<mrow>
      <msub><mi>p</mi><mn>0</mn></msub>
      <mo stretchy="false">(</mo><mi>r</mi><mo stretchy="false">)</mo>
      <mo>=</mo>
      <mfrac><mn>1</mn><mn>2</mn></mfrac>
      <mo stretchy="false">[</mo>
        <mn>1</mn>
        <mo>-</mo>
        <mi>tanh</mi>
        <mo stretchy="false">(</mo>
          <mfrac>
            <mrow>
              <mi>d</mi><mo stretchy="false">(</mo><mi>r</mi><mo stretchy="false">)</mo>
              <mo>-</mo>
              <msub><mi>r</mi><mn>0</mn></msub>
            </mrow>
            <mi>w</mi>
          </mfrac>
        <mo stretchy="false">)</mo>
      <mo stretchy="false">]</mo>
    </mrow>`,
    'smooth tanh initial phase profile'
  );
}

function modelTemplate(): string {
  if (isJapanese()) return modelTemplateJapanese();
  return `
    <article class="content-page">
      <div class="content-inner">
        <h1>Model & Method</h1>
        <p>This simulator is a qualitative browser implementation of Ryo Kobayashi's phase-field dendrite model ${cite('K1993')} ${cite('K2002')}. It is intended for exploring how anisotropy, latent heat, thermal diffusion, and interface noise shape dendritic growth. It is not a calibrated production materials-science solver.</p>
        <h2>Fields</h2>
        <p>${mathInline('<mi>p</mi>', 'p')} is the phase field. The app uses ${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>0</mn></mrow>', 'p equals zero')} for liquid, ${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>1</mn></mrow>', 'p equals one')} for solid, and renders the solid-liquid interface near ${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>0.5</mn></mrow>', 'p equals zero point five')}. Because the interface is represented as a continuous field on a grid, the solver can handle tip splitting and side branching without explicitly tracking a moving curve or surface.</p>
        <p>${mathInline('<mi>T</mi>', 'temperature')} is the temperature / undercooling-related field. When solidification advances, latent heat proportional to ${mathInline('<mfrac><mrow><mo>∂</mo><mi>p</mi></mrow><mrow><mo>∂</mo><mi>t</mi></mrow></mfrac>', 'partial p over partial time')} is added back into ${mathInline('<mi>T</mi>', 'temperature')}, and the changed thermal field then feeds back into later interface growth.</p>
        <h2>Qualitative equations</h2>
        <div class="equation-block">
          ${phaseEquationMath()}
          ${temperatureEquationMath()}
          ${driveEquationMath()}
          <dl class="phase-state-list">
            <div><dt>${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>0</mn></mrow>', 'p equals zero')}</dt><dd>liquid</dd></div>
            <div><dt>${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>1</mn></mrow>', 'p equals one')}</dt><dd>solid</dd></div>
            <div><dt>${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>0.5</mn></mrow>', 'p equals zero point five')}</dt><dd>rendered interface</dd></div>
          </dl>
        </div>
        <h2>Initial conditions</h2>
        <p>The app initializes ${mathInline('<mi>p</mi>', 'p')} as a diffuse interface, not as a hard binary mask. This follows the phase-field convention used with the finite-difference model notes in K2002 ${cite('K2002')}: the solid core starts near ${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>1</mn></mrow>', 'p equals one')}, the surrounding liquid starts near ${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>0</mn></mrow>', 'p equals zero')}, and the transition crosses the visible interface at ${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>0.5</mn></mrow>', 'p equals zero point five')}.</p>
        ${initialConditionMath()}
        <p>Here ${mathInline('<mi>d</mi>', 'd')} is the geometry-dependent distance: radial distance from a circular or spherical nucleus, signed distance from a perturbed left-wall front, or distance to the nearest wall for the inward-growth wall preset. ${mathInline('<msub><mi>r</mi><mn>0</mn></msub>', 'r zero')} is the preset seed radius or wall/front thickness in mesh cells, and ${mathInline('<mi>w</mi>', 'w')} is the numerical diffuse-interface width in mesh cells.</p>
        <p>The shorthand <code>r=7</code> therefore means an initial seed radius of seven mesh cells. Its physical radius is ${mathInline('<mrow><mi>r</mi><mo>×</mo><mi mathvariant="normal">Δx</mi></mrow>', 'r times delta x')}; with the paper-target spacing <code>dx=0.03</code>, <code>r=7</code> corresponds to <code>0.21</code> model length units. In 2D bottom-edge presets this is a smooth half-disk clipped by the bottom Neumann wall; in center presets it is a smooth disk; in 3D it is a smooth sphere before boundary symmetry is applied.</p>
        <p>The seed radius is treated as an estimated reproduction parameter. In comparison runs, changing <code>r</code> noticeably changed early morphology, lower-wall gaps, and later side-branch density. The current K1993 dendrite-family presets and the K2002 Fig.9-right 3D estimate use the common <code>r=7</code> convention so that differences between figures mainly reflect <code>K</code>, anisotropy, noise, and geometry rather than an independently retuned initial seed.</p>
        <p>For the K2002 Fig.9-right 3D estimate, the quarter-domain seed is that <code>r=7</code> smooth sphere centered half a cell outside the x, y, and z Neumann planes. The app mirrors only x and y for the full-domain display/STL, so the visible object represents the x-y symmetry expansion of this quarter-domain calculation. The initial temperature field is uniform at the preset value; fixed-temperature boundaries are imposed at the boundary, and latent heat enters later through ${mathInline('<mrow><mi>K</mi><mi>Δ</mi><mi>p</mi></mrow>', 'K delta p')} during time stepping rather than being inserted into the initial field.</p>
        <h2>Paper validation path</h2>
        <p>The validation path starts with the planar-front cases in K1993 before moving to dendrite cases ${cite('K1993')}. The Fig.3 preset uses a <code>9.0 x 9.0</code> domain with a <code>300 x 300</code> mesh and inward growth from cooled walls. The Fig.4 preset uses a <code>12.0 x 3.0</code> domain with a <code>400 x 100</code> mesh, a perturbed left-wall solid front, and a fixed-temperature left wall. Fig.5 then sweeps all nine isotropic <code>K=0.8</code> to <code>K=2.0</code> directional-solidification cases, and Fig.6 repeats the same series with <code>delta=0.050</code> four-fold anisotropy.</p>
        <p>The K2002 Fig.9-right 3D target is an estimated browser preset, not a reported exact parameter set: <code>K=3.5</code>, <code>delta=0.020</code>, <code>a=0.005</code>, <code>r=7</code>, <code>dx=0.03</code>, <code>dt=0.0002</code>, and a <code>50 x 50 x 200</code> quarter-domain mesh. The physical quarter-domain is <code>1.5 x 1.5 x 6.0</code>; mirrored visualization and STL export correspond to <code>100 x 100 x 200</code> and <code>3.0 x 3.0 x 6.0</code>.</p>
        <h2>Anisotropy and noise</h2>
        <p>In 2D, the app uses ${epsilon2DMath()} ${cite('K1993')}. The anisotropic diffusion term is discretized with the half-grid flux form described in K2002, building ${mathInline('<msub><mi>p</mi><mrow><mi>i</mi><mo>+</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><mo>,</mo><mi>j</mi></mrow></msub>', 'p at i plus one half j')} and ${mathInline('<msub><mi>q</mi><mrow><mi>i</mi><mo>,</mo><mi>j</mi><mo>+</mo><mfrac><mn>1</mn><mn>2</mn></mfrac></mrow></msub>', 'q at i j plus one half')} before taking their divergence ${cite('K2002')}. With ${mathInline('<mrow><mi>j</mi><mo>=</mo><mn>4</mn></mrow>', 'j equals four')} and ${mathInline('<mrow><msub><mi>θ</mi><mn>0</mn></msub><mo>=</mo><mn>0</mn></mrow>', 'theta zero equals zero')}, the horizontal and vertical axes are preferred growth directions.</p>
        <p>Paper-target K1993 presets use the reported values where available: ${mathInline('<mrow><mi mathvariant="normal">Δx</mi><mo>=</mo><mn>0.03</mn></mrow>', 'delta x equals zero point zero three')}, ${mathInline('<mrow><mi mathvariant="normal">Δt</mi><mo>=</mo><mn>0.0002</mn></mrow>', 'delta t equals zero point zero zero zero two')}, ${mathInline('<mrow><mover><mi>ε</mi><mo>¯</mo></mover><mo>=</mo><mn>0.01</mn></mrow>', 'epsilon bar equals zero point zero one')}, ${mathInline('<mrow><mi>τ</mi><mo>=</mo><mn>0.0003</mn></mrow>', 'tau equals zero point zero zero zero three')}, ${mathInline('<mrow><mi>α</mi><mo>=</mo><mn>0.9</mn></mrow>', 'alpha equals zero point nine')}, ${mathInline('<mrow><mi>γ</mi><mo>=</mo><mn>10.0</mn></mrow>', 'gamma equals ten')}, plus the figure-specific ${mathInline('<mi>δ</mi>', 'delta')}, ${mathInline('<mi>K</mi>', 'K')}, ${mathInline('<mi>j</mi>', 'j')}, and boundary setup ${cite('K1993')}. Bottom nuclei are initialized as smooth tanh-profile half-disks rather than hard binary disks. The 2D solver advances ${mathInline('<mi>p</mi>', 'p')} explicitly, then solves ${implicitTemperatureMath()} with ICCG for Neumann boundaries and Jacobi iteration for fixed-temperature boundaries.</p>
        <p>Noise is applied on the ${mathInline('<mfrac><mrow><mo>∂</mo><mi>p</mi></mrow><mrow><mo>∂</mo><mi>t</mi></mrow></mfrac>', 'partial p over partial time')} side, corresponding to interface-velocity fluctuation ${cite('K1993')}. It is localized by ${mathInline('<mrow><mi>p</mi><mo stretchy="false">(</mo><mn>1</mn><mo>-</mo><mi>p</mi><mo stretchy="false">)</mo></mrow>', 'p times one minus p')}, so it acts near the diffuse interface rather than directly in the bulk liquid or bulk solid. Fig.7 uses the paper-default independent noise amplitude ${mathInline('<mrow><mi>a</mi><mo>=</mo><mn>0.010</mn></mrow>', 'a equals zero point zero one zero')}, while Fig.10 compares ${mathInline('<mrow><mi>a</mi><mo>=</mo><mn>0</mn></mrow>', 'a equals zero')}, ${mathInline('<mrow><mi>a</mi><mo>=</mo><mn>0.001</mn></mrow>', 'a equals zero point zero zero one')}, and ${mathInline('<mrow><mi>a</mi><mo>=</mo><mn>0.010</mn></mrow>', 'a equals zero point zero one zero')}.</p>
        <h2>WebGPU / GPGPU path</h2>
        <p>The Lab defaults to the experimental WebGPU backend for both 2D and 3D when WebGPU is available. WebGPU is used as a GPGPU stencil engine: one compute-shader invocation updates one grid cell from the previous ${mathInline('<mi>p</mi>', 'p')} and ${mathInline('<mi>T</mi>', 'temperature')} buffers, reads only a small local neighborhood, writes the next buffers, and then swaps buffers for the following step. This explicit local update is well matched to GPU hardware because many grid cells can be advanced in parallel with the same kernel.</p>
        <p>The CPU reproduction-oriented solver advances ${mathInline('<mi>p</mi>', 'p')} explicitly but solves ${mathInline('<mi>T</mi>', 'temperature')} diffusion implicitly. That implicit solve permits a larger <code>dt</code>, but it is a coupled linear-system solve with repeated ICCG/Jacobi sweeps and synchronization. The current browser WebGPU backend therefore uses explicit temperature integration instead. It needs a smaller <code>dt</code>, but the per-step work is massively parallel and can still be faster for interactive exploration.</p>
        <p>When a preset is loaded with WebGPU selected, the app lowers <code>dt</code> to the explicit-temperature stability estimate and increases <code>steps/frame</code> to keep the displayed physical-time advance practical. Because the explicit ${mathInline('<mi>T</mi>', 'temperature')} update contains diffusion and the latent-heat term <code>K Δp</code>, larger <code>K</code> requires a smaller <code>dt</code>.</p>
        <p>Independent interface noise is sampled once per solver step. Before dispatching the compute shader, the app uses ${mathInline('<mrow><msub><mi>a</mi><mtext>eff</mtext></msub><mo>=</mo><mi>a</mi><msqrt><mfrac><msub><mi mathvariant="normal">Δt</mi><mtext>ref</mtext></msub><mi mathvariant="normal">Δt</mi></mfrac></msqrt></mrow>', 'effective a equals a times the square root of reference delta t divided by delta t')} so changing <code>dt</code> preserves the noise variance scale per unit model time. Thus <code>dt: 2e-4 → 5e-5</code> passes <code>2a</code>; <code>a=0</code> remains zero. This applies to both 2D and 3D WebGPU stepping and is independent of <code>steps/frame</code>. Use WebGPU for interactive exploration, not for paper-target reproduction claims or public sample images.</p>
        <h2>Boundary conditions</h2>
        <p>${mathInline('<mi>p</mi>', 'p')} always uses no-flux / Neumann boundaries, following the zero-flux phase-field boundary described for K1993. ${mathInline('<mi>T</mi>', 'temperature')} can use adiabatic / no-flux, fixed-temperature edges, or a fixed-temperature left wall depending on the preset. Fig.7, Fig.8, Fig.9, and Fig.10 paper-target presets use the supercooled-melt adiabatic boundary setup.</p>
        ${threeDModelNotes()}
        <h2>Stability limits</h2>
        <p>The temperature diffusion solve is implicit, but the phase equation is still explicit finite-difference stepping. Large ${mathInline('<mrow><mi mathvariant="normal">Δt</mi></mrow>', 'time step')}, strong anisotropy, high noise, or high-resolution 3D grids can destabilize the run. The app does not visually smooth over numerical instability; reduce the parameters if a run becomes unstable.</p>
      </div>
    </article>
  `;
}

function modelTemplateJapanese(): string {
  return `
    <article class="content-page">
      <div class="content-inner">
        <h1>モデルと手法</h1>
        <p>このシミュレータは、小林亮のフェーズフィールド・デンドライトモデル${cite('K1993')} ${cite('K2002')}をブラウザ上で定性的に実装したものです。異方性、潜熱、熱拡散、界面ノイズがデンドライト成長へ与える影響を調べるためのもので、較正済みの実用材料計算ソルバーではありません。</p>
        <h2>場の変数</h2>
        <p>${mathInline('<mi>p</mi>', 'p')}はフェーズ場です。本アプリでは液相を${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>0</mn></mrow>', 'p equals zero')}、固相を${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>1</mn></mrow>', 'p equals one')}とし、${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>0.5</mn></mrow>', 'p equals zero point five')}付近を固液界面として描画します。界面を格子上の連続場で表すため、移動曲線や移動曲面を直接追跡せずに、先端分裂やサイドブランチを扱えます。</p>
        <p>${mathInline('<mi>T</mi>', 'temperature')}は温度または過冷却に関係する場です。凝固が進むと、${mathInline('<mfrac><mrow><mo>∂</mo><mi>p</mi></mrow><mrow><mo>∂</mo><mi>t</mi></mrow></mfrac>', 'partial p over partial time')}に比例する潜熱が${mathInline('<mi>T</mi>', 'temperature')}へ戻り、その温度場が後続の界面成長へフィードバックします。</p>
        <h2>定性的な支配方程式</h2>
        <div class="equation-block">
          ${phaseEquationMath()}
          ${temperatureEquationMath()}
          ${driveEquationMath()}
          <dl class="phase-state-list">
            <div><dt>${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>0</mn></mrow>', 'p equals zero')}</dt><dd>液相</dd></div>
            <div><dt>${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>1</mn></mrow>', 'p equals one')}</dt><dd>固相</dd></div>
            <div><dt>${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>0.5</mn></mrow>', 'p equals zero point five')}</dt><dd>描画する界面</dd></div>
          </dl>
        </div>
        <h2>初期条件</h2>
        <p>${mathInline('<mi>p</mi>', 'p')}の初期値は硬い二値マスクではなく、拡散界面として与えます。K2002の有限差分モデル${cite('K2002')}と同じフェーズフィールドの考え方で、固相核の内部を${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>1</mn></mrow>', 'p equals one')}付近、周囲の液相を${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>0</mn></mrow>', 'p equals zero')}付近とし、可視界面で${mathInline('<mrow><mi>p</mi><mo>=</mo><mn>0.5</mn></mrow>', 'p equals zero point five')}を横切ります。</p>
        ${initialConditionMath()}
        <p>ここで${mathInline('<mi>d</mi>', 'd')}は形状に応じた距離です。円形・球形核では中心からの距離、摂動を持つ左壁界面では符号付き距離、壁面から内向きに成長する条件では最近接壁までの距離です。${mathInline('<msub><mi>r</mi><mn>0</mn></msub>', 'r zero')}はメッシュセル単位の核半径または壁面・界面厚さ、${mathInline('<mi>w</mi>', 'w')}はメッシュセル単位の数値的な拡散界面幅です。</p>
        <p><code>r=7</code>は、初期核の半径が7セルであることを表します。物理半径は${mathInline('<mrow><mi>r</mi><mo>×</mo><mi mathvariant="normal">Δx</mi></mrow>', 'r times delta x')}なので、論文対象条件の<code>dx=0.03</code>では<code>0.21</code>モデル長です。2D底辺核は底辺ノイマン壁で切られた滑らかな半円、中央核は滑らかな円、3Dでは境界対称性を適用する前の滑らかな球です。</p>
        <p>核半径は再現のための推定パラメータです。比較計算では<code>r</code>を変えると、初期形状、下壁との隙間、後期のサイドブランチ密度が変化しました。現在のK1993デンドライト群とK2002 Fig.9右の3D推定条件は共通して<code>r=7</code>を使い、図ごとの差が独立に調整した核サイズではなく、主に<code>K</code>、異方性、ノイズ、形状から生じるようにしています。</p>
        <p>K2002 Fig.9右の3D推定条件では、この<code>r=7</code>の滑らかな球をx、y、zのノイマン面より半セル外側へ中心配置します。全領域表示とSTLではxとyだけを反転するため、表示物体は1/4領域計算のx-y対称展開です。初期温度場はプリセット値で一様にし、温度固定境界は境界上へ設定します。潜熱は初期場へ加えず、時間更新中に${mathInline('<mrow><mi>K</mi><mi>Δ</mi><mi>p</mi></mrow>', 'K delta p')}として入ります。</p>
        <h2>論文図の検証順序</h2>
        <p>検証はK1993の平面界面条件から始め、その後デンドライト条件へ進めました${cite('K1993')}。Fig.3は<code>9.0 x 9.0</code>領域、<code>300 x 300</code>メッシュで、冷却壁から内向きに成長します。Fig.4は<code>12.0 x 3.0</code>領域、<code>400 x 100</code>メッシュで、摂動を持つ左壁固相界面と左壁温度固定条件を使います。Fig.5では等方条件の<code>K=0.8</code>から<code>K=2.0</code>まで9条件を計算し、Fig.6では同じ系列に<code>delta=0.050</code>の4回対称異方性を加えます。</p>
        <p>K2002 Fig.9右の3D対象は、報告された厳密値ではなく推定プリセットです。<code>K=3.5</code>、<code>delta=0.020</code>、<code>a=0.005</code>、<code>r=7</code>、<code>dx=0.03</code>、<code>dt=0.0002</code>、<code>50 x 50 x 200</code>の1/4領域メッシュを使います。物理的な1/4領域は<code>1.5 x 1.5 x 6.0</code>で、反転表示とSTLは<code>100 x 100 x 200</code>、<code>3.0 x 3.0 x 6.0</code>に対応します。</p>
        <h2>異方性とノイズ</h2>
        <p>2Dでは${epsilon2DMath()}を使います${cite('K1993')}。異方性拡散項はK2002の半格子流束形式で離散化し、${mathInline('<msub><mi>p</mi><mrow><mi>i</mi><mo>+</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><mo>,</mo><mi>j</mi></mrow></msub>', 'p at i plus one half j')}と${mathInline('<msub><mi>q</mi><mrow><mi>i</mi><mo>,</mo><mi>j</mi><mo>+</mo><mfrac><mn>1</mn><mn>2</mn></mfrac></mrow></msub>', 'q at i j plus one half')}を作ってから発散を取ります${cite('K2002')}。${mathInline('<mrow><mi>j</mi><mo>=</mo><mn>4</mn></mrow>', 'j equals four')}、${mathInline('<mrow><msub><mi>θ</mi><mn>0</mn></msub><mo>=</mo><mn>0</mn></mrow>', 'theta zero equals zero')}では、水平・鉛直軸が優先成長方向です。</p>
        <p>K1993対象プリセットでは、得られる範囲で報告値を使います。${mathInline('<mrow><mi mathvariant="normal">Δx</mi><mo>=</mo><mn>0.03</mn></mrow>', 'delta x equals zero point zero three')}、${mathInline('<mrow><mi mathvariant="normal">Δt</mi><mo>=</mo><mn>0.0002</mn></mrow>', 'delta t equals zero point zero zero zero two')}、${mathInline('<mrow><mover><mi>ε</mi><mo>¯</mo></mover><mo>=</mo><mn>0.01</mn></mrow>', 'epsilon bar equals zero point zero one')}、${mathInline('<mrow><mi>τ</mi><mo>=</mo><mn>0.0003</mn></mrow>', 'tau equals zero point zero zero zero three')}、${mathInline('<mrow><mi>α</mi><mo>=</mo><mn>0.9</mn></mrow>', 'alpha equals zero point nine')}、${mathInline('<mrow><mi>γ</mi><mo>=</mo><mn>10.0</mn></mrow>', 'gamma equals ten')}に、図ごとの${mathInline('<mi>δ</mi>', 'delta')}、${mathInline('<mi>K</mi>', 'K')}、${mathInline('<mi>j</mi>', 'j')}、境界条件を組み合わせます${cite('K1993')}。底辺核は二値半円ではなく、滑らかなtanh形状です。2Dソルバーは${mathInline('<mi>p</mi>', 'p')}を陽的に更新し、その後${implicitTemperatureMath()}をノイマン境界ではICCG、温度固定境界ではヤコビ反復で解きます。</p>
        <p>ノイズは${mathInline('<mfrac><mrow><mo>∂</mo><mi>p</mi></mrow><mrow><mo>∂</mo><mi>t</mi></mrow></mfrac>', 'partial p over partial time')}側へ加え、界面速度のゆらぎに対応させます${cite('K1993')}。${mathInline('<mrow><mi>p</mi><mo stretchy="false">(</mo><mn>1</mn><mo>-</mo><mi>p</mi><mo stretchy="false">)</mo></mrow>', 'p times one minus p')}で局在させるため、バルク液相・固相ではなく拡散界面付近に作用します。Fig.7では論文既定の独立ノイズ振幅${mathInline('<mrow><mi>a</mi><mo>=</mo><mn>0.010</mn></mrow>', 'a equals zero point zero one zero')}、Fig.10では${mathInline('<mrow><mi>a</mi><mo>=</mo><mn>0</mn></mrow>', 'a equals zero')}、${mathInline('<mrow><mi>a</mi><mo>=</mo><mn>0.001</mn></mrow>', 'a equals zero point zero zero one')}、${mathInline('<mrow><mi>a</mi><mo>=</mo><mn>0.010</mn></mrow>', 'a equals zero point zero one zero')}を比較します。</p>
        <h2>WebGPU / GPGPU経路</h2>
        <p>WebGPUが利用できる環境では、ラボの2D・3Dとも実験的WebGPUバックエンドを既定にします。WebGPUはGPGPUステンシル計算として使い、compute shaderの1 invocationが前ステップの${mathInline('<mi>p</mi>', 'p')}と${mathInline('<mi>T</mi>', 'temperature')}の局所近傍を読み、1格子点を次バッファへ書きます。その後バッファを交換します。同じ局所更新を多数の格子点で並列実行できるためGPUに適しています。</p>
        <p>CPUの再現用ソルバーは${mathInline('<mi>p</mi>', 'p')}を陽的に進め、${mathInline('<mi>T</mi>', 'temperature')}の拡散を陰的に解きます。陰解法は大きな<code>dt</code>を使えますが、ICCGまたはヤコビ法による連立一次方程式の反復と同期が必要です。WebGPUでは温度も陽的に更新するため小さな<code>dt</code>が必要ですが、各ステップを大規模並列に計算できます。</p>
        <p>WebGPU選択時は、温度陽解法の安定性推定に合わせて<code>dt</code>を下げ、表示上のモデル時間を確保するため<code>steps/frame</code>を増やします。温度陽解法には拡散項と潜熱項<code>K Δp</code>が含まれるため、大きな<code>K</code>ではより小さな<code>dt</code>が必要です。</p>
        <p>独立な界面ノイズはソルバーステップごとに生成します。compute shaderへ渡す前に${mathInline('<mrow><msub><mi>a</mi><mtext>eff</mtext></msub><mo>=</mo><mi>a</mi><msqrt><mfrac><msub><mi mathvariant="normal">Δt</mi><mtext>ref</mtext></msub><mi mathvariant="normal">Δt</mi></mfrac></msqrt></mrow>', 'effective a equals a times the square root of reference delta t divided by delta t')}で振幅を調整し、<code>dt</code>を変えてもモデル時間あたりのノイズ分散尺度を保ちます。したがって<code>dt: 2e-4 → 5e-5</code>では<code>2a</code>を渡し、<code>a=0</code>は0のままです。この処理は2D・3D WebGPUの両方に適用され、<code>steps/frame</code>とは独立です。WebGPUは対話的探索用であり、論文対象の再現主張や公開サンプル画像には使いません。</p>
        <h2>境界条件</h2>
        <p>${mathInline('<mi>p</mi>', 'p')}には、K1993の流束0条件に従って常にノイマン境界を使います。${mathInline('<mi>T</mi>', 'temperature')}はプリセットに応じて、断熱・流束なし、境界温度固定、左壁温度固定を選びます。Fig.7、Fig.8、Fig.9、Fig.10の論文対象プリセットは、過冷却融液の断熱境界条件です。</p>
        ${threeDModelNotes()}
        <h2>安定性の限界</h2>
        <p>CPU経路の温度拡散は陰解法ですが、フェーズ方程式は陽的な有限差分更新です。大きな${mathInline('<mrow><mi mathvariant="normal">Δt</mi></mrow>', 'time step')}、強い異方性、大きなノイズ、高解像度3D格子では不安定になる場合があります。本アプリは数値不安定性を描画平滑化で隠しません。不安定になった場合は該当パラメータを下げてください。</p>
      </div>
    </article>
  `;
}

function referencesTemplate(): string {
  return `
    <article class="content-page">
      <div class="content-inner">
        <h1>${t('references')}</h1>
        <p>${ui(
          'Model explanations and reproduction presets cite the sources below by stable reference key. This app uses bibliographic/source metadata and simulator-generated outputs rather than reproduced paper figures.',
          'モデルの説明と再現プリセットでは、以下の安定した文献キーを使って参照します。本アプリに掲載するのは書誌・出典情報とシミュレータ生成結果であり、論文図の転載ではありません。'
        )}</p>
        ${referenceList('reference')}
      </div>
    </article>
  `;
}

function referenceCopy(reference: ModelReference): string {
  const copy = `
    <div class="reference-title">${reference.authors}</div>
    <div class="reference-meta">${reference.meta}</div>
  `;
  if (!reference.url) {
    return `<div class="reference-copy">${copy}</div>`;
  }
  return `<a class="reference-copy reference-link" href="${escapeHtml(reference.url)}" target="_blank" rel="noreferrer">${copy}</a>`;
}

function referenceList(idPrefix: string): string {
  return `
    <div class="reference-list">
      ${modelReferences
        .map(
          (reference) => `
            <div class="reference-item" id="${idPrefix}-${reference.key.toLowerCase()}">
              <div class="reference-index">${reference.key}</div>
              ${referenceCopy(reference)}
            </div>
          `
        )
        .join('')}
    </div>
  `;
}

function bindNumber(root: HTMLElement, field: string, onChange: (value: number) => void): void {
  root.querySelector<HTMLInputElement>(`[data-field="${field}"]`)?.addEventListener('change', (event) => {
    onChange(Number((event.currentTarget as HTMLInputElement).value));
  });
}

function bindRange(root: HTMLElement, field: string, onInput: (value: number) => void): void {
  root.querySelector<HTMLInputElement>(`[data-field="${field}"]`)?.addEventListener('input', (event) => {
    onInput(Number((event.currentTarget as HTMLInputElement).value));
  });
}

function bindSelect(root: HTMLElement, field: string, onChange: (value: string) => void): void {
  root.querySelector<HTMLSelectElement>(`[data-field="${field}"]`)?.addEventListener('change', (event) => {
    onChange((event.currentTarget as HTMLSelectElement).value);
  });
}

function bindCheckbox(root: HTMLElement, field: string, onChange: (checked: boolean) => void): void {
  root.querySelector<HTMLInputElement>(`[data-field="${field}"]`)?.addEventListener('change', (event) => {
    onChange((event.currentTarget as HTMLInputElement).checked);
  });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
