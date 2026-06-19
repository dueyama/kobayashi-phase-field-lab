interface Navigator {
  gpu: GPU;
}

interface GPU {
  requestAdapter(): Promise<GPUAdapter | null>;
}

interface GPUAdapter {
  requestDevice(): Promise<GPUDevice>;
}

interface GPUDevice {
  queue: GPUQueue;
  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
  createComputePipeline(descriptor: GPUComputePipelineDescriptor): GPUComputePipeline;
  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
  createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
  createCommandEncoder(): GPUCommandEncoder;
  destroy(): void;
}

interface GPUQueue {
  writeBuffer(buffer: GPUBuffer, bufferOffset: number, data: ArrayBufferView<ArrayBufferLike> | ArrayBufferLike): void;
  submit(commandBuffers: GPUCommandBuffer[]): void;
  onSubmittedWorkDone(): Promise<void>;
}

interface GPUShaderModule {}

interface GPUComputePipeline {
  getBindGroupLayout(index: number): GPUBindGroupLayout;
}

interface GPUBindGroup {}

interface GPUBindGroupLayout {}

interface GPUBuffer {
  readonly size: number;
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

interface GPUCommandEncoder {
  beginComputePass(): GPUComputePassEncoder;
  copyBufferToBuffer(source: GPUBuffer, sourceOffset: number, destination: GPUBuffer, destinationOffset: number, size: number): void;
  finish(): GPUCommandBuffer;
}

interface GPUComputePassEncoder {
  setPipeline(pipeline: GPUComputePipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup): void;
  dispatchWorkgroups(workgroupCountX: number, workgroupCountY?: number, workgroupCountZ?: number): void;
  end(): void;
}

interface GPUCommandBuffer {}

interface GPUShaderModuleDescriptor {
  code: string;
}

interface GPUComputePipelineDescriptor {
  layout: 'auto';
  compute: {
    module: GPUShaderModule;
    entryPoint: string;
  };
}

interface GPUBufferDescriptor {
  size: number;
  usage: number;
}

interface GPUBindGroupDescriptor {
  layout: GPUBindGroupLayout;
  entries: GPUBindGroupEntry[];
}

interface GPUBindGroupEntry {
  binding: number;
  resource: {
    buffer: GPUBuffer;
  };
}

declare const GPUBufferUsage: {
  MAP_READ: number;
  COPY_SRC: number;
  COPY_DST: number;
  STORAGE: number;
};

declare const GPUMapMode: {
  READ: number;
};
