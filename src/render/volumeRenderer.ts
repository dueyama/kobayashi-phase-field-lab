import * as THREE from 'three';
import { index3D } from '../simulation/fields';
import type { ViewMode } from '../simulation/types';
import { combinedColor, phaseToColor, temperatureToColor, volumeColor } from './colorMaps';

export type SliceAxis = 'y' | 'z';

export interface SliceStack {
  group: THREE.Group;
  dispose: () => void;
}

export function createSliceStack(
  phi: Float32Array,
  temperature: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  mode: ViewMode,
  volume: boolean,
  axis: SliceAxis = 'z'
): SliceStack {
  const group = new THREE.Group();
  const textures: THREE.DataTexture[] = [];
  const materials: THREE.MeshBasicMaterial[] = [];
  const sliceCount = axis === 'y' ? ny : nz;
  const slices = volume ? Math.min(sliceCount, 72) : 3;
  const step = Math.max(1, Math.floor(sliceCount / slices));
  const scale = 1 / Math.max(nx, ny, nz);
  const width = nx * scale;
  const height = ny * scale;
  const depth = nz * scale;
  const zStart = -depth * 0.5;
  const yStart = -height * 0.5;
  const textureWidth = axis === 'y' ? nz : nx;
  const textureHeight = axis === 'y' ? nx : ny;

  for (let s = 0; s < slices; s += 1) {
    const slice = volume ? Math.min(sliceCount - 1, s * step) : Math.round(((s + 1) / 4) * (sliceCount - 1));
    const buffer = new Uint8Array(textureWidth * textureHeight * 4);
    writeSlice(buffer, phi, temperature, nx, ny, nz, slice, mode, volume, axis, textureWidth);
    const texture = new THREE.DataTexture(buffer, textureWidth, textureHeight, THREE.RGBAFormat);
    texture.needsUpdate = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: volume ? 0.18 : 0.96,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: volume ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    const geometry =
      axis === 'y'
        ? createYSliceGeometry(width, yStart + slice * scale, depth)
        : createZSliceGeometry(width, height, zStart + slice * scale);
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    textures.push(texture);
    materials.push(material);
  }

  return {
    group,
    dispose: () => {
      for (const texture of textures) texture.dispose();
      for (const material of materials) material.dispose();
      for (const child of group.children) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
      }
    }
  };
}

function writeSlice(
  buffer: Uint8Array,
  phi: Float32Array,
  temperature: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  slice: number,
  mode: ViewMode,
  volume: boolean,
  axis: SliceAxis,
  textureWidth: number
): void {
  if (axis === 'y') {
    for (let x = 0; x < nx; x += 1) {
      for (let z = 0; z < nz; z += 1) {
        const source = index3D(x, Math.min(slice, ny - 1), z, nx, ny);
        const target = (z + textureWidth * (nx - 1 - x)) * 4;
        writeVoxelColor(buffer, target, phi[source], temperature[source], mode, volume);
      }
    }
    return;
  }

  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      const source = index3D(x, y, Math.min(slice, nz - 1), nx, ny);
      const target = (x + textureWidth * (ny - 1 - y)) * 4;
      const phiValue = phi[source];
      const tValue = temperature[source];
      writeVoxelColor(buffer, target, phiValue, tValue, mode, volume);
    }
  }
}

function writeVoxelColor(
  buffer: Uint8Array,
  target: number,
  phiValue: number,
  tValue: number,
  mode: ViewMode,
  volume: boolean
): void {
  const color =
    volume
      ? volumeColor(phiValue, tValue)
      : mode === 'temperature'
        ? [...temperatureToColor(tValue), 230]
        : mode === 'phase'
          ? [...phaseToColor(phiValue), 230]
          : [...combinedColor(phiValue, tValue), 236];
  buffer[target] = color[0];
  buffer[target + 1] = color[1];
  buffer[target + 2] = color[2];
  buffer[target + 3] = color[3];
}

function createZSliceGeometry(width: number, height: number, z: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(width, height);
  geometry.translate(0, 0, z);
  return geometry;
}

function createYSliceGeometry(width: number, y: number, depth: number): THREE.BufferGeometry {
  const hx = width * 0.5;
  const hz = depth * 0.5;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -hx,
        y,
        -hz,
        hx,
        y,
        -hz,
        hx,
        y,
        hz,
        -hx,
        y,
        hz
      ],
      3
    )
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 1, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}
