import * as THREE from 'three';
import { createXYMirrorGrid, createXYMirroredSnapshot, shouldMirrorXY } from '../simulation/mirrorGrid';
import type { PhaseFieldConfig, SimulationSnapshot, ViewMode } from '../simulation/types';
import type { IsosurfaceBuildResponse } from './isosurfaceWorker';
import { IsosurfaceWorkerClient } from './isosurfaceWorkerClient';
import { createVolumeRaycaster } from './volumeRaycaster';
import { createSliceStack, type SliceAxis, type SliceStack } from './volumeRenderer';

export class View3D {
  readonly group = new THREE.Group();
  private surface: THREE.Mesh | null = null;
  private sliceStack: SliceStack | null = null;
  private readonly contentGroup = new THREE.Group();
  private box: THREE.LineSegments | null = null;
  private boxKey = '';
  private updateIndex = 0;
  private orientationKey = '';
  private isosurfaceWorker: IsosurfaceWorkerClient | null = null;
  private surfaceBuildInFlight = false;
  private pendingSurfaceJob: SurfaceBuildJob | null = null;
  private surfaceEpoch = 0;
  private lastSurfaceQueueWallTime = 0;
  private lastSurfaceQueuedStep = -1;
  private surfaceWaiters: Array<() => void> = [];
  private disposed = false;

  constructor(private readonly requestRender: () => void = () => {}) {
    this.contentGroup.rotation.x = 0;
    this.contentGroup.rotation.y = 0;
    this.group.add(this.contentGroup);
  }

  update(snapshot: SimulationSnapshot, config: PhaseFieldConfig, force = false): Promise<void> | undefined {
    this.updateIndex += 1;
    this.applyContentOrientation(config);
    const interval = config.renderMode3D === 'surface' ? 5 : 8;
    if (!force && this.updateIndex % interval !== 0 && !config.surfaceFrameGuarantee3D) return undefined;

    if (config.renderMode3D === 'surface') {
      this.clearSlices();
      if (force) this.cancelSurfaceBuilds();
      return this.updateSurface(snapshot, config, force);
    } else {
      this.clearSurface();
      const displaySnapshot = createXYMirroredSnapshot(snapshot, config);
      this.ensureBox(displaySnapshot.nx, displaySnapshot.ny, displaySnapshot.nz);
      if (config.renderMode3D === 'volume') {
        this.updateVolume(displaySnapshot);
      } else {
        this.updateSlices(displaySnapshot, config.viewMode, sliceAxisForConfig(config));
      }
      return undefined;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.surfaceEpoch += 1;
    this.pendingSurfaceJob = null;
    this.isosurfaceWorker?.dispose();
    this.isosurfaceWorker = null;
    this.resolveSurfaceWaiters();
    this.clearSurface();
    this.clearSlices();
    this.clearBox();
  }

  private updateSurface(snapshot: SimulationSnapshot, config: PhaseFieldConfig, force: boolean): Promise<void> | undefined {
    const guarantee = config.surfaceFrameGuarantee3D === true && !force;
    const waitForSurface = guarantee ? this.waitForNextSurface() : undefined;
    const grid = createXYMirrorGrid(snapshot, config, shouldMirrorXY(config));
    this.ensureBox(grid.nx, grid.ny, grid.nz);
    const targetCells = config.surfaceStyle3D === 'gold' ? 240 : 72;
    const stride = Math.max(1, Math.ceil(Math.max(grid.nx, grid.ny, grid.nz) / targetCells));
    if (this.surfaceBuildInFlight && !this.shouldQueuePendingSurface(snapshot, force, guarantee)) return waitForSurface;

    const job = this.createSurfaceBuildJob(snapshot, config, grid, stride);
    const previewStride = Math.max(stride, Math.ceil(Math.max(grid.nx, grid.ny, grid.nz) / 72));
    const previewJob =
      !this.surface && previewStride > stride
        ? this.createSurfaceBuildJob(snapshot, config, grid, previewStride)
        : null;

    if (this.surfaceBuildInFlight) {
      this.pendingSurfaceJob = previewJob ?? job;
      return waitForSurface;
    }
    if (previewJob) this.pendingSurfaceJob = job;
    void this.startSurfaceBuild(previewJob ?? job);
    return waitForSurface;
  }

  private async startSurfaceBuild(job: SurfaceBuildJob): Promise<void> {
    this.surfaceBuildInFlight = true;
    try {
      const data = await this.ensureIsosurfaceWorker().build(job.input);
      if (!this.disposed && job.epoch === this.surfaceEpoch) {
        this.replaceSurface(data, job.config);
        this.requestRender();
      }
    } catch (error) {
      if (!this.disposed) console.warn('Isosurface worker failed.', error);
      this.resolveSurfaceWaiters();
    } finally {
      this.surfaceBuildInFlight = false;
      const pending = this.pendingSurfaceJob;
      this.pendingSurfaceJob = null;
      if (pending && !this.disposed) void this.startSurfaceBuild(pending);
    }
  }

  private createSurfaceBuildJob(
    snapshot: SimulationSnapshot,
    config: PhaseFieldConfig,
    grid: ReturnType<typeof createXYMirrorGrid>,
    stride: number
  ): SurfaceBuildJob {
    this.lastSurfaceQueueWallTime = performance.now();
    this.lastSurfaceQueuedStep = snapshot.step;
    return {
      epoch: this.surfaceEpoch,
      config,
      input: {
        phi: new Float32Array(snapshot.phi),
        temperature: new Float32Array(snapshot.temperature),
        sourceNx: snapshot.nx,
        sourceNy: snapshot.ny,
        sourceNz: snapshot.nz,
        displayNx: grid.nx,
        displayNy: grid.ny,
        displayNz: grid.nz,
        mirrorXY: grid.mirrorXY,
        halfCellMirror: config.nucleusPlacement === 'bottom-corner-halfcell',
        iso: 0.5,
        stride
      }
    };
  }

  private shouldQueuePendingSurface(snapshot: SimulationSnapshot, force: boolean, guarantee: boolean): boolean {
    if (guarantee || force || !this.pendingSurfaceJob) return true;
    if (snapshot.step === this.lastSurfaceQueuedStep) return false;
    return performance.now() - this.lastSurfaceQueueWallTime > 250;
  }

  private cancelSurfaceBuilds(): void {
    this.surfaceEpoch += 1;
    this.pendingSurfaceJob = null;
    this.lastSurfaceQueueWallTime = 0;
    this.lastSurfaceQueuedStep = -1;
  }

  private ensureIsosurfaceWorker(): IsosurfaceWorkerClient {
    this.isosurfaceWorker ??= new IsosurfaceWorkerClient();
    return this.isosurfaceWorker;
  }

  private replaceSurface(data: IsosurfaceBuildResponse, config: PhaseFieldConfig): void {
    this.removeSurface();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    geometry.computeBoundingSphere();
    const material =
      config.surfaceStyle3D === 'gold'
        ? new THREE.MeshStandardMaterial({
            color: 0xffdc3f,
            roughness: 0.24,
            metalness: 0.34,
            emissive: new THREE.Color(0x443300),
            emissiveIntensity: 0.14
          })
        : new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.42,
            metalness: 0.08,
            emissive: new THREE.Color(0x12384a),
            emissiveIntensity: 0.16
          });
    this.surface = new THREE.Mesh(geometry, material);
    this.contentGroup.add(this.surface);
    this.resolveSurfaceWaiters();
  }

  private updateSlices(snapshot: SimulationSnapshot, viewMode: ViewMode, axis: SliceAxis): void {
    this.clearSlices();
    this.sliceStack = createSliceStack(
      snapshot.phi,
      snapshot.temperature,
      snapshot.nx,
      snapshot.ny,
      snapshot.nz,
      viewMode,
      false,
      axis
    );
    this.contentGroup.add(this.sliceStack.group);
  }

  private updateVolume(snapshot: SimulationSnapshot): void {
    this.clearSlices();
    this.sliceStack = createVolumeRaycaster(
      snapshot.phi,
      snapshot.nx,
      snapshot.ny,
      snapshot.nz
    );
    this.contentGroup.add(this.sliceStack.group);
  }

  private clearSurface(): void {
    this.surfaceEpoch += 1;
    this.pendingSurfaceJob = null;
    this.resolveSurfaceWaiters();
    this.removeSurface();
  }

  private waitForNextSurface(): Promise<void> {
    return new Promise((resolve) => {
      this.surfaceWaiters.push(resolve);
    });
  }

  private resolveSurfaceWaiters(): void {
    const waiters = this.surfaceWaiters;
    this.surfaceWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private removeSurface(): void {
    if (!this.surface) return;
    this.contentGroup.remove(this.surface);
    this.surface.geometry.dispose();
    (this.surface.material as THREE.Material).dispose();
    this.surface = null;
  }

  private clearSlices(): void {
    if (!this.sliceStack) return;
    this.contentGroup.remove(this.sliceStack.group);
    this.sliceStack.dispose();
    this.sliceStack = null;
  }

  private ensureBox(nx: number, ny: number, nz: number): void {
    const max = Math.max(nx, ny, nz);
    const width = nx / max;
    const height = ny / max;
    const depth = nz / max;
    const key = `${width.toFixed(6)}:${height.toFixed(6)}:${depth.toFixed(6)}`;
    if (key === this.boxKey && this.box) return;
    this.clearBox();
    this.box = createBox(width, height, depth);
    this.boxKey = key;
    this.contentGroup.add(this.box);
  }

  private clearBox(): void {
    if (!this.box) return;
    this.contentGroup.remove(this.box);
    this.box.geometry.dispose();
    (this.box.material as THREE.Material).dispose();
    this.box = null;
    this.boxKey = '';
  }

  private applyContentOrientation(config: PhaseFieldConfig): void {
    const key =
      config.interactiveView3D === true && config.presentationView3D === 'z-right'
        ? 'interactive-z-right'
        : config.interactiveView3D === true && config.presentationView3D === 'upright'
          ? 'interactive-upright'
          : 'identity';
    if (key === this.orientationKey) return;
    this.orientationKey = key;
    if (key === 'interactive-z-right') {
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(0, -1, 0),
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(1, 0, 0)
      );
      this.contentGroup.quaternion.setFromRotationMatrix(basis);
    } else if (key === 'interactive-upright') {
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(0, 1, 0)
      );
      this.contentGroup.quaternion.setFromRotationMatrix(basis);
    } else {
      this.contentGroup.quaternion.identity();
    }
  }
}

function sliceAxisForConfig(config: PhaseFieldConfig): SliceAxis {
  return config.interactiveView3D === true && config.presentationView3D === 'z-right' ? 'y' : 'z';
}

function createBox(width: number, height: number, depth: number): THREE.LineSegments {
  const hx = width * 0.5;
  const hy = height * 0.5;
  const hz = depth * 0.5;
  const points = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],
    [-hx, hy, -hz],
    [-hx, -hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz],
    [-hx, hy, hz],
    [-hx, -hy, hz],
    [-hx, -hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, -hz],
    [hx, -hy, hz],
    [hx, hy, -hz],
    [hx, hy, hz],
    [-hx, hy, -hz],
    [-hx, hy, hz]
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  const material = new THREE.LineBasicMaterial({
    color: 0x6edfff,
    transparent: true,
    opacity: 0.32
  });
  return new THREE.LineSegments(geometry, material);
}

interface SurfaceBuildJob {
  epoch: number;
  config: PhaseFieldConfig;
  input: Parameters<IsosurfaceWorkerClient['build']>[0];
}
