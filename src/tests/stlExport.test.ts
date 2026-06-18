import { describe, expect, it } from 'vitest';

import { buildIsosurfaceMesh } from '../simulation/isosurface';
import { createXYMirrorGrid } from '../simulation/mirrorGrid';
import { createIsosurfaceStlBlob } from '../simulation/stlExport';
import { clonePreset } from '../simulation/presets';
import type { SimulationSnapshot } from '../simulation/types';

describe('isosurface and STL export', () => {
  it('builds an interpolated marching-cubes isosurface instead of a voxel shell', () => {
    const phi = new Float32Array([0, 1, 0, 1, 0, 1, 0, 1]);
    const temperature = new Float32Array(phi.length);
    const mesh = buildIsosurfaceMesh(phi, temperature, 2, 2, 2, { iso: 0.5, cellSize: 1 });

    expect(mesh.triangleCount).toBe(2);
    expect(mesh.positions.length).toBe(2 * 9);
    const xs = Array.from({ length: mesh.positions.length / 3 }, (_, i) => mesh.positions[i * 3]);
    expect(Math.min(...xs)).toBeCloseTo(0.5);
    expect(Math.max(...xs)).toBeCloseTo(0.5);
  });

  it('writes a binary STL from the interpolated phi isosurface', async () => {
    const config = clonePreset('3d-isotropic');
    config.nx = 2;
    config.ny = 2;
    config.nz = 2;
    config.dx = 0.03;
    const snapshot = makeSnapshot(2, 2, 2, new Float32Array([0, 1, 0, 1, 0, 1, 0, 1]));

    const blob = createIsosurfaceStlBlob(snapshot, config);
    const view = new DataView(await blob.arrayBuffer());

    expect(blob.type).toBe('model/stl');
    expect(view.getUint32(80, true)).toBe(28);
    expect(blob.size).toBe(84 + 28 * 50);
  });

  it('can mirror a half-cell quarter domain across x and y before STL export', async () => {
    const config = clonePreset('paper-fig9-3d-right-target');
    config.nx = 2;
    config.ny = 2;
    config.nz = 2;
    config.dx = 0.03;
    const snapshot = makeSnapshot(2, 2, 2, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]));

    const blob = createIsosurfaceStlBlob(snapshot, config, { mirrorXY: true });
    const view = new DataView(await blob.arrayBuffer());

    expect(config.nucleusPlacement).toBe('bottom-corner-halfcell');
    expect(view.getUint32(80, true)).toBeGreaterThan(0);
    expect(blob.size).toBe(84 + view.getUint32(80, true) * 50);
  });

  it('maps half-cell x-y symmetry domains to a full display grid', () => {
    const config = clonePreset('paper-fig9-3d-right-target');
    const snapshot = makeSnapshot(2, 2, 2, new Float32Array(8));
    const grid = createXYMirrorGrid(snapshot, config, true);

    expect(grid.nx).toBe(4);
    expect(grid.ny).toBe(4);
    expect([0, 1, 2, 3].map(grid.mapX)).toEqual([1, 0, 0, 1]);
    expect([0, 1, 2, 3].map(grid.mapY)).toEqual([1, 0, 0, 1]);
  });
});

function makeSnapshot(nx: number, ny: number, nz: number, phi: Float32Array): SimulationSnapshot {
  return {
    dimension: '3d',
    nx,
    ny,
    nz,
    phi,
    temperature: new Float32Array(phi.length),
    step: 0,
    time: 0,
    minPhi: 0,
    maxPhi: 1,
    minTemperature: 0,
    maxTemperature: 0
  };
}
