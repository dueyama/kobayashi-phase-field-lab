import { index3D } from './fields';
import type { PhaseFieldConfig, SimulationSnapshot } from './types';

export interface XYMirrorGrid {
  nx: number;
  ny: number;
  nz: number;
  mirrorXY: boolean;
  mapX: (x: number) => number;
  mapY: (y: number) => number;
  mapIndex: (x: number, y: number, z: number) => number;
}

export function shouldMirrorXY(config: PhaseFieldConfig): boolean {
  return config.dimension === '3d' && config.nucleusPlacement === 'bottom-corner-halfcell';
}

export function createXYMirrorGrid(snapshot: SimulationSnapshot, config: PhaseFieldConfig, mirrorXY = shouldMirrorXY(config)): XYMirrorGrid {
  const halfCellMirror = config.nucleusPlacement === 'bottom-corner-halfcell';
  const nx = mirrorXY ? snapshot.nx * 2 - (halfCellMirror ? 0 : 1) : snapshot.nx;
  const ny = mirrorXY ? snapshot.ny * 2 - (halfCellMirror ? 0 : 1) : snapshot.ny;
  const sourceFromMirrorIndex = (index: number, sourceSize: number): number => {
    if (!mirrorXY) return index;
    if (halfCellMirror) return index < sourceSize ? sourceSize - 1 - index : index - sourceSize;
    return index < sourceSize - 1 ? sourceSize - 1 - index : index - sourceSize + 1;
  };
  const mapX = (x: number) => sourceFromMirrorIndex(x, snapshot.nx);
  const mapY = (y: number) => sourceFromMirrorIndex(y, snapshot.ny);
  return {
    nx,
    ny,
    nz: snapshot.nz,
    mirrorXY,
    mapX,
    mapY,
    mapIndex: (x: number, y: number, z: number) => index3D(mapX(x), mapY(y), z, snapshot.nx, snapshot.ny)
  };
}

export function createXYMirroredSnapshot(snapshot: SimulationSnapshot, config: PhaseFieldConfig): SimulationSnapshot {
  const grid = createXYMirrorGrid(snapshot, config, shouldMirrorXY(config));
  if (!grid.mirrorXY) return snapshot;

  const length = grid.nx * grid.ny * grid.nz;
  const phi = new Float32Array(length);
  const temperature = new Float32Array(length);
  for (let z = 0; z < grid.nz; z += 1) {
    for (let y = 0; y < grid.ny; y += 1) {
      for (let x = 0; x < grid.nx; x += 1) {
        const target = index3D(x, y, z, grid.nx, grid.ny);
        const source = grid.mapIndex(x, y, z);
        phi[target] = snapshot.phi[source];
        temperature[target] = snapshot.temperature[source];
      }
    }
  }

  return {
    ...snapshot,
    nx: grid.nx,
    ny: grid.ny,
    nz: grid.nz,
    phi,
    temperature
  };
}
