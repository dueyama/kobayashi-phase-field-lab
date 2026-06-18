export function index2D(x: number, y: number, nx: number): number {
  return x + nx * y;
}

export function index3D(x: number, y: number, z: number, nx: number, ny: number): number {
  return x + nx * (y + ny * z);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampIndex(value: number, maxExclusive: number): number {
  return Math.min(maxExclusive - 1, Math.max(0, value));
}

export function sample2D(field: Float32Array, x: number, y: number, nx: number, ny: number): number {
  return field[index2D(clampIndex(x, nx), clampIndex(y, ny), nx)];
}

export function sample3D(
  field: Float32Array,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number
): number {
  return field[index3D(clampIndex(x, nx), clampIndex(y, ny), clampIndex(z, nz), nx, ny)];
}

export function fillCircle(
  field: Float32Array,
  nx: number,
  ny: number,
  radius: number,
  insideValue: number,
  outsideValue: number
): void {
  const cx = (nx - 1) * 0.5;
  const cy = (ny - 1) * 0.5;
  const r2 = radius * radius;
  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      field[index2D(x, y, nx)] = dx * dx + dy * dy <= r2 ? insideValue : outsideValue;
    }
  }
}

export function fillCircleAt(
  field: Float32Array,
  nx: number,
  ny: number,
  radius: number,
  centerX: number,
  centerY: number,
  insideValue: number,
  outsideValue: number
): void {
  const r2 = radius * radius;
  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      field[index2D(x, y, nx)] = dx * dx + dy * dy <= r2 ? insideValue : outsideValue;
    }
  }
}

export function fillSmoothCircle(
  field: Float32Array,
  nx: number,
  ny: number,
  radius: number,
  interfaceWidth: number,
  insideValue: number,
  outsideValue: number
): void {
  const cx = (nx - 1) * 0.5;
  const cy = (ny - 1) * 0.5;
  fillSmoothCircleAt(field, nx, ny, radius, cx, cy, interfaceWidth, insideValue, outsideValue);
}

export function fillSmoothCircleAt(
  field: Float32Array,
  nx: number,
  ny: number,
  radius: number,
  centerX: number,
  centerY: number,
  interfaceWidth: number,
  insideValue: number,
  outsideValue: number
): void {
  const width = Math.max(0.5, interfaceWidth);
  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY);
      const solidFraction = 0.5 * (1 - Math.tanh((distance - radius) / width));
      field[index2D(x, y, nx)] = outsideValue + (insideValue - outsideValue) * solidFraction;
    }
  }
}

export function fillSmoothLeftWall(
  field: Float32Array,
  nx: number,
  ny: number,
  frontX: number,
  interfaceWidth: number,
  perturbationAmplitude: number,
  perturbationModeCount: number,
  perturbationPhase: number,
  insideValue: number,
  outsideValue: number
): void {
  const width = Math.max(0.5, interfaceWidth);
  const period = Math.max(1, ny - 1);
  const modes = Math.max(0, perturbationModeCount);
  for (let y = 0; y < ny; y += 1) {
    const phase = (2 * Math.PI * modes * y) / period + perturbationPhase;
    const perturbation = modes === 0 ? 0 : perturbationAmplitude * 0.5 * (1 - Math.cos(phase));
    for (let x = 0; x < nx; x += 1) {
      const signedDistance = x - frontX - perturbation;
      const solidFraction = 0.5 * (1 - Math.tanh(signedDistance / width));
      field[index2D(x, y, nx)] = outsideValue + (insideValue - outsideValue) * solidFraction;
    }
  }
}

export function fillSmoothWalls(
  field: Float32Array,
  nx: number,
  ny: number,
  wallThickness: number,
  interfaceWidth: number,
  insideValue: number,
  outsideValue: number
): void {
  const width = Math.max(0.5, interfaceWidth);
  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      const distanceToWall = Math.min(x, y, nx - 1 - x, ny - 1 - y);
      const solidFraction = 0.5 * (1 - Math.tanh((distanceToWall - wallThickness) / width));
      field[index2D(x, y, nx)] = outsideValue + (insideValue - outsideValue) * solidFraction;
    }
  }
}

export function fillSphere(
  field: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  radius: number,
  insideValue: number,
  outsideValue: number
): void {
  const cx = (nx - 1) * 0.5;
  const cy = (ny - 1) * 0.5;
  const cz = (nz - 1) * 0.5;
  const r2 = radius * radius;
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        const dz = z - cz;
        field[index3D(x, y, z, nx, ny)] = dx * dx + dy * dy + dz * dz <= r2 ? insideValue : outsideValue;
      }
    }
  }
}

export function fillSmoothSphereAt(
  field: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  radius: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  interfaceWidth: number,
  insideValue: number,
  outsideValue: number
): void {
  const width = Math.max(0.5, interfaceWidth);
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const distance = Math.hypot(x - centerX, y - centerY, z - centerZ);
        const solidFraction = 0.5 * (1 - Math.tanh((distance - radius) / width));
        field[index3D(x, y, z, nx, ny)] = outsideValue + (insideValue - outsideValue) * solidFraction;
      }
    }
  }
}

export function computeRange(field: Float32Array): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of field) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}
