import type {
  IsosurfaceBuildRequest,
  IsosurfaceBuildResponse,
  IsosurfaceWorkerResponse
} from './isosurfaceWorker';

export type IsosurfaceBuildInput = Omit<IsosurfaceBuildRequest, 'id' | 'type'>;

export class IsosurfaceWorkerClient {
  private readonly worker = new Worker(new URL('./isosurfaceWorker.ts', import.meta.url), { type: 'module' });
  private requestId = 0;
  private readonly pending = new Map<number, { resolve: (response: IsosurfaceBuildResponse) => void; reject: (error: Error) => void }>();

  constructor() {
    this.worker.onmessage = (event: MessageEvent<IsosurfaceWorkerResponse>) => this.handleMessage(event.data);
    this.worker.onerror = (event: ErrorEvent) => this.rejectAll(new Error(event.message || 'Isosurface worker failed.'));
  }

  build(input: IsosurfaceBuildInput): Promise<IsosurfaceBuildResponse> {
    const id = this.requestId + 1;
    this.requestId = id;
    const request: IsosurfaceBuildRequest = { ...input, id, type: 'build' };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(request, [request.phi.buffer, request.temperature.buffer]);
    });
  }

  dispose(): void {
    this.rejectAll(new Error('Isosurface worker disposed.'));
    this.worker.terminate();
  }

  private handleMessage(response: IsosurfaceWorkerResponse): void {
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
