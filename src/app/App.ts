import { SceneRenderer } from '../render/scene';
import { PhaseField2D } from '../simulation/phaseField2D';
import { PhaseField3D } from '../simulation/phaseField3D';
import { clonePreset, labPresets, presets } from '../simulation/presets';
import { createStateExportBlob, parseStateExportArrayBuffer } from '../simulation/stateExport';
import { createIsosurfaceStlBlob } from '../simulation/stlExport';
import type { BoundaryCondition, Dimension, PhaseFieldConfig, RenderMode3D, SimulationSnapshot, ViewMode } from '../simulation/types';

type Solver = PhaseField2D | PhaseField3D;
type Page = 'lab' | 'reproduction' | 'model' | 'references';

const APP_LINKS = {
  github: 'https://github.com/dueyama/kobayashi-phase-field-lab',
  liveSite: 'https://kobayashi-phase-field-lab.vercel.app'
};

export class PhaseFieldApp {
  private config: PhaseFieldConfig = clonePreset('paper-fig8-k200-sixfold');
  private solver: Solver = new PhaseField2D(this.config);
  private renderer: SceneRenderer | null = null;
  private running = false;
  private page: Page = 'lab';
  private lastFrame = performance.now();
  private fps = 0;
  private unstable = false;
  private viewRoot: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
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
    this.showLab();
    window.addEventListener('resize', () => this.renderer?.resize());
    requestAnimationFrame((time) => this.tick(time));
  }

  private tick(time: number): void {
    const delta = Math.max(1, time - this.lastFrame);
    this.fps = this.fps * 0.88 + (1000 / delta) * 0.12;
    this.lastFrame = time;

    if (this.page === 'lab') {
      if (this.running && !this.unstable) {
        const stats = this.solver.step(this.config.stepsPerFrame);
        this.unstable = stats.unstable;
      }
      const snapshot = this.solver.snapshot();
      this.renderer?.render(snapshot, this.config);
      this.updateTelemetry(snapshot);
    }
    requestAnimationFrame((next) => this.tick(next));
  }

  private bindTopNav(): void {
    this.root.querySelectorAll<HTMLButtonElement>('.nav-tab').forEach((button) => {
      button.addEventListener('click', () => {
        const next = button.dataset.page as Page;
        this.setPage(next);
      });
    });
  }

  private setPage(page: Page): void {
    if (page === this.page) return;
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
    this.viewRoot.innerHTML = labTemplate(this.config, this.running);
    const viewport = this.viewRoot.querySelector<HTMLElement>('[data-viewport]');
    if (!viewport) throw new Error('Missing viewport host.');
    this.renderer = new SceneRenderer(viewport);
    this.resizeObserver = new ResizeObserver(() => this.renderer?.resize());
    this.resizeObserver.observe(viewport);
    this.bindLabControls();
    this.renderer.render(this.solver.snapshot(), this.config, true);
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
        if (presetId) this.openPresetInLab(presetId);
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

  private openPresetInLab(presetId: string): void {
    if (!presets.some((preset) => preset.id === presetId)) return;
    this.config = clonePreset(presetId);
    this.running = false;
    this.recreateSolver(true);
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
    title.textContent = 'Loading final state';
    status.textContent = 'Fetching public .pfstate field data...';
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

      title.textContent = preset?.name ?? 'Final state viewer';
      status.textContent = this.reproductionStateStatus(parsed.snapshot, viewerConfig);
      viewer.scrollIntoView({ block: 'nearest' });
    } catch (error: unknown) {
      title.textContent = 'Final state failed to load';
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
    return `${meshLabel(config)} mesh${mirrorNote}, t=${snapshot.time.toFixed(3)}, step=${snapshot.step.toLocaleString()}, ${mode}. Drag to rotate; scroll or pinch to zoom.`;
  }

  private bindLabControls(): void {
    const root = this.viewRoot;
    if (!root) return;

    root.querySelector<HTMLSelectElement>('[data-field="preset"]')?.addEventListener('change', (event) => {
      const id = (event.currentTarget as HTMLSelectElement).value;
      this.config = clonePreset(id);
      this.recreateSolver(true);
      this.showLab();
    });

    root.querySelectorAll<HTMLButtonElement>('[data-dimension]').forEach((button) => {
      button.addEventListener('click', () => {
        const dimension = button.dataset.dimension as Dimension;
        const preset = labPresets.find((item) => item.dimension === dimension) ?? labPresets[0] ?? presets[0];
        this.config = clonePreset(preset.id);
        this.recreateSolver(true);
        this.showLab();
      });
    });

    root.querySelector<HTMLButtonElement>('[data-action="run"]')?.addEventListener('click', () => {
      this.running = !this.running;
      this.showLab();
    });
    root.querySelector<HTMLButtonElement>('[data-action="step"]')?.addEventListener('click', () => {
      this.solver.step(1);
      this.renderer?.render(this.solver.snapshot(), this.config, true);
    });
    root.querySelector<HTMLButtonElement>('[data-action="reset"]')?.addEventListener('click', () => {
      this.recreateSolver(true);
      this.renderer?.render(this.solver.snapshot(), this.config, true);
      this.updateTelemetry(this.solver.snapshot());
    });
    root.querySelector<HTMLButtonElement>('[data-action="random-seed"]')?.addEventListener('click', () => {
      this.config.seed = Math.floor(1 + Math.random() * 999999);
      this.recreateSolver(true);
      this.showLab();
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

    bindNumber(root, 'stepsPerFrame', (value) => {
      this.config.stepsPerFrame = Math.max(1, Math.round(value));
    });
    bindNumber(root, 'seed', (value) => {
      this.config.seed = Math.max(1, Math.round(value));
      this.recreateSolver(true);
    });
    bindSelect(root, 'viewMode', (value) => {
      this.config.viewMode = value as ViewMode;
      this.renderer?.render(this.solver.snapshot(), this.config, true);
    });
    bindSelect(root, 'renderMode3D', (value) => {
      this.config.renderMode3D = value as RenderMode3D;
      this.renderer?.render(this.solver.snapshot(), this.config, true);
    });
    bindSelect(root, 'boundaryCondition', (value) => {
      this.config.boundaryCondition = value as BoundaryCondition;
    });
    bindRange(root, 'anisotropyStrength', (value) => {
      this.config.anisotropyStrength = value;
      this.syncRangeLabel('anisotropyStrength', value.toFixed(3));
    });
    bindRange(root, 'latentHeat', (value) => {
      this.config.latentHeat = value;
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
      this.recreateSolver(true);
      this.showLab();
    });
  }

  private recreateSolver(resetUnstable: boolean): void {
    this.solver = this.config.dimension === '2d' ? new PhaseField2D(this.config) : new PhaseField3D(this.config);
    if (resetUnstable) this.unstable = false;
  }

  private updateTelemetry(snapshot: SimulationSnapshot): void {
    const set = (key: string, value: string) => {
      const node = this.viewRoot?.querySelector<HTMLElement>(`[data-telemetry="${key}"]`);
      if (node) node.textContent = value;
    };
    set('step', snapshot.step.toLocaleString());
    set('time', snapshot.time.toFixed(2));
    set('fps', this.fps.toFixed(0));
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
    const warning = this.viewRoot?.querySelector<HTMLElement>('[data-warning]');
    warning?.classList.toggle('visible', this.unstable);
  }

  private syncRangeLabel(field: string, value: string): void {
    const node = this.viewRoot?.querySelector<HTMLElement>(`[data-value="${field}"]`);
    if (node) node.textContent = value;
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
  return `
    <main class="app-shell">
      <header class="topbar">
        <div class="brand">
          <img class="brand-mark" src="/icon-192.png" alt="" aria-hidden="true" />
          <div class="brand-title">Kobayashi Phase-Field Dendrite Lab</div>
        </div>
        <nav class="nav-tabs" aria-label="Primary">
          ${navButton('lab', 'Lab', page)}
          ${navButton('reproduction', 'Reproductions', page)}
          ${navButton('model', 'Model & Method', page)}
          ${navButton('references', 'References', page)}
        </nav>
        <div class="top-actions">
          ${githubLinkTemplate()}
          <div class="top-status"><span class="status-dot"></span><span>Qualitative browser solver</span></div>
        </div>
      </header>
      <section class="view-root" data-view-root></section>
      <footer class="site-footer">
        <span>&copy; 2026 dueyama. Released under the MIT License.</span>
        ${footerLinksTemplate()}
      </footer>
    </main>
  `;
}

function githubLinkTemplate(): string {
  const icon = githubIconSvg();
  if (!APP_LINKS.github) {
    return `<span class="top-icon-link is-disabled" aria-label="GitHub repository URL pending" title="GitHub repository URL pending">${icon}</span>`;
  }
  return `<a class="top-icon-link" href="${APP_LINKS.github}" target="_blank" rel="noreferrer" aria-label="GitHub repository">${icon}</a>`;
}

function githubIconSvg(): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.18-3.37-1.18-.45-1.15-1.1-1.46-1.1-1.46-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.02c.85 0 1.7.11 2.5.34 1.9-1.29 2.74-1.02 2.74-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86v2.76c0 .26.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>`;
}

function footerLinksTemplate(): string {
  const links = [
    APP_LINKS.liveSite ? `<a href="${APP_LINKS.liveSite}" target="_blank" rel="noreferrer">Live site</a>` : ''
  ].filter(Boolean);
  return links.length > 0 ? `<nav class="site-footer-links" aria-label="Project links">${links.join('')}</nav>` : '';
}

function navButton(page: Page, label: string, active: Page): string {
  return `<button class="nav-tab" data-page="${page}" aria-selected="${page === active}">${label}</button>`;
}

function labTemplate(config: PhaseFieldConfig, running: boolean): string {
  const baseGridOptions = config.dimension === '2d' ? [96, 128, 160, 192, 256, 300] : [36, 48, 64, 80, 100, 128];
  const gridOptions = [...new Set([...baseGridOptions, config.nx])].sort((a, b) => a - b);
  const hasReproducedFigure = Boolean(reproductionThumbnail(config.id));
  const latentHeatMax = Math.max(2.2, Math.ceil(config.latentHeat * 10) / 10);
  return `
    <div class="lab-layout">
      <section class="visual-stage ${hasReproducedFigure ? 'has-comparison' : ''}" aria-label="Simulation view">
        <div class="viewport-stack ${hasReproducedFigure ? 'with-comparison' : ''}">
          <div class="viewport-panel" data-viewport>
            <div class="viewport-overlay"></div>
          </div>
          ${comparisonPanel(config)}
        </div>
        <div class="telemetry">
          ${telemetryItem('Step', 'step')}
          ${telemetryItem('Time', 'time')}
          ${telemetryItem('FPS', 'fps')}
          ${telemetryItem('Mesh', 'grid')}
          ${telemetryItem('p min / max', 'phi')}
          ${telemetryItem('T min / max', 'temp')}
        </div>
      </section>
      <aside class="inspector" aria-label="Simulation controls">
        <div class="inspector-inner">
          <section class="control-section">
            <div class="section-title"><span>Experiment</span><span>${config.dimension.toUpperCase()}</span></div>
            <div class="section-body">
              <div class="control-row">
                <label class="control-label" for="preset">Preset</label>
                <select id="preset" data-field="preset">
                  ${labPresets.map((preset) => `<option value="${preset.id}" ${preset.id === config.id ? 'selected' : ''}>${preset.name}</option>`).join('')}
                </select>
              </div>
              ${presetNote(config)}
              <div class="segmented" aria-label="Dimension">
                <button data-dimension="2d" class="${config.dimension === '2d' ? 'active' : ''}">2D</button>
                <button data-dimension="3d" class="${config.dimension === '3d' ? 'active' : ''}">3D</button>
              </div>
              <div class="action-row">
                <button class="primary" data-action="run">${running ? 'Pause' : 'Run'}</button>
                <button data-action="reset">Reset</button>
              </div>
              <div class="action-row">
                <button data-action="step">Step</button>
                <button data-action="random-seed">New seed</button>
              </div>
              <div class="warning" data-warning>Numerical instability detected. Reduce dt, noise, anisotropy strength, or mesh size.</div>
            </div>
          </section>

          <section class="control-section">
            <div class="section-title"><span>Numerics</span><span>Explicit p / implicit T</span></div>
            <div class="section-body">
              ${numberControl('Steps / frame', 'stepsPerFrame', config.stepsPerFrame, 1, 24)}
              ${gridSizeControl(config.dimension, gridOptions, config.nx, config.ny, config.nz)}
              <div class="control-row">
                <label class="control-label" for="boundaryCondition">Boundary</label>
                <select id="boundaryCondition" data-field="boundaryCondition">
                  ${option('neumann', 'Adiabatic / no-flux', config.boundaryCondition)}
                  ${option('fixed-temperature', 'Fixed temperature edge', config.boundaryCondition)}
                  ${option('left-fixed-temperature', 'Left wall fixed T', config.boundaryCondition)}
                </select>
              </div>
              ${rangeControl('dt', 'dt', config.dt, 0.0001, 0.08, 0.0001, formatDt(config.dt))}
              ${numberControl('Seed', 'seed', config.seed, 1, 999999)}
            </div>
          </section>

          <section class="control-section">
            <div class="section-title"><span>Physics</span><span>${config.anisotropyMode}</span></div>
            <div class="section-body">
              ${rangeControl('Anisotropy', 'anisotropyStrength', config.anisotropyStrength, 0, 0.22, 0.001, config.anisotropyStrength.toFixed(3))}
              ${rangeControl('Latent heat', 'latentHeat', config.latentHeat, 0, latentHeatMax, 0.01, config.latentHeat.toFixed(2))}
              ${rangeControl('Equilibrium T', 'undercooling', config.undercooling, 0.05, 1.2, 0.01, config.undercooling.toFixed(2))}
              ${rangeControl('Noise', 'noiseAmplitude', config.noiseAmplitude, 0, 0.06, 0.001, config.noiseAmplitude.toFixed(3))}
            </div>
          </section>

          <section class="control-section">
            <div class="section-title"><span>View</span><span>${renderModeLabel(config.renderMode3D)}</span></div>
            <div class="section-body">
              <div class="control-row">
                <label class="control-label" for="viewMode">Scalar view</label>
                <select id="viewMode" data-field="viewMode">
                  ${option('phase', 'Phase', config.viewMode)}
                  ${option('temperature', 'Temperature', config.viewMode)}
                  ${option('combined', 'Combined', config.viewMode)}
                </select>
              </div>
              <div class="control-row">
                <label class="control-label" for="renderMode3D">3D render mode</label>
                <select id="renderMode3D" data-field="renderMode3D" ${config.dimension === '2d' ? 'disabled' : ''}>
                  ${option('surface', 'Isosurface', config.renderMode3D)}
                  ${option('slices', 'Slices', config.renderMode3D)}
                  ${option('volume', 'Volume', config.renderMode3D)}
                </select>
              </div>
              <div class="action-row">
                <button data-action="stl" ${config.dimension === '2d' ? 'disabled' : ''}>STL surface</button>
                <button data-action="stl-mirror" ${config.dimension === '2d' ? 'disabled' : ''}>STL x-y mirror</button>
              </div>
              <div class="action-row">
                <button data-action="screenshot">Screenshot</button>
                <button data-action="save-state">State file</button>
              </div>
              <div class="action-row single">
                <button data-action="export">Params JSON</button>
              </div>
            </div>
          </section>
        </div>
      </aside>
    </div>
  `;
}

function presetNote(config: PhaseFieldConfig): string {
  const paperDetails = config.paperReference?.details ?? [];
  const geometryDetails = [
    `Mesh: ${meshLabel(config)}`,
    `Domain: ${domainSizeLabel(config)}`,
    `dx = ${compactNumber(config.dx)}, dt = ${compactNumber(config.dt)}`,
    `Initial size: ${nucleusSizeLabel(config)}`
  ];
  return `
    <div class="preset-note">
      ${config.description ? `<p>${renderPresetDetail(config.description)}</p>` : ''}
      <div class="preset-paper-label">Simulation geometry</div>
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
        <span>Reproduced figure</span>
        <span>simulation final state</span>
      </div>
      <div class="comparison-image-box">
        <img src="${thumbnail.src}" alt="${config.paperReference?.label ?? config.name} reproduced final state" />
      </div>
      <p class="comparison-caption">Generated by this simulator from the selected preset parameters.</p>
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
      <label class="control-label" for="gridSize">Mesh size</label>
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
  return value < 0.001 ? value.toFixed(4) : value.toFixed(3);
}

function option<T extends string>(value: T, label: string, current: T): string {
  return `<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`;
}

function renderModeLabel(mode: RenderMode3D): string {
  if (mode === 'surface') return 'Isosurface';
  return mode;
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
      'paper-fig3-inward-walls': { src: '/reproductions/fig3_k100_step_48000.png', label: 'simulation final state' },
      'paper-fig4-planar-k100': {
        src: '/reproductions/fig4_k100_step_10000.png',
        label: 'simulation final state'
      }
      ,
      'paper-fig5-k080-planar': { src: '/reproductions/fig5_k080_step_03500.png', label: 'simulation final state' },
      'paper-fig5-k090-slight': { src: '/reproductions/fig5_k090_step_03500.png', label: 'simulation final state' },
      'paper-fig5-k100-cellular': { src: '/reproductions/fig5_k100_step_03500.png', label: 'simulation final state' },
      'paper-fig5-k110-cellular-slits': { src: '/reproductions/fig5_k110_step_03500.png', label: 'simulation final state' },
      'paper-fig5-k120-splitting': { src: '/reproductions/fig5_k120_step_03500.png', label: 'simulation final state' },
      'paper-fig5-k140-splitting': { src: '/reproductions/fig5_k140_step_03500.png', label: 'simulation final state' },
      'paper-fig5-k160-competition': { src: '/reproductions/fig5_k160_step_05000.png', label: 'simulation final state' },
      'paper-fig5-k180-spreading': { src: '/reproductions/fig5_k180_step_10000.png', label: 'simulation final state' },
      'paper-fig5-k200-slow': { src: '/reproductions/fig5_k200_step_14000.png', label: 'simulation final state' },
      'paper-fig6-k080-anisotropic': { src: '/reproductions/fig6_k080_step_03500.png', label: 'simulation final state' },
      'paper-fig6-k090-anisotropic': { src: '/reproductions/fig6_k090_step_03500.png', label: 'simulation final state' },
      'paper-fig6-k100-anisotropic': { src: '/reproductions/fig6_k100_step_03500.png', label: 'simulation final state' },
      'paper-fig6-k110-anisotropic': { src: '/reproductions/fig6_k110_step_03500.png', label: 'simulation final state' },
      'paper-fig6-k120-anisotropic': { src: '/reproductions/fig6_k120_step_03500.png', label: 'simulation final state' },
      'paper-fig6-k140-anisotropic': { src: '/reproductions/fig6_k140_step_03500.png', label: 'simulation final state' },
      'paper-fig6-k160-anisotropic': { src: '/reproductions/fig6_k160_step_05000.png', label: 'simulation final state' },
      'paper-fig6-k180-anisotropic': { src: '/reproductions/fig6_k180_step_05000.png', label: 'simulation final state' },
      'paper-fig6-k200-anisotropic': { src: '/reproductions/fig6_k200_step_05000.png', label: 'simulation final state' },
      'paper-fig7-delta000': { src: '/reproductions/fig7_delta000_step_07000.png', label: 'simulation final state' },
      'paper-fig7-delta005': { src: '/reproductions/fig7_delta005_step_07000.png', label: 'simulation final state' },
      'paper-fig7-delta010': { src: '/reproductions/fig7_delta010_step_07000.png', label: 'simulation final state' },
      'paper-fig7-delta020': { src: '/reproductions/fig7_delta020_step_07000.png', label: 'simulation final state' },
      'paper-fig7-delta050': { src: '/reproductions/fig7_delta050_step_07000.png', label: 'simulation final state' },
      'paper-fig8-k080-sixfold': { src: '/reproductions/fig8_k080_step_01000.png', label: 'simulation final state' },
      'paper-fig8-k100-sixfold': { src: '/reproductions/fig8_k100_step_01250.png', label: 'simulation final state' },
      'paper-fig8-k120-sixfold': { src: '/reproductions/fig8_k120_step_01400.png', label: 'simulation final state' },
      'paper-fig8-k160-sixfold': { src: '/reproductions/fig8_k160_step_01800.png', label: 'simulation final state' },
      'paper-fig8-k200-sixfold': { src: '/reproductions/fig8_k200_step_02400.png', label: 'simulation final state' },
      'paper-fig9-noise010': { src: '/reproductions/fig9_noise010_step_05000.png', label: 'simulation final state' },
      'paper-fig9-noise001': { src: '/reproductions/fig9_noise001_step_05000.png', label: 'simulation final state' },
      'paper-fig9-no-noise': { src: '/reproductions/fig9_noise000_step_05000.png', label: 'simulation final state' },
      'paper-fig10-noise010': { src: '/reproductions/fig10_noise010_step_06500.png', label: 'simulation final state' },
      'paper-fig10-noise001': { src: '/reproductions/fig10_noise001_step_06500.png', label: 'simulation final state' },
      'paper-fig10-no-noise': { src: '/reproductions/fig10_noise000_step_06500.png', label: 'simulation final state' },
      'paper-fig9-3d-left-target': {
        src: '/reproductions/k2002_fig9_left_ts_webgl_gold_160x160x100_k2p5_t04_poster.png',
        label: 'simulator-generated animation poster'
      },
      'paper-fig9-3d-right-target': {
        src: '/reproductions/k2002_fig9_right_ts_webgl_gold_50x50x200_k3p5_t09_poster.png',
        label: 'simulator-generated animation poster'
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
        <h1>Reproductions</h1>
        <p>This page collects simulator-generated outputs for the Kobayashi references. It does not distribute paper figures. K1993 entries are reproduced final-state thumbnails from the browser solver; K2002 entries use public WebGL animations, final-state viewers, and STL isosurfaces generated from the listed presets.</p>
        <p class="reproduction-note">All media on this page is simulator-generated. The comparison is qualitative; exact reproduction is not claimed.</p>
        <nav class="reproduction-section-nav" aria-label="Reproduction sections">
          <a href="#k1993-reproductions">K1993</a>
          <a href="#k2002-reproductions">K2002</a>
        </nav>
        <section class="reproduction-family" id="k2002-reproductions">
          <div class="reproduction-family-header">
            <h2>K2002 3D Reproduction</h2>
            <p>Public animation and final-state assets generated by this simulator. The exact 3D numerical conditions were not available, so these parameters are estimates selected by qualitative comparison with the K2002 figure. Select the Lab action to load the same preset parameters for an interactive rerun.</p>
          </div>
          <div class="k2002-media-grid">
            ${k2002ReproductionAssets.map(k2002AssetCardTemplate).join('')}
          </div>
          <div class="k2002-state-viewer" data-k2002-state-viewer hidden>
            <div class="k2002-state-header">
              <div>
                <div class="reproduction-figure">Interactive final state</div>
                <h3 data-k2002-state-title>Final state viewer</h3>
              </div>
              <p data-k2002-state-status>Select View final state on a K2002 card.</p>
            </div>
            <div class="k2002-state-toolbar" aria-label="Final state render mode">
              <button type="button" data-k2002-render-mode="surface" aria-selected="true">Isosurface</button>
              <button type="button" data-k2002-render-mode="slices" aria-selected="false">Slices</button>
              <button type="button" data-k2002-render-mode="volume" aria-selected="false">Volume</button>
            </div>
            <div class="k2002-state-host" data-k2002-state-host></div>
          </div>
        </section>
        <section class="reproduction-family" id="k1993-reproductions">
          <div class="reproduction-family-header">
            <h2>K1993 2D Reproduction</h2>
            <p>Paper-target planar, cellular, dendrite, anisotropy, and noise-sensitivity presets. Select a card to open the same parameter set in Lab.</p>
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
        <h3>${asset.title}</h3>
        <p>${asset.subtitle}</p>
        <dl class="reproduction-params">
          ${rows
            .filter((row) => ['mesh', 'domain', 'dx / dt', 'K / tau', 'anisotropy', 'noise', 'nucleus'].includes(row.label))
            .map((row) => `<div><dt>${row.label}</dt><dd>${row.value}</dd></div>`)
            .join('')}
        </dl>
        <ul class="k2002-asset-notes">
          ${asset.notes.map((note) => `<li>${note}</li>`).join('')}
        </ul>
        <div class="k2002-asset-actions">
          <button type="button" data-reproduction-state="${asset.state}" data-reproduction-state-preset="${asset.presetId}">View final state</button>
          <button type="button" data-reproduction-preset="${asset.presetId}">Open in Lab</button>
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
        <h2>${group.title}</h2>
        <p>${group.description}</p>
      </div>
      <div class="reproduction-card-grid">
        ${cards}
      </div>
    </section>
  `;
}

function reproductionCardTemplate(config: PhaseFieldConfig): string {
  const thumbnail = reproductionThumbnail(config.id);
  const figureLabel = shortFigureLabel(config.paperReference?.label ?? config.name);
  const displayTitle = reproductionDisplayTitle(config);
  return `
    <button type="button" class="reproduction-card" data-reproduction-preset="${config.id}" aria-label="Open ${config.name} in Lab">
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
        <div class="reproduction-thumb-frame">
          ${
            thumbnail
              ? `<img src="${thumbnail.src}" alt="${figureLabel} simulator reproduction preview" />`
              : '<div class="reproduction-thumb-placeholder">Preview<br />pending</div>'
          }
        </div>
        <div class="reproduction-thumb-label">${thumbnail?.label ?? 'run in Lab'}</div>
      </div>
    </button>
  `;
}

function shortFigureLabel(label: string): string {
  const match = label.match(/Fig\.\d+(?:\(\d+\))?/);
  return match?.[0] ?? label.replace(/^K(?:obayashi)?\s*1993\s*/i, '').trim();
}

function reproductionDisplayTitle(config: PhaseFieldConfig): string {
  return config.name
    .replace(/^K1993\s+Fig\.\d+(?:\(\d+\))?\s*/i, '')
    .replace(/^Kobayashi\s+1993\s+Fig\.\d+(?:\(\d+\))?\s*/i, '')
    .trim();
}

function reproductionParameterRows(config: PhaseFieldConfig): Array<{ label: string; value: string }> {
  const rows = [
    { label: 'mesh', value: meshLabel(config) },
    { label: 'domain', value: domainSizeLabel(config) },
    { label: 'dx / dt', value: `${compactNumber(config.dx)} / ${compactNumber(config.dt)}` },
    { label: 'K', value: compactNumber(config.latentHeat) },
    { label: 'anisotropy', value: anisotropyLabel(config) },
    { label: 'noise', value: `a=${compactNumber(config.noiseAmplitude)}, seed=${config.seed}` },
    { label: 'boundary', value: `${boundaryLabel(config.boundaryCondition)}, ${placementLabel(config)} ${nucleusSizeLabel(config)}` }
  ];

  if (config.nucleusPlacement === 'left-wall' && config.frontPerturbationAmplitude > 0) {
    rows.push({
      label: 'initial front',
      value: `${config.frontPerturbationModeCount} cosine modes, phase=${angleLabel(config.frontPerturbationPhase)}`
    });
  }

  return rows;
}

function reproductionThumbnail(presetId: string): ReproductionThumbnail | undefined {
  return reproductionThumbnails[presetId];
}

function threeDModelNotes(): string {
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
            <h2>Browser Limits</h2>
            <p>3D stepping is CPU-bound and memory-sensitive in the browser. On the Apple M1 Max development machine, TypeScript/WebGL animation runs took about 44 minutes for the K2002 Fig.9-left <code>160 x 160 x 100</code>, 2000-step case and about 48 minutes for the K2002 Fig.9-right <code>50 x 50 x 200</code>, 4500-step case. A separate TypeScript solver probe measured about <code>1.04 s/step</code> for a <code>100 x 100 x 300</code> right-type target, roughly 1.2 hours for 4000 steps before rendering overhead. Treat these as Apple Silicon M1-class reference timings, not a dedicated Safari benchmark.</p>
          </div>
        </section>

        <p class="reproduction-note">Use Reproductions for K2002 final states and Lab for live parameter changes. This tab is intentionally explanatory so the public app does not mix documented solver behavior with provisional preset experiments.</p>
  `;
}

function threeDPresetRows(config: PhaseFieldConfig): Array<{ label: string; value: string }> {
  return [
    { label: 'mesh', value: meshLabel(config) },
    { label: 'domain', value: domainSizeLabel(config) },
    { label: 'dx / dt', value: `${compactNumber(config.dx)} / ${compactNumber(config.dt)}` },
    { label: 'solver', value: `${config.temperatureSolver ?? 'iccg'} T, explicit p` },
    { label: 'K / tau', value: `${compactNumber(config.latentHeat)} / ${compactNumber(config.tau)}` },
    { label: 'anisotropy', value: anisotropyLabel(config) },
    { label: 'noise', value: `a=${compactNumber(config.noiseAmplitude)}, seed=${config.seed}` },
    { label: 'nucleus', value: `${placementLabel(config)} ${nucleusSizeLabel(config)}` },
    { label: 'render', value: renderModeLabel(config.renderMode3D) }
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
    return `quarter ${quarterDomain}; mirrored ${compactNumber(2 * x)} x ${compactNumber(2 * y)} x ${compactNumber(z)}`;
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
      ? 'front thickness'
      : config.nucleusPlacement === 'walls'
        ? 'wall thickness'
        : 'r';
  return `${label}=${compactNumber(config.nucleusRadius)} cells (${compactNumber(physicalRadius)} units)`;
}

function anisotropyLabel(config: PhaseFieldConfig): string {
  if (config.anisotropyMode === 'isotropic' || config.anisotropyStrength === 0) return 'isotropic';
  return `delta=${compactNumber(config.anisotropyStrength)}, j=${config.anisotropyFold}, theta0=${angleLabel(config.anisotropyAngle)}`;
}

function boundaryLabel(boundary: BoundaryCondition): string {
  if (boundary === 'neumann') return 'no-flux';
  if (boundary === 'left-fixed-temperature') return 'left fixed T';
  return 'fixed T edge';
}

function placementLabel(config: PhaseFieldConfig): string {
  if (config.nucleusPlacement === 'left-wall') return 'left front';
  if (config.nucleusPlacement === 'bottom-edge') return 'bottom seed';
  if (config.nucleusPlacement === 'walls') return 'wall seed';
  if (config.nucleusPlacement === 'bottom-corner-halfcell') return 'corner half-cell seed';
  if (config.nucleusPlacement === 'bottom-face-center-halfcell') return 'bottom-face center half-cell seed';
  if (config.nucleusPlacement === 'bottom-corner') return 'corner seed';
  return 'center seed';
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

const modelReferences = [
  {
    key: 'K1993',
    authors: 'Ryo Kobayashi',
    meta: '“Modeling and numerical simulations of dendritic crystal growth,” Physica D: Nonlinear Phenomena 63(3-4), 410-423, 1993. DOI: 10.1016/0167-2789(93)90120-P.',
    url: 'https://doi.org/10.1016/0167-2789(93)90120-P'
  },
  {
    key: 'K2002',
    authors: '小林亮',
    meta: '“フェーズフィールドモデル入門 / Introduction to Phase Field Model,” 2002. Public source lookup link; local copy is not distributed.',
    url: 'https://www.google.com/search?q=%E5%B0%8F%E6%9E%97%E4%BA%AE+%E3%83%95%E3%82%A7%E3%83%BC%E3%82%BA%E3%83%95%E3%82%A3%E3%83%BC%E3%83%AB%E3%83%89%E3%83%A2%E3%83%87%E3%83%AB%E5%85%A5%E9%96%80+2002'
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
  },
  {
    key: 'N2002',
    authors: 'K. Nishitani',
    meta: '“Phase Field法,” lecture notes, 2002. Public source lookup link; local copy is not distributed.',
    url: 'https://www.google.com/search?q=K.+Nishitani+Phase+Field%E6%B3%95+2002'
  }
];

function cite(referenceKey: string): string {
  const reference = modelReferences.find((candidate) => candidate.key === referenceKey);
  if (!reference) return `<span class="citation">${referenceKey}</span>`;
  return `<a class="citation" href="${reference.url}" target="_blank" rel="noreferrer">${referenceKey}</a>`;
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
        <h2>Boundary conditions</h2>
        <p>${mathInline('<mi>p</mi>', 'p')} always uses no-flux / Neumann boundaries, following the zero-flux phase-field boundary described for K1993. ${mathInline('<mi>T</mi>', 'temperature')} can use adiabatic / no-flux, fixed-temperature edges, or a fixed-temperature left wall depending on the preset. Fig.7, Fig.8, Fig.9, and Fig.10 paper-target presets use the supercooled-melt adiabatic boundary setup.</p>
        ${threeDModelNotes()}
        <h2>Stability limits</h2>
        <p>The temperature diffusion solve is implicit, but the phase equation is still explicit finite-difference stepping. Large ${mathInline('<mrow><mi mathvariant="normal">Δt</mi></mrow>', 'time step')}, strong anisotropy, high noise, or high-resolution 3D grids can destabilize the run. The app does not visually smooth over numerical instability; reduce the parameters if a run becomes unstable.</p>
      </div>
    </article>
  `;
}

function referencesTemplate(): string {
  return `
    <article class="content-page">
      <div class="content-inner">
        <h1>References</h1>
        <p>Model explanations and reproduction presets cite the sources below by stable reference key. This app uses bibliographic metadata, public source links, and simulator-generated outputs rather than reproduced paper figures.</p>
        ${referenceList('reference')}
      </div>
    </article>
  `;
}

function referenceList(idPrefix: string): string {
  return `
    <div class="reference-list">
      ${modelReferences
        .map(
          (reference) => `
            <div class="reference-item" id="${idPrefix}-${reference.key.toLowerCase()}">
              <div class="reference-index">${reference.key}</div>
              <a class="reference-copy reference-link" href="${reference.url}" target="_blank" rel="noreferrer">
                <div class="reference-title">${reference.authors}</div>
                <div class="reference-meta">${reference.meta}</div>
              </a>
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

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
