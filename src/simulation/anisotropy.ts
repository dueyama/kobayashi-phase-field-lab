import type { AnisotropyMode } from './types';

export function anisotropy2D(
  gx: number,
  gy: number,
  mode: AnisotropyMode,
  strength: number,
  fold: number,
  angle: number
): number {
  if (mode === 'isotropic' || mode === 'cubic') return 1;
  return Math.max(0.35, anisotropySigma2D(gx, gy, mode, strength, fold, angle));
}

export function anisotropySigma2D(
  gx: number,
  gy: number,
  mode: AnisotropyMode,
  strength: number,
  fold: number,
  angle: number
): number {
  if (mode === 'isotropic' || mode === 'cubic') return 1;
  const theta = Math.atan2(-gy, -gx);
  const harmonic = mode === 'sixFold' ? 6 : fold || 4;
  return 1 + strength * Math.cos(harmonic * (theta - angle));
}

export function anisotropySigmaPrime2D(
  gx: number,
  gy: number,
  mode: AnisotropyMode,
  strength: number,
  fold: number,
  angle: number
): number {
  if (mode === 'isotropic' || mode === 'cubic') return 0;
  const theta = Math.atan2(-gy, -gx);
  const harmonic = mode === 'sixFold' ? 6 : fold || 4;
  return -strength * harmonic * Math.sin(harmonic * (theta - angle));
}

export function anisotropy3D(
  gx: number,
  gy: number,
  gz: number,
  mode: AnisotropyMode,
  strength: number,
  _fold = 4,
  _angle = 0
): number {
  if (mode === 'fourFold') {
    return anisotropySigma3DFourFold(gx, gy, gz, strength).sigma;
  }
  if (mode !== 'cubic') return 1;
  const mag = Math.hypot(gx, gy, gz) || 1;
  const nx = -gx / mag;
  const ny = -gy / mag;
  const nz = -gz / mag;
  const cubic = nx ** 4 + ny ** 4 + nz ** 4;
  return Math.max(0.35, 1 + strength * (4 * cubic - 1.45));
}

export function anisotropySigma3DFourFold(
  gx: number,
  gy: number,
  gz: number,
  strength: number
): { sigma: number; dSigmaDvX: number; dSigmaDvY: number; dSigmaDvZ: number } {
  const vx = -gx;
  const vy = -gy;
  const vz = -gz;
  const q = vx * vx + vy * vy + vz * vz;
  if (q < 1e-10 || strength === 0) {
    return { sigma: 1, dSigmaDvX: 0, dSigmaDvY: 0, dSigmaDvZ: 0 };
  }

  const vx2 = vx * vx;
  const vy2 = vy * vy;
  const vz2 = vz * vz;
  const s = vx2 * vx2 + vy2 * vy2 + vz2 * vz2;
  const q2 = q * q;
  const sigmaRaw = 1 + strength * (4 * s / q2 - 3);
  if (sigmaRaw < 0.35) {
    return { sigma: 0.35, dSigmaDvX: 0, dSigmaDvY: 0, dSigmaDvZ: 0 };
  }

  const derivativeScale = (16 * strength) / (q2 * q);
  return {
    sigma: sigmaRaw,
    dSigmaDvX: derivativeScale * vx * (vx2 * q - s),
    dSigmaDvY: derivativeScale * vy * (vy2 * q - s),
    dSigmaDvZ: derivativeScale * vz * (vz2 * q - s)
  };
}
