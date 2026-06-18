import { describe, expect, it } from 'vitest';
import { PhaseField2D, paperSchemeFluxForTest2D } from '../simulation/phaseField2D';
import { PhaseField3D } from '../simulation/phaseField3D';
import { clonePreset, presets } from '../simulation/presets';
import { index2D, index3D } from '../simulation/fields';

describe('phase-field solvers', () => {
  it('keeps all presets finite for a single step', () => {
    for (const preset of presets) {
      const config = clonePreset(preset.id);
      if (config.nx > 64) continue;
      const solver = config.dimension === '2d' ? new PhaseField2D(config) : new PhaseField3D(config);
      const stats = solver.step(1);
      expect(stats.unstable).toBe(false);
      expect(Number.isFinite(stats.minPhi)).toBe(true);
      expect(Number.isFinite(stats.maxPhi)).toBe(true);
      expect(Number.isFinite(stats.minTemperature)).toBe(true);
      expect(Number.isFinite(stats.maxTemperature)).toBe(true);
    }
  });

  it('resets deterministically with the same seed', () => {
    const config = clonePreset('2d-fourfold');
    const first = new PhaseField2D(config);
    const second = new PhaseField2D(config);
    first.step(8);
    second.step(8);
    expect(Array.from(first.phi.slice(0, 64))).toEqual(Array.from(second.phi.slice(0, 64)));
    expect(Array.from(first.temperature.slice(0, 64))).toEqual(Array.from(second.temperature.slice(0, 64)));
  });

  it('keeps paper-target presets finite on a reduced verification grid', () => {
    for (const preset of presets.filter((item) => item.id.startsWith('paper-'))) {
      const config = clonePreset(preset.id);
      config.nx = 48;
      config.ny = 48;
      config.nz = 1;
      config.nucleusRadius = 4;
      config.dt = Math.min(config.dt, 0.02);
      const solver = new PhaseField2D(config);
      const stats = solver.step(4);
      expect(stats.unstable).toBe(false);
      expect(Number.isFinite(stats.minPhi)).toBe(true);
      expect(Number.isFinite(stats.maxPhi)).toBe(true);
      expect(Number.isFinite(stats.minTemperature)).toBe(true);
      expect(Number.isFinite(stats.maxTemperature)).toBe(true);
    }
  });

  it('keeps the Kobayashi Fig.7 target on the full paper grid for early time', () => {
    const config = clonePreset('paper-fig7-delta010');
    expect(config.nx).toBe(300);
    expect(config.ny).toBe(300);
    expect(config.dx).toBeCloseTo(0.03);
    expect(config.dt).toBeCloseTo(0.0002);
    expect(config.boundaryCondition).toBe('neumann');
    expect(config.nucleusPlacement).toBe('bottom-edge');
    expect(config.noiseAmplitude).toBeCloseTo(0.01);

    const solver = new PhaseField2D(config);
    const stats = solver.step(40);
    expect(stats.step).toBe(40);
    expect(stats.time).toBeCloseTo(0.008);
    expect(stats.unstable).toBe(false);
    expect(Number.isFinite(stats.minPhi)).toBe(true);
    expect(Number.isFinite(stats.maxPhi)).toBe(true);
    expect(Number.isFinite(stats.minTemperature)).toBe(true);
    expect(Number.isFinite(stats.maxTemperature)).toBe(true);
  });

  it('preserves left-right symmetry on the full Fig.7 grid when noise is disabled', () => {
    const config = clonePreset('paper-fig7-delta010');
    config.noiseAmplitude = 0;
    config.temperatureSolver = 'jacobi';
    const solver = new PhaseField2D(config);
    solver.step(40);
    expect(maxMirrorDifference2D(solver.phi, config.nx, config.ny)).toBeLessThan(1e-6);
    expect(maxMirrorDifference2D(solver.temperature, config.nx, config.ny)).toBeLessThan(1e-6);
  });

  it('preserves left-right symmetry for centered no-noise 2D growth', () => {
    const config = clonePreset('2d-fourfold');
    config.noiseAmplitude = 0;
    config.anisotropyAngle = 0;
    config.temperatureSolver = 'jacobi';
    const solver = new PhaseField2D(config);
    solver.step(120);
    expect(maxMirrorDifference2D(solver.phi, config.nx, config.ny)).toBeLessThan(1e-6);
    expect(maxMirrorDifference2D(solver.temperature, config.nx, config.ny)).toBeLessThan(1e-6);
  });

  it('preserves left-right symmetry for bottom-edge paper targets without noise', () => {
    const config = clonePreset('paper-fig7-delta010');
    config.nx = 96;
    config.ny = 96;
    config.nucleusRadius = 5;
    config.noiseAmplitude = 0;
    config.temperatureSolver = 'jacobi';
    const solver = new PhaseField2D(config);
    solver.step(120);
    expect(maxMirrorDifference2D(solver.phi, config.nx, config.ny)).toBeLessThan(1e-6);
    expect(maxMirrorDifference2D(solver.temperature, config.nx, config.ny)).toBeLessThan(1e-6);
  });

  it('applies fixed-temperature boundaries inside the solvers', () => {
    const config2D = clonePreset('paper-fig7-delta010');
    config2D.nx = 32;
    config2D.ny = 32;
    config2D.nucleusRadius = 4;
    config2D.boundaryCondition = 'fixed-temperature';
    config2D.initialTemperature = -0.25;
    config2D.boundaryTemperature = -0.25;
    const solver2D = new PhaseField2D(config2D);
    solver2D.step(3);
    expect(solver2D.temperature[index2D(0, 8, config2D.nx)]).toBeCloseTo(-0.25);
    expect(solver2D.temperature[index2D(8, 0, config2D.nx)]).toBeCloseTo(-0.25);

    const config3D = clonePreset('3d-isotropic');
    config3D.nx = 12;
    config3D.ny = 12;
    config3D.nz = 12;
    config3D.nucleusRadius = 2;
    config3D.boundaryCondition = 'fixed-temperature';
    config3D.initialTemperature = -0.25;
    config3D.boundaryTemperature = -0.25;
    const solver3D = new PhaseField3D(config3D);
    solver3D.step(2);
    expect(solver3D.temperature[index3D(0, 5, 5, config3D.nx, config3D.ny)]).toBeCloseTo(-0.25);
    expect(solver3D.temperature[index3D(5, 5, 0, config3D.nx, config3D.ny)]).toBeCloseTo(-0.25);
  });

  it('applies left-wall fixed temperature for the planar paper target', () => {
    const config = clonePreset('paper-fig4-planar-k100');
    expect(config.frontPerturbationModeCount).toBe(5);
    expect(config.frontPerturbationAmplitude).toBe(10);
    expect(config.frontPerturbationPhase).toBeCloseTo(Math.PI);
    config.nx = 48;
    config.ny = 16;
    const solver = new PhaseField2D(config);
    expect(solver.temperature[index2D(0, 8, config.nx)]).toBeCloseTo(0);
    expect(solver.temperature[index2D(8, 8, config.nx)]).toBeCloseTo(1);
    solver.step(2);
    expect(solver.temperature[index2D(0, 8, config.nx)]).toBeCloseTo(0);
  });

  it('includes the complete Kobayashi Fig.5 isotropic K series', () => {
    const fig5 = presets.filter((preset) => preset.id.startsWith('paper-fig5-'));
    expect(fig5.map((preset) => preset.latentHeat)).toEqual([0.8, 0.9, 1.0, 1.1, 1.2, 1.4, 1.6, 1.8, 2.0]);
  });

  it('includes the complete Kobayashi Fig.6 anisotropic K series', () => {
    const fig6 = presets.filter((preset) => preset.id.startsWith('paper-fig6-'));
    expect(fig6.map((preset) => preset.latentHeat)).toEqual([0.8, 0.9, 1.0, 1.1, 1.2, 1.4, 1.6, 1.8, 2.0]);
    expect(fig6.every((preset) => preset.anisotropyMode === 'fourFold')).toBe(true);
    expect(fig6.every((preset) => preset.anisotropyStrength === 0.05)).toBe(true);
  });

  it('tracks the estimated K2002 Fig.9-right 3D target mesh and K value', () => {
    const config = clonePreset('paper-fig9-3d-right-target');
    expect([config.nx, config.ny, config.nz]).toEqual([50, 50, 200]);
    expect(config.dx).toBeCloseTo(0.03);
    expect(config.dt).toBeCloseTo(0.0002);
    expect(config.latentHeat).toBeCloseTo(3.5);
    expect(config.nucleusRadius).toBeCloseTo(7);
    expect(config.nucleusPlacement).toBe('bottom-corner-halfcell');
  });

  it('tracks the reproduced K2002 Fig.9-left 3D target mesh and K value', () => {
    const config = clonePreset('paper-fig9-3d-left-target');
    expect([config.nx, config.ny, config.nz]).toEqual([160, 160, 100]);
    expect(config.dx).toBeCloseTo(0.03);
    expect(config.dt).toBeCloseTo(0.0002);
    expect(config.latentHeat).toBeCloseTo(2.5);
    expect(config.anisotropyStrength).toBeCloseTo(0);
    expect(config.noiseAmplitude).toBeCloseTo(0.01);
    expect(config.nucleusRadius).toBeCloseTo(7);
    expect(config.nucleusPlacement).toBe('bottom-face-center-halfcell');
  });

  it('initializes the Kobayashi Fig.3 target from all walls', () => {
    const config = clonePreset('paper-fig3-inward-walls');
    config.nx = 40;
    config.ny = 40;
    config.nucleusRadius = 4;
    const solver = new PhaseField2D(config);

    expect(config.boundaryCondition).toBe('fixed-temperature');
    expect(config.nucleusPlacement).toBe('walls');
    expect(solver.phi[index2D(0, 20, config.nx)]).toBeGreaterThan(0.99);
    expect(solver.phi[index2D(20, 0, config.nx)]).toBeGreaterThan(0.99);
    expect(solver.phi[index2D(20, 20, config.nx)]).toBeLessThan(1e-5);
  });

  it('places bottom-edge nuclei only on the bottom side of the simulation grid', () => {
    const config = clonePreset('paper-fig7-delta010');
    config.nx = 32;
    config.ny = 32;
    config.nucleusRadius = 4;
    const solver = new PhaseField2D(config);
    const topSolid = Array.from({ length: config.nx }, (_, x) => solver.phi[index2D(x, 0, config.nx)]).reduce((sum, value) => sum + value, 0);
    const bottomSolid = Array.from({ length: config.nx }, (_, x) => solver.phi[index2D(x, config.ny - 1, config.nx)]).reduce(
      (sum, value) => sum + value,
      0
    );
    expect(topSolid).toBeLessThan(1e-10);
    expect(bottomSolid).toBeGreaterThan(0);
  });

  it('places 2D bottom-corner nuclei at the lower-left Neumann corner', () => {
    const config = clonePreset('paper-fig9-no-noise');
    config.nx = 24;
    config.ny = 36;
    config.nucleusRadius = 4;
    config.nucleusPlacement = 'bottom-corner';
    const solver = new PhaseField2D(config);

    expect(solver.phi[index2D(0, config.ny - 1, config.nx)]).toBeGreaterThan(0.99);
    expect(solver.phi[index2D(config.nx - 1, config.ny - 1, config.nx)]).toBeLessThan(1e-4);
    expect(solver.phi[index2D(0, 0, config.nx)]).toBeLessThan(1e-4);
  });

  it('places the 3D quarter-domain nucleus at the x-y symmetry corner and z bottom', () => {
    const config = clonePreset('paper-fig9-3d-right-target');
    config.nx = 24;
    config.ny = 24;
    config.nz = 36;
    config.nucleusRadius = 4;
    const solver = new PhaseField3D(config);

    expect(config.nucleusPlacement).toBe('bottom-corner-halfcell');
    expect(config.renderMode3D).toBe('surface');
    expect(solver.phi[index3D(0, 0, 0, config.nx, config.ny)]).toBeGreaterThan(0.97);
    expect(solver.phi[index3D(config.nx - 1, 0, 0, config.nx, config.ny)]).toBeLessThan(1e-4);
    expect(solver.phi[index3D(0, config.ny - 1, 0, config.nx, config.ny)]).toBeLessThan(1e-4);
    expect(solver.phi[index3D(0, 0, config.nz - 1, config.nx, config.ny)]).toBeLessThan(1e-4);
  });

  it('places the 3D bottom-face-centered nucleus away from side corners', () => {
    const config = clonePreset('paper-fig9-3d-left-target');
    config.nx = 25;
    config.ny = 25;
    config.nz = 18;
    config.nucleusRadius = 4;
    const solver = new PhaseField3D(config);
    const cx = Math.floor(config.nx / 2);
    const cy = Math.floor(config.ny / 2);

    expect(config.nucleusPlacement).toBe('bottom-face-center-halfcell');
    expect(solver.phi[index3D(cx, cy, 0, config.nx, config.ny)]).toBeGreaterThan(0.97);
    expect(solver.phi[index3D(0, 0, 0, config.nx, config.ny)]).toBeLessThan(1e-4);
    expect(solver.phi[index3D(cx, cy, config.nz - 1, config.nx, config.ny)]).toBeLessThan(1e-4);
  });

  it('zeroes the paper-scheme anisotropic normal flux at physical boundaries', () => {
    const config = clonePreset('paper-fig7-delta010');
    config.nx = 16;
    config.ny = 16;
    config.anisotropyStrength = 0.05;
    const field = new Float32Array(config.nx * config.ny);
    for (let y = 0; y < config.ny; y += 1) {
      for (let x = 0; x < config.nx; x += 1) {
        field[index2D(x, y, config.nx)] = 0.25 + 0.02 * x + 0.01 * y;
      }
    }

    expect(paperSchemeFluxForTest2D(field, -1, 8, config).x).toBe(0);
    expect(paperSchemeFluxForTest2D(field, config.nx - 1, 8, config).x).toBe(0);
    expect(paperSchemeFluxForTest2D(field, 8, -1, config).y).toBe(0);
    expect(paperSchemeFluxForTest2D(field, 8, config.ny - 1, config).y).toBe(0);
    expect(Math.abs(paperSchemeFluxForTest2D(field, 8, 8, config).x)).toBeGreaterThan(0);
  });
});

function maxMirrorDifference2D(field: Float32Array, nx: number, ny: number): number {
  let maxDiff = 0;
  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < Math.floor(nx / 2); x += 1) {
      const left = field[index2D(x, y, nx)];
      const right = field[index2D(nx - 1 - x, y, nx)];
      maxDiff = Math.max(maxDiff, Math.abs(left - right));
    }
  }
  return maxDiff;
}
