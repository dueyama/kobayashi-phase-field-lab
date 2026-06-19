import { PhaseField2D } from './phaseField2D';
import { computeRange } from './fields';
import type { AnisotropyMode, BoundaryCondition, PhaseFieldConfig, SimulationSnapshot, StepStats } from './types';

const PARAM_FLOATS = 24;
const WORKGROUP_SIZE_X = 16;
const WORKGROUP_SIZE_Y = 16;

type GpuRuntime = {
  adapter: GPUAdapter;
  device: GPUDevice;
};

export type WebGpuAvailability = {
  available: boolean;
  reason?: string;
};

export function webGpuAvailability(): WebGpuAvailability {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { available: false, reason: 'WebGPU needs a browser runtime.' };
  }
  if (!window.isSecureContext) {
    return { available: false, reason: 'WebGPU requires HTTPS or localhost.' };
  }
  if (!('gpu' in navigator)) {
    return { available: false, reason: 'navigator.gpu is not available in this browser.' };
  }
  return { available: true };
}

export class PhaseField2DWebGpu {
  readonly config: PhaseFieldConfig;
  readonly phi: Float32Array;
  readonly temperature: Float32Array;

  private readonly cpuInitialState: PhaseField2D;
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
    this.config = { ...config, dimension: '2d', nz: 1, solverBackend: 'webgpu-experimental' };
    this.cpuInitialState = new PhaseField2D(this.config);
    const snapshot = this.cpuInitialState.snapshot();
    const cells = this.config.nx * this.config.ny;
    const byteLength = cells * Float32Array.BYTES_PER_ELEMENT;
    this.phi = new Float32Array(snapshot.phi);
    this.temperature = new Float32Array(snapshot.temperature);
    this.device = runtime.device;

    const shaderModule = this.device.createShaderModule({ code: webGpu2DStepShader() });
    this.pipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });

    this.paramsBuffer = this.device.createBuffer({
      size: PARAM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
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

  static async create(config: PhaseFieldConfig): Promise<PhaseField2DWebGpu> {
    const availability = webGpuAvailability();
    if (!availability.available) {
      throw new Error(availability.reason ?? 'WebGPU is not available.');
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter is available.');
    const device = await adapter.requestDevice();
    return new PhaseField2DWebGpu(config, { adapter, device });
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
        Math.ceil(this.config.ny / WORKGROUP_SIZE_Y)
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
      dimension: '2d',
      nx: this.config.nx,
      ny: this.config.ny,
      nz: 1,
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
    const params = new Float32Array(PARAM_FLOATS);
    params[0] = this.config.nx;
    params[1] = this.config.ny;
    params[2] = this.config.dx;
    params[3] = this.config.dt;
    params[4] = this.config.tau;
    params[5] = this.config.diffusivity;
    params[6] = this.config.temperatureDiffusivity;
    params[7] = this.config.latentHeat;
    params[8] = this.config.undercooling;
    params[9] = this.config.driveAlpha;
    params[10] = this.config.driveGamma;
    params[11] = this.config.anisotropyStrength;
    params[12] = this.config.anisotropyFold;
    params[13] = this.config.anisotropyAngle;
    params[14] = scaledNoiseAmplitude(this.config);
    params[15] = this.config.seed;
    params[16] = this.stepIndex;
    params[17] = boundaryModeId(this.config.boundaryCondition);
    params[18] = this.config.boundaryTemperature;
    params[19] = anisotropyModeId(this.config.anisotropyMode);
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
  if (mode === 'sixFold') return 2;
  return 0;
}

function scaledNoiseAmplitude(config: PhaseFieldConfig): number {
  if (config.noiseAmplitude === 0) return 0;
  return config.noiseAmplitude * Math.sqrt(Math.max(0, (config.noiseReferenceDt ?? config.dt) / config.dt));
}

function webGpu2DStepShader(): string {
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

fn idx(x: i32, y: i32) -> u32 {
  return u32(x + nx() * y);
}

fn clampIndex(value: i32, maxExclusive: i32) -> i32 {
  return min(max(value, 0), maxExclusive - 1);
}

fn samplePhi(x: i32, y: i32) -> f32 {
  return phiIn.values[idx(clampIndex(x, nx()), clampIndex(y, ny()))];
}

fn sampleTemp(x: i32, y: i32) -> f32 {
  return tempIn.values[idx(clampIndex(x, nx()), clampIndex(y, ny()))];
}

fn laplacianTemp(x: i32, y: i32) -> f32 {
  let dx = params.values[2];
  let center = sampleTemp(x, y);
  return (sampleTemp(x + 1, y) + sampleTemp(x - 1, y) + sampleTemp(x, y + 1) + sampleTemp(x, y - 1) - 4.0 * center) / (dx * dx);
}

fn laplacianPhi(x: i32, y: i32) -> f32 {
  let dx = params.values[2];
  let center = samplePhi(x, y);
  return (samplePhi(x + 1, y) + samplePhi(x - 1, y) + samplePhi(x, y + 1) + samplePhi(x, y - 1) - 4.0 * center) / (dx * dx);
}

fn anisotropySigma(gx: f32, gy: f32) -> f32 {
  let mode = i32(params.values[19]);
  if (mode == 0) {
    return 1.0;
  }
  if (gx * gx + gy * gy < 1.0e-20) {
    return 1.0;
  }
  let strength = params.values[11];
  let fold = select(params.values[12], 6.0, mode == 2);
  let angle = params.values[13];
  let theta = atan2(-gy, -gx);
  return max(0.35, 1.0 + strength * cos(fold * (theta - angle)));
}

fn anisotropySigmaPrime(gx: f32, gy: f32) -> f32 {
  let mode = i32(params.values[19]);
  if (mode == 0) {
    return 0.0;
  }
  if (gx * gx + gy * gy < 1.0e-20) {
    return 0.0;
  }
  let strength = params.values[11];
  let fold = select(params.values[12], 6.0, mode == 2);
  let angle = params.values[13];
  let theta = atan2(-gy, -gx);
  return -strength * fold * sin(fold * (theta - angle));
}

fn fluxX(x: i32, y: i32) -> f32 {
  if (x < 0 || x >= nx() - 1) {
    return 0.0;
  }
  let dx = params.values[2];
  let diffusivity = params.values[5];
  let gx = (samplePhi(x + 1, y) - samplePhi(x, y)) / dx;
  let gy = (samplePhi(x, y + 1) + samplePhi(x + 1, y + 1) - samplePhi(x, y - 1) - samplePhi(x + 1, y - 1)) / (4.0 * dx);
  let sigma = anisotropySigma(gx, gy);
  let sigmaPrime = anisotropySigmaPrime(gx, gy);
  return diffusivity * sigma * (sigma * gx - sigmaPrime * gy);
}

fn fluxY(x: i32, y: i32) -> f32 {
  if (y < 0 || y >= ny() - 1) {
    return 0.0;
  }
  let dx = params.values[2];
  let diffusivity = params.values[5];
  let gx = (samplePhi(x + 1, y) + samplePhi(x + 1, y + 1) - samplePhi(x - 1, y) - samplePhi(x - 1, y + 1)) / (4.0 * dx);
  let gy = (samplePhi(x, y + 1) - samplePhi(x, y)) / dx;
  let sigma = anisotropySigma(gx, gy);
  let sigmaPrime = anisotropySigmaPrime(gx, gy);
  return diffusivity * sigma * (sigma * gy + sigmaPrime * gx);
}

fn anisotropicDiffusion(x: i32, y: i32) -> f32 {
  let mode = i32(params.values[19]);
  let strength = params.values[11];
  if (mode == 0 || strength == 0.0) {
    return params.values[5] * laplacianPhi(x, y);
  }
  return (fluxX(x, y) - fluxX(x - 1, y) + fluxY(x, y) - fluxY(x, y - 1)) / params.values[2];
}

fn deterministicNoise(index: u32, step: u32, seed: u32) -> f32 {
  var x = seed ^ ((index + 0x9e3779b9u) * 0x85ebca6bu) ^ ((step + 1u) * 0xc2b2ae35u);
  x = x ^ (x >> 16u);
  x = x * 0x7feb352du;
  x = x ^ (x >> 15u);
  x = x * 0x846ca68bu;
  x = x ^ (x >> 16u);
  return (f32(x) / 4294967295.0) * 2.0 - 1.0;
}

@compute @workgroup_size(${WORKGROUP_SIZE_X}, ${WORKGROUP_SIZE_Y}, 1)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let x = i32(globalId.x);
  let y = i32(globalId.y);
  if (x >= nx() || y >= ny()) {
    return;
  }

  let i = idx(x, y);
  let phi = phiIn.values[i];
  let temp = tempIn.values[i];
  let drive = (params.values[9] / PI) * atan(params.values[10] * (params.values[8] - temp));
  let reaction = phi * (1.0 - phi) * (phi - 0.5 + drive);
  let noise = params.values[14] * phi * (1.0 - phi) * deterministicNoise(i, u32(params.values[16]), u32(params.values[15]));
  let dPhiDt = (anisotropicDiffusion(x, y) + reaction + noise) / params.values[4];
  let nextPhi = clamp(phi + params.values[3] * dPhiDt, -0.05, 1.05);
  phiOut.values[i] = nextPhi;

  var nextTemp = temp + params.values[3] * params.values[6] * laplacianTemp(x, y) + params.values[7] * (nextPhi - phi);
  let boundaryMode = i32(params.values[17]);
  if ((boundaryMode == 1 && (x == 0 || x == nx() - 1 || y == 0 || y == ny() - 1)) || (boundaryMode == 2 && x == 0)) {
    nextTemp = params.values[18];
  }
  tempOut.values[i] = clamp(nextTemp, -4.0, 4.0);
}
`;
}
