import { computeRange } from './fields';
import { PhaseField3D } from './phaseField3D';
import type { AnisotropyMode, BoundaryCondition, PhaseFieldConfig, SimulationSnapshot, StepStats } from './types';
import { webGpuAvailability } from './phaseField2DWebGpu';

const PARAM_FLOATS_3D = 28;
const WORKGROUP_SIZE_X = 4;
const WORKGROUP_SIZE_Y = 4;
const WORKGROUP_SIZE_Z = 4;

type GpuRuntime = {
  adapter: GPUAdapter;
  device: GPUDevice;
};

export class PhaseField3DWebGpu {
  readonly config: PhaseFieldConfig;
  readonly phi: Float32Array;
  readonly temperature: Float32Array;

  private readonly cpuInitialState: PhaseField3D;
  private readonly device: GPUDevice;
  private readonly pipeline: GPUComputePipeline;
  private readonly paramsBuffer: GPUBuffer;
  private readonly phiBuffers: [GPUBuffer, GPUBuffer];
  private readonly temperatureBuffers: [GPUBuffer, GPUBuffer];
  private readonly readPhiBuffer: GPUBuffer;
  private readonly readTemperatureBuffer: GPUBuffer;
  private readonly bindGroups: [GPUBindGroup, GPUBindGroup];
  private activeBuffer = 0;
  private stepIndex = 0;
  private elapsed = 0;
  private currentStats: StepStats = {
    step: 0,
    time: 0,
    minPhi: 0,
    maxPhi: 1,
    minTemperature: 0,
    maxTemperature: 0,
    unstable: false
  };

  private constructor(config: PhaseFieldConfig, runtime: GpuRuntime) {
    this.config = { ...config, dimension: '3d', solverBackend: 'webgpu-experimental' };
    this.cpuInitialState = new PhaseField3D(this.config);
    const snapshot = this.cpuInitialState.snapshot();
    const cells = this.config.nx * this.config.ny * this.config.nz;
    const byteLength = cells * Float32Array.BYTES_PER_ELEMENT;
    this.phi = new Float32Array(snapshot.phi);
    this.temperature = new Float32Array(snapshot.temperature);
    this.device = runtime.device;

    const shaderModule = this.device.createShaderModule({ code: webGpu3DStepShader() });
    this.pipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });

    this.paramsBuffer = this.device.createBuffer({
      size: PARAM_FLOATS_3D * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.phiBuffers = [this.createFieldBuffer(byteLength), this.createFieldBuffer(byteLength)];
    this.temperatureBuffers = [this.createFieldBuffer(byteLength), this.createFieldBuffer(byteLength)];
    this.readPhiBuffer = this.device.createBuffer({
      size: byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    this.readTemperatureBuffer = this.device.createBuffer({
      size: byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    this.bindGroups = [
      this.createBindGroup(this.phiBuffers[0], this.temperatureBuffers[0], this.phiBuffers[1], this.temperatureBuffers[1]),
      this.createBindGroup(this.phiBuffers[1], this.temperatureBuffers[1], this.phiBuffers[0], this.temperatureBuffers[0])
    ];
    this.reset();
  }

  static async create(config: PhaseFieldConfig): Promise<PhaseField3DWebGpu> {
    const availability = webGpuAvailability();
    if (!availability.available) {
      throw new Error(availability.reason ?? 'WebGPU is not available.');
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter is available.');
    const device = await adapter.requestDevice();
    return new PhaseField3DWebGpu(config, { adapter, device });
  }

  reset(): void {
    this.cpuInitialState.reset();
    const snapshot = this.cpuInitialState.snapshot();
    this.phi.set(snapshot.phi);
    this.temperature.set(snapshot.temperature);
    this.device.queue.writeBuffer(this.phiBuffers[0], 0, this.phi);
    this.device.queue.writeBuffer(this.temperatureBuffers[0], 0, this.temperature);
    this.activeBuffer = 0;
    this.stepIndex = 0;
    this.elapsed = 0;
    this.currentStats = this.calculateStats();
  }

  async step(count = 1): Promise<StepStats> {
    for (let i = 0; i < count; i += 1) {
      this.writeParams();
      const outputBuffer = this.activeBuffer === 0 ? 1 : 0;
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroups[this.activeBuffer]);
      pass.dispatchWorkgroups(
        Math.ceil(this.config.nx / WORKGROUP_SIZE_X),
        Math.ceil(this.config.ny / WORKGROUP_SIZE_Y),
        Math.ceil(this.config.nz / WORKGROUP_SIZE_Z)
      );
      pass.end();
      this.device.queue.submit([encoder.finish()]);
      this.activeBuffer = outputBuffer;
      this.stepIndex += 1;
      this.elapsed += this.config.dt;
    }
    await this.device.queue.onSubmittedWorkDone();
    await this.readBackFields();
    this.currentStats = this.calculateStats();
    return this.currentStats;
  }

  snapshot(): SimulationSnapshot {
    return {
      dimension: '3d',
      nx: this.config.nx,
      ny: this.config.ny,
      nz: this.config.nz,
      phi: this.phi,
      temperature: this.temperature,
      step: this.stepIndex,
      time: this.elapsed,
      minPhi: this.currentStats.minPhi,
      maxPhi: this.currentStats.maxPhi,
      minTemperature: this.currentStats.minTemperature,
      maxTemperature: this.currentStats.maxTemperature
    };
  }

  dispose(): void {
    this.paramsBuffer.destroy();
    for (const buffer of this.phiBuffers) buffer.destroy();
    for (const buffer of this.temperatureBuffers) buffer.destroy();
    this.readPhiBuffer.destroy();
    this.readTemperatureBuffer.destroy();
    this.device.destroy();
  }

  private createFieldBuffer(byteLength: number): GPUBuffer {
    return this.device.createBuffer({
      size: byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });
  }

  private createBindGroup(
    phiIn: GPUBuffer,
    temperatureIn: GPUBuffer,
    phiOut: GPUBuffer,
    temperatureOut: GPUBuffer
  ): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: phiIn } },
        { binding: 1, resource: { buffer: temperatureIn } },
        { binding: 2, resource: { buffer: phiOut } },
        { binding: 3, resource: { buffer: temperatureOut } },
        { binding: 4, resource: { buffer: this.paramsBuffer } }
      ]
    });
  }

  private writeParams(): void {
    const params = new Float32Array(PARAM_FLOATS_3D);
    params[0] = this.config.nx;
    params[1] = this.config.ny;
    params[2] = this.config.nz;
    params[3] = this.config.dx;
    params[4] = this.config.dt;
    params[5] = this.config.tau;
    params[6] = this.config.diffusivity;
    params[7] = this.config.temperatureDiffusivity;
    params[8] = this.config.latentHeat;
    params[9] = this.config.undercooling;
    params[10] = this.config.driveAlpha;
    params[11] = this.config.driveGamma;
    params[12] = this.config.anisotropyStrength;
    params[13] = this.config.anisotropyFold;
    params[14] = this.config.anisotropyAngle;
    params[15] = scaledNoiseAmplitude(this.config);
    params[16] = this.config.seed;
    params[17] = this.stepIndex;
    params[18] = boundaryModeId(this.config.boundaryCondition);
    params[19] = this.config.boundaryTemperature;
    params[20] = anisotropyModeId(this.config.anisotropyMode);
    this.device.queue.writeBuffer(this.paramsBuffer, 0, params);
  }

  private async readBackFields(): Promise<void> {
    const sourcePhi = this.phiBuffers[this.activeBuffer];
    const sourceTemperature = this.temperatureBuffers[this.activeBuffer];
    const byteLength = this.phi.byteLength;
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(sourcePhi, 0, this.readPhiBuffer, 0, byteLength);
    encoder.copyBufferToBuffer(sourceTemperature, 0, this.readTemperatureBuffer, 0, byteLength);
    this.device.queue.submit([encoder.finish()]);
    await Promise.all([
      this.readPhiBuffer.mapAsync(GPUMapMode.READ),
      this.readTemperatureBuffer.mapAsync(GPUMapMode.READ)
    ]);
    this.phi.set(new Float32Array(this.readPhiBuffer.getMappedRange()));
    this.temperature.set(new Float32Array(this.readTemperatureBuffer.getMappedRange()));
    this.readPhiBuffer.unmap();
    this.readTemperatureBuffer.unmap();
  }

  private calculateStats(): StepStats {
    const phiRange = computeRange(this.phi);
    const tempRange = computeRange(this.temperature);
    const unstable =
      !Number.isFinite(phiRange.min) ||
      !Number.isFinite(phiRange.max) ||
      !Number.isFinite(tempRange.min) ||
      !Number.isFinite(tempRange.max) ||
      phiRange.min < -0.5 ||
      phiRange.max > 1.5 ||
      Math.max(Math.abs(tempRange.min), Math.abs(tempRange.max)) > 10;
    return {
      step: this.stepIndex,
      time: this.elapsed,
      minPhi: phiRange.min,
      maxPhi: phiRange.max,
      minTemperature: tempRange.min,
      maxTemperature: tempRange.max,
      unstable
    };
  }
}

function boundaryModeId(boundaryCondition: BoundaryCondition): number {
  if (boundaryCondition === 'fixed-temperature') return 1;
  if (boundaryCondition === 'left-fixed-temperature') return 2;
  return 0;
}

function anisotropyModeId(mode: AnisotropyMode): number {
  if (mode === 'fourFold') return 1;
  if (mode === 'cubic') return 2;
  return 0;
}

function scaledNoiseAmplitude(config: PhaseFieldConfig): number {
  if (config.noiseAmplitude === 0) return 0;
  return config.noiseAmplitude * Math.sqrt(Math.max(0, (config.noiseReferenceDt ?? config.dt) / config.dt));
}

function webGpu3DStepShader(): string {
  return `
struct Field {
  values: array<f32>
};

struct Params {
  values: array<f32>
};

@group(0) @binding(0) var<storage, read> phiIn: Field;
@group(0) @binding(1) var<storage, read> tempIn: Field;
@group(0) @binding(2) var<storage, read_write> phiOut: Field;
@group(0) @binding(3) var<storage, read_write> tempOut: Field;
@group(0) @binding(4) var<storage, read> params: Params;

const PI: f32 = 3.141592653589793;

fn nx() -> i32 { return i32(params.values[0]); }
fn ny() -> i32 { return i32(params.values[1]); }
fn nz() -> i32 { return i32(params.values[2]); }

fn idx(x: i32, y: i32, z: i32) -> u32 {
  return u32(x + nx() * (y + ny() * z));
}

fn clampIndex(value: i32, maxExclusive: i32) -> i32 {
  return min(max(value, 0), maxExclusive - 1);
}

fn samplePhi(x: i32, y: i32, z: i32) -> f32 {
  return phiIn.values[idx(clampIndex(x, nx()), clampIndex(y, ny()), clampIndex(z, nz()))];
}

fn sampleTemp(x: i32, y: i32, z: i32) -> f32 {
  return tempIn.values[idx(clampIndex(x, nx()), clampIndex(y, ny()), clampIndex(z, nz()))];
}

fn laplacianPhi(x: i32, y: i32, z: i32) -> f32 {
  let dx = params.values[3];
  let center = samplePhi(x, y, z);
  return (
    samplePhi(x + 1, y, z) + samplePhi(x - 1, y, z) +
    samplePhi(x, y + 1, z) + samplePhi(x, y - 1, z) +
    samplePhi(x, y, z + 1) + samplePhi(x, y, z - 1) -
    6.0 * center
  ) / (dx * dx);
}

fn laplacianTemp(x: i32, y: i32, z: i32) -> f32 {
  let dx = params.values[3];
  let center = sampleTemp(x, y, z);
  return (
    sampleTemp(x + 1, y, z) + sampleTemp(x - 1, y, z) +
    sampleTemp(x, y + 1, z) + sampleTemp(x, y - 1, z) +
    sampleTemp(x, y, z + 1) + sampleTemp(x, y, z - 1) -
    6.0 * center
  ) / (dx * dx);
}

fn sigmaFourFold(gx: f32, gy: f32, gz: f32) -> vec4<f32> {
  let strength = params.values[12];
  let vx = -gx;
  let vy = -gy;
  let vz = -gz;
  let q = vx * vx + vy * vy + vz * vz;
  if (q < 1.0e-10 || strength == 0.0) {
    return vec4<f32>(1.0, 0.0, 0.0, 0.0);
  }
  let vx2 = vx * vx;
  let vy2 = vy * vy;
  let vz2 = vz * vz;
  let s = vx2 * vx2 + vy2 * vy2 + vz2 * vz2;
  let q2 = q * q;
  let sigmaRaw = 1.0 + strength * (4.0 * s / q2 - 3.0);
  if (sigmaRaw < 0.35) {
    return vec4<f32>(0.35, 0.0, 0.0, 0.0);
  }
  let derivativeScale = (16.0 * strength) / (q2 * q);
  return vec4<f32>(
    sigmaRaw,
    derivativeScale * vx * (vx2 * q - s),
    derivativeScale * vy * (vy2 * q - s),
    derivativeScale * vz * (vz2 * q - s)
  );
}

fn sigmaCubic(gx: f32, gy: f32, gz: f32) -> f32 {
  let strength = params.values[12];
  let mag = max(sqrt(gx * gx + gy * gy + gz * gz), 1.0e-10);
  let mx = -gx / mag;
  let my = -gy / mag;
  let mz = -gz / mag;
  let cubic = mx * mx * mx * mx + my * my * my * my + mz * mz * mz * mz;
  return max(0.35, 1.0 + strength * (4.0 * cubic - 1.45));
}

fn anisotropicFluxFromGradient(gx: f32, gy: f32, gz: f32) -> vec3<f32> {
  let values = sigmaFourFold(gx, gy, gz);
  let sigma = values.x;
  let grad2 = gx * gx + gy * gy + gz * gz;
  let sigma2 = sigma * sigma;
  return vec3<f32>(
    sigma2 * gx - grad2 * sigma * values.y,
    sigma2 * gy - grad2 * sigma * values.z,
    sigma2 * gz - grad2 * sigma * values.w
  );
}

fn fluxX(x: i32, y: i32, z: i32) -> f32 {
  if (x < 0 || x >= nx() - 1) {
    return 0.0;
  }
  let dx = params.values[3];
  let gx = (samplePhi(x + 1, y, z) - samplePhi(x, y, z)) / dx;
  let gy = (
    samplePhi(x, y + 1, z) + samplePhi(x + 1, y + 1, z) -
    samplePhi(x, y - 1, z) - samplePhi(x + 1, y - 1, z)
  ) / (4.0 * dx);
  let gz = (
    samplePhi(x, y, z + 1) + samplePhi(x + 1, y, z + 1) -
    samplePhi(x, y, z - 1) - samplePhi(x + 1, y, z - 1)
  ) / (4.0 * dx);
  return params.values[6] * anisotropicFluxFromGradient(gx, gy, gz).x;
}

fn fluxY(x: i32, y: i32, z: i32) -> f32 {
  if (y < 0 || y >= ny() - 1) {
    return 0.0;
  }
  let dx = params.values[3];
  let gx = (
    samplePhi(x + 1, y, z) + samplePhi(x + 1, y + 1, z) -
    samplePhi(x - 1, y, z) - samplePhi(x - 1, y + 1, z)
  ) / (4.0 * dx);
  let gy = (samplePhi(x, y + 1, z) - samplePhi(x, y, z)) / dx;
  let gz = (
    samplePhi(x, y, z + 1) + samplePhi(x, y + 1, z + 1) -
    samplePhi(x, y, z - 1) - samplePhi(x, y + 1, z - 1)
  ) / (4.0 * dx);
  return params.values[6] * anisotropicFluxFromGradient(gx, gy, gz).y;
}

fn fluxZ(x: i32, y: i32, z: i32) -> f32 {
  if (z < 0 || z >= nz() - 1) {
    return 0.0;
  }
  let dx = params.values[3];
  let gx = (
    samplePhi(x + 1, y, z) + samplePhi(x + 1, y, z + 1) -
    samplePhi(x - 1, y, z) - samplePhi(x - 1, y, z + 1)
  ) / (4.0 * dx);
  let gy = (
    samplePhi(x, y + 1, z) + samplePhi(x, y + 1, z + 1) -
    samplePhi(x, y - 1, z) - samplePhi(x, y - 1, z + 1)
  ) / (4.0 * dx);
  let gz = (samplePhi(x, y, z + 1) - samplePhi(x, y, z)) / dx;
  return params.values[6] * anisotropicFluxFromGradient(gx, gy, gz).z;
}

fn anisotropicDiffusion(x: i32, y: i32, z: i32) -> f32 {
  let mode = i32(params.values[20]);
  let strength = params.values[12];
  if (mode == 1 && strength != 0.0) {
    return (fluxX(x, y, z) - fluxX(x - 1, y, z) + fluxY(x, y, z) - fluxY(x, y - 1, z) + fluxZ(x, y, z) - fluxZ(x, y, z - 1)) / params.values[3];
  }
  let lapPhi = laplacianPhi(x, y, z);
  if (mode == 2 && strength != 0.0) {
    let dx = params.values[3];
    let gx = (samplePhi(x + 1, y, z) - samplePhi(x - 1, y, z)) / (2.0 * dx);
    let gy = (samplePhi(x, y + 1, z) - samplePhi(x, y - 1, z)) / (2.0 * dx);
    let gz = (samplePhi(x, y, z + 1) - samplePhi(x, y, z - 1)) / (2.0 * dx);
    let sigma = sigmaCubic(gx, gy, gz);
    return params.values[6] * sigma * sigma * lapPhi;
  }
  return params.values[6] * lapPhi;
}

fn deterministicNoise(index: u32, step: u32, seed: u32) -> f32 {
  var x = seed ^ ((index + 0x9e3779b9u) * 0x85ebca6bu) ^ ((step + 1u) * 0xc2b2ae35u);
  x = x ^ (x >> 16u);
  x = x * 0x7feb352du;
  x = x ^ (x >> 15u);
  x = x * 0x846ca68bu;
  x = x ^ (x >> 16u);
  return f32(x) / 4294967296.0 - 0.5;
}

@compute @workgroup_size(${WORKGROUP_SIZE_X}, ${WORKGROUP_SIZE_Y}, ${WORKGROUP_SIZE_Z})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let x = i32(globalId.x);
  let y = i32(globalId.y);
  let z = i32(globalId.z);
  if (x >= nx() || y >= ny() || z >= nz()) {
    return;
  }

  let i = idx(x, y, z);
  let phi = phiIn.values[i];
  let temp = tempIn.values[i];
  let drive = (params.values[10] / PI) * atan(params.values[11] * (params.values[9] - temp));
  let reaction = phi * (1.0 - phi) * (phi - 0.5 + drive);
  let noise = params.values[15] * phi * (1.0 - phi) * deterministicNoise(i, u32(params.values[17]), u32(params.values[16]));
  let dPhiDt = (anisotropicDiffusion(x, y, z) + reaction + noise) / params.values[5];
  let nextPhi = clamp(phi + params.values[4] * dPhiDt, -0.05, 1.05);
  phiOut.values[i] = nextPhi;

  var nextTemp = temp + params.values[4] * params.values[7] * laplacianTemp(x, y, z) + params.values[8] * (nextPhi - phi);
  let boundaryMode = i32(params.values[18]);
  if ((boundaryMode == 1 && (x == 0 || x == nx() - 1 || y == 0 || y == ny() - 1 || z == 0 || z == nz() - 1)) || (boundaryMode == 2 && x == 0)) {
    nextTemp = params.values[19];
  }
  tempOut.values[i] = clamp(nextTemp, -4.0, 4.0);
}
`;
}
