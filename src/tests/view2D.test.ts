import { describe, expect, it } from 'vitest';
import { index2D } from '../simulation/fields';
import type { SimulationSnapshot } from '../simulation/types';
import { buildContourSegments } from '../render/view2D';

describe('2D contour rendering', () => {
  it('uses the same vertical orientation as the scalar texture', () => {
    const nx = 8;
    const ny = 8;
    const phi = new Float32Array(nx * ny);
    const temperature = new Float32Array(nx * ny);
    for (let x = 0; x < nx; x += 1) {
      phi[index2D(x, ny - 1, nx)] = 1;
    }

    const snapshot: SimulationSnapshot = {
      dimension: '2d',
      nx,
      ny,
      nz: 1,
      phi,
      temperature,
      step: 0,
      time: 0,
      minPhi: 0,
      maxPhi: 1,
      minTemperature: 0,
      maxTemperature: 0
    };

    const vertices = buildContourSegments(snapshot, 0.5);
    const yValues = [];
    for (let i = 1; i < vertices.length; i += 3) yValues.push(vertices[i]);

    expect(yValues.length).toBeGreaterThan(0);
    expect(Math.max(...yValues)).toBeLessThan(0);
  });
});
