import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createXYMirrorGrid, shouldMirrorXY } from '../simulation/mirrorGrid';
import type { PhaseFieldConfig, SimulationSnapshot } from '../simulation/types';
import { View2D } from './view2D';
import { View3D } from './view3D';

export class SceneRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
  private readonly controls: OrbitControls;
  private readonly view2D = new View2D();
  private readonly view3D = new View3D();
  private readonly lights: THREE.Object3D[] = [];
  private activeDimension: '2d' | '3d' | null = null;
  private frame = 0;
  private controlFrameId: number | null = null;
  private last3D:
    | {
        snapshot: SimulationSnapshot;
        config: PhaseFieldConfig;
      }
    | null = null;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x03070d, 1);
    host.appendChild(this.renderer.domElement);
    this.camera.position.set(0, 0, 2.25);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.7;
    this.controls.addEventListener('change', () => {
      this.renderScene();
      this.scheduleControlDampingFrame();
    });
    this.installLights();
    this.resize();
  }

  resize(): void {
    const { width, height } = this.host.getBoundingClientRect();
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.activeDimension === '3d' && this.last3D) {
      this.apply3DCamera(this.last3D.snapshot, this.last3D.config);
      this.renderer.render(this.scene, this.camera);
    }
  }

  render(snapshot: SimulationSnapshot, config: PhaseFieldConfig, force = false): void {
    this.frame += 1;
    if (this.activeDimension !== snapshot.dimension) {
      this.switchDimension(snapshot.dimension);
      force = true;
    }

    if (snapshot.dimension === '2d') {
      this.controls.enabled = false;
      this.camera.position.set(0, 0, 2.0);
      this.camera.lookAt(0, 0, 0);
      this.view2D.update(snapshot, config.viewMode);
    } else {
      this.last3D = { snapshot, config };
      this.controls.enabled = config.interactiveView3D !== false;
      this.renderer.setClearColor(config.surfaceStyle3D === 'gold' ? 0x06234f : 0x03070d, 1);
      if (force) {
        this.apply3DCamera(snapshot, config);
      }
      this.view3D.update(snapshot, config, force);
    }

    if (this.controls.enabled) this.controls.update();
    this.renderScene();
  }

  screenshot(): string {
    return this.renderer.domElement.toDataURL('image/png');
  }

  screenshotBlob(type = 'image/png', quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.renderer.domElement.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('failed to capture WebGL canvas'));
          }
        },
        type,
        quality
      );
    });
  }

  dispose(): void {
    if (this.controlFrameId !== null) {
      cancelAnimationFrame(this.controlFrameId);
      this.controlFrameId = null;
    }
    this.view2D.dispose();
    this.view3D.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.host.replaceChildren();
  }

  private switchDimension(dimension: '2d' | '3d'): void {
    this.scene.remove(this.view2D.group);
    this.scene.remove(this.view3D.group);
    this.activeDimension = dimension;
    if (dimension === '2d') {
      this.scene.add(this.view2D.group);
    } else {
      this.scene.add(this.view3D.group);
    }
  }

  private installLights(): void {
    const ambient = new THREE.AmbientLight(0xb8eaff, 0.52);
    const key = new THREE.DirectionalLight(0xe8fbff, 2.2);
    key.position.set(1.6, 1.7, 2.2);
    const rim = new THREE.DirectionalLight(0x60dfff, 1.6);
    rim.position.set(-1.4, -0.4, 1.4);
    const heat = new THREE.PointLight(0xffa246, 2.0, 4);
    heat.position.set(-0.5, 0.35, 0.8);
    this.lights.push(ambient, key, rim, heat);
    for (const light of this.lights) {
      this.scene.add(light);
    }
  }

  private renderScene(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private scheduleControlDampingFrame(): void {
    if (!this.controls.enabled || !this.controls.enableDamping || this.controlFrameId !== null) return;
    this.controlFrameId = requestAnimationFrame(() => {
      this.controlFrameId = null;
      if (!this.controls.enabled) return;
      const changed = this.controls.update();
      this.renderScene();
      if (changed) this.scheduleControlDampingFrame();
    });
  }

  private apply3DCamera(snapshot: SimulationSnapshot, config: PhaseFieldConfig): void {
    const extents = normalizedDisplayExtents(snapshot, config);
    const presentation3D = config.surfaceStyle3D === 'gold';

    if (presentation3D && config.presentationView3D === 'z-right' && config.interactiveView3D === true) {
      const distance = this.fitDistanceForScreenExtents(extents.z, extents.x, 1.08, 1.22);
      this.camera.position.set(0, 0, distance);
      this.camera.up.set(0, 1, 0);
    } else if (presentation3D && config.presentationView3D === 'z-right') {
      const distance = this.fitDistanceForScreenExtents(extents.z, extents.x, 1.08, 1.22);
      this.camera.position.set(0, -distance, 0);
      this.camera.up.set(-1, 0, 0);
    } else if (presentation3D && config.presentationView3D === 'upright' && config.interactiveView3D === true) {
      this.setCameraAlongDirection(new THREE.Vector3(0.32, 0.58, 1.78), this.fitDistanceForSphere(extents, 1.9, 1.04), new THREE.Vector3(0, 1, 0));
    } else if (presentation3D) {
      this.setCameraAlongDirection(new THREE.Vector3(0.32, -1.78, 0.58), this.fitDistanceForSphere(extents, 1.9, 1.04), new THREE.Vector3(0, 0, 1));
    } else {
      this.camera.position.set(this.fitDistanceForSphere(extents, 2.35, 1.08), 0, 0);
      this.camera.up.set(0, 1, 0);
    }

    this.camera.lookAt(0, 0, 0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  private setCameraAlongDirection(direction: THREE.Vector3, distance: number, up: THREE.Vector3): void {
    this.camera.position.copy(direction.normalize().multiplyScalar(distance));
    this.camera.up.copy(up);
  }

  private fitDistanceForScreenExtents(screenWidth: number, screenHeight: number, baseDistance: number, padding: number): number {
    const halfVerticalFov = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const aspect = Math.max(this.camera.aspect, 0.2);
    const verticalDistance = screenHeight / (2 * Math.tan(halfVerticalFov));
    const horizontalDistance = screenWidth / (2 * Math.tan(halfVerticalFov) * aspect);
    return Math.max(baseDistance, verticalDistance * padding, horizontalDistance * padding);
  }

  private fitDistanceForSphere(extents: { x: number; y: number; z: number }, baseDistance: number, padding: number): number {
    const halfVerticalFov = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const radius = Math.sqrt(extents.x * extents.x + extents.y * extents.y + extents.z * extents.z) * 0.5;
    const aspectPenalty = Math.max(1, 1 / Math.max(this.camera.aspect, 0.2));
    return Math.max(baseDistance, (radius / Math.sin(halfVerticalFov)) * padding * Math.sqrt(aspectPenalty));
  }
}

function normalizedDisplayExtents(snapshot: SimulationSnapshot, config: PhaseFieldConfig): { x: number; y: number; z: number } {
  const grid = createXYMirrorGrid(snapshot, config, shouldMirrorXY(config));
  const max = Math.max(grid.nx, grid.ny, grid.nz);
  return {
    x: grid.nx / max,
    y: grid.ny / max,
    z: grid.nz / max
  };
}
