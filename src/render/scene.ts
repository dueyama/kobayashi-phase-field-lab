import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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
      this.renderer.render(this.scene, this.camera);
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
      const presentation3D = config.surfaceStyle3D === 'gold';
      this.controls.enabled = !presentation3D || config.interactiveView3D === true;
      this.renderer.setClearColor(config.surfaceStyle3D === 'gold' ? 0x06234f : 0x03070d, 1);
      if (force) {
        if (presentation3D) {
          if (config.presentationView3D === 'z-right' && config.interactiveView3D === true) {
            this.camera.position.set(0, 0, 1.08);
            this.camera.up.set(0, 1, 0);
          } else if (config.presentationView3D === 'upright' && config.interactiveView3D === true) {
            this.camera.position.set(0.32, 0.58, 1.78);
            this.camera.up.set(0, 1, 0);
          } else if (config.presentationView3D === 'z-right') {
            this.camera.position.set(0, -1.08, 0);
            this.camera.up.set(-1, 0, 0);
          } else {
            this.camera.position.set(0.32, -1.78, 0.58);
            this.camera.up.set(0, 0, 1);
          }
        } else {
          this.camera.position.set(2.35, 0, 0);
          this.camera.up.set(0, 1, 0);
        }
        this.camera.lookAt(0, 0, 0);
        this.controls.target.set(0, 0, 0);
      }
      this.view3D.update(snapshot, config, force);
    }

    if (this.controls.enabled) this.controls.update();
    this.renderer.render(this.scene, this.camera);
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
}
