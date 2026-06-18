import * as THREE from 'three';
import { index2D } from '../simulation/fields';
import type { SimulationSnapshot, ViewMode } from '../simulation/types';
import { combinedColor, phaseToColor, temperatureToColor } from './colorMaps';

export class View2D {
  readonly group = new THREE.Group();
  private texture: THREE.DataTexture | null = null;
  private material: THREE.MeshBasicMaterial | null = null;
  private mesh: THREE.Mesh | null = null;
  private contour: THREE.LineSegments | null = null;
  private buffer: Uint8Array | null = null;
  private nx = 0;
  private ny = 0;

  update(snapshot: SimulationSnapshot, mode: ViewMode): void {
    if (snapshot.nx !== this.nx || snapshot.ny !== this.ny || !this.texture) {
      this.rebuild(snapshot.nx, snapshot.ny);
    }
    if (!this.buffer || !this.texture) return;
    writeTexture(this.buffer, snapshot, mode);
    this.texture.needsUpdate = true;
    this.updateContour(snapshot);
  }

  dispose(): void {
    this.texture?.dispose();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
    this.contour?.geometry.dispose();
    (this.contour?.material as THREE.Material | undefined)?.dispose();
  }

  private rebuild(nx: number, ny: number): void {
    this.dispose();
    this.group.clear();
    this.nx = nx;
    this.ny = ny;
    this.buffer = new Uint8Array(nx * ny * 4);
    this.texture = new THREE.DataTexture(this.buffer, nx, ny, THREE.RGBAFormat);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, side: THREE.DoubleSide });
    const aspect = nx / ny;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(aspect, 1), this.material);
    this.group.add(this.mesh);
  }

  private updateContour(snapshot: SimulationSnapshot): void {
    if (this.contour) {
      this.group.remove(this.contour);
      this.contour.geometry.dispose();
      (this.contour.material as THREE.Material).dispose();
      this.contour = null;
    }
    const vertices = buildContourSegments(snapshot, 0.5);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0xeefbff,
      transparent: true,
      opacity: 0.92
    });
    this.contour = new THREE.LineSegments(geometry, material);
    this.contour.position.z = 0.003;
    this.group.add(this.contour);
  }
}

function writeTexture(buffer: Uint8Array, snapshot: SimulationSnapshot, mode: ViewMode): void {
  const { nx, ny, phi, temperature } = snapshot;
  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      const source = index2D(x, y, nx);
      const target = (x + nx * (ny - 1 - y)) * 4;
      const color =
        mode === 'temperature'
          ? temperatureToColor(temperature[source])
          : mode === 'phase'
            ? phaseToColor(phi[source])
            : combinedColor(phi[source], temperature[source]);
      buffer[target] = color[0];
      buffer[target + 1] = color[1];
      buffer[target + 2] = color[2];
      buffer[target + 3] = 255;
    }
  }
}

export function buildContourSegments(snapshot: SimulationSnapshot, iso: number): number[] {
  const { nx, ny, phi } = snapshot;
  const aspect = nx / ny;
  const sx = aspect / (nx - 1);
  const sy = 1 / (ny - 1);
  const ox = -aspect * 0.5;
  const oy = -0.5;
  const vertices: number[] = [];

  for (let y = 0; y < ny - 1; y += 1) {
    for (let x = 0; x < nx - 1; x += 1) {
      const p00 = phi[index2D(x, y, nx)];
      const p10 = phi[index2D(x + 1, y, nx)];
      const p11 = phi[index2D(x + 1, y + 1, nx)];
      const p01 = phi[index2D(x, y + 1, nx)];
      const points: [number, number][] = [];
      if ((p00 - iso) * (p10 - iso) < 0) points.push([x + interp(p00, p10, iso), y]);
      if ((p10 - iso) * (p11 - iso) < 0) points.push([x + 1, y + interp(p10, p11, iso)]);
      if ((p01 - iso) * (p11 - iso) < 0) points.push([x + interp(p01, p11, iso), y + 1]);
      if ((p00 - iso) * (p01 - iso) < 0) points.push([x, y + interp(p00, p01, iso)]);
      if (points.length >= 2) {
        pushPoint(vertices, points[0], sx, sy, ox, oy, ny);
        pushPoint(vertices, points[1], sx, sy, ox, oy, ny);
      }
      if (points.length === 4) {
        pushPoint(vertices, points[2], sx, sy, ox, oy, ny);
        pushPoint(vertices, points[3], sx, sy, ox, oy, ny);
      }
    }
  }
  return vertices;
}

function interp(a: number, b: number, iso: number): number {
  const d = b - a;
  return Math.abs(d) < 1e-6 ? 0.5 : (iso - a) / d;
}

function pushPoint(vertices: number[], point: [number, number], sx: number, sy: number, ox: number, oy: number, ny: number): void {
  const displayY = ny - 1 - point[1];
  vertices.push(ox + point[0] * sx, oy + displayY * sy, 0);
}
