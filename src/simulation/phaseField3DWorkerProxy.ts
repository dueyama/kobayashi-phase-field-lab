import type { PhaseFieldConfig, SimulationSnapshot, StepStats } from './types';

type WorkerRequest =
  | { id: number; type: 'init'; config: PhaseFieldConfig }
  | { id: number; type: 'step'; count: number }
  | { id: number; type: 'snapshot' };

type WorkerRequestPayload =
  | { type: 'init'; config: PhaseFieldConfig }
  | { type: 'step'; count: number }
  | { type: 'snapshot' };

type WorkerStepResponse = { id: number; type: 'step'; stats: StepStats; snapshot: SimulationSnapshot };
type WorkerSnapshotResponse = { id: number; type: 'ready' | 'snapshot'; snapshot: SimulationSnapshot };
type WorkerErrorResponse = { id: number; type: 'error'; message: string };
type WorkerResponse = WorkerStepResponse | WorkerSnapshotResponse | WorkerErrorResponse;

export class PhaseField3DWorkerProxy {
  readonly config: PhaseFieldConfig;
  private readonly worker: Worker;
  private requestId = 0;
  private readonly pending = new Map<number, { resolve: (response: WorkerResponse) => void; reject: (error: Error) => void }>();
  private latestSnapshot: SimulationSnapshot | null = null;

  private constructor(config: PhaseFieldConfig) {
    this.config = { ...config, dimension: '3d' };
    this.worker = new Worker(new URL('./phaseField3D.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleMessage(event.data);
    this.worker.onerror = (event: ErrorEvent) => this.rejectAll(new Error(event.message || '3D worker failed.'));
  }

  static async create(config: PhaseFieldConfig): Promise<PhaseField3DWorkerProxy> {
    const proxy = new PhaseField3DWorkerProxy(config);
    const response = await proxy.request({ type: 'init', config: proxy.config });
    if (response.type !== 'ready') throw new Error(`Unexpected 3D worker response: ${response.type}`);
    proxy.latestSnapshot = response.snapshot;
    return proxy;
  }

  async step(count = 1): Promise<StepStats> {
    const response = await this.request({ type: 'step', count });
    if (response.type !== 'step') throw new Error(`Unexpected 3D worker response: ${response.type}`);
    this.latestSnapshot = response.snapshot;
    return response.stats;
  }

  snapshot(): SimulationSnapshot {
    if (!this.latestSnapshot) throw new Error('3D worker snapshot is not ready.');
    return this.latestSnapshot;
  }

  dispose(): void {
    this.rejectAll(new Error('3D worker disposed.'));
    this.worker.terminate();
  }

  private request(payload: WorkerRequestPayload): Promise<WorkerResponse> {
    const id = this.requestId + 1;
    this.requestId = id;
    const request = { ...payload, id } as WorkerRequest;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(request);
    });
  }

  private handleMessage(response: WorkerResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.type === 'error') {
      pending.reject(new Error(response.message));
    } else {
      pending.resolve(response);
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
