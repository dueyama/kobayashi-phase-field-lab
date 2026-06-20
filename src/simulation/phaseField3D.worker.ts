import { PhaseField3D } from './phaseField3D';
import type { PhaseFieldConfig, SimulationSnapshot, StepStats } from './types';

type WorkerRequest =
  | { id: number; type: 'init'; config: PhaseFieldConfig }
  | { id: number; type: 'step'; count: number }
  | { id: number; type: 'snapshot' };

type SerializedSnapshot = Omit<SimulationSnapshot, 'phi' | 'temperature'> & {
  phi: Float32Array;
  temperature: Float32Array;
};

type WorkerResponse =
  | { id: number; type: 'ready'; snapshot: SerializedSnapshot }
  | { id: number; type: 'step'; stats: StepStats; snapshot: SerializedSnapshot }
  | { id: number; type: 'snapshot'; snapshot: SerializedSnapshot }
  | { id: number; type: 'error'; message: string };

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
};

const workerSelf = globalThis as unknown as WorkerScope;
let solver: PhaseField3D | null = null;

workerSelf.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'init') {
      solver = new PhaseField3D(request.config);
      postSnapshot(request.id, 'ready');
      return;
    }

    if (!solver) throw new Error('3D worker solver has not been initialized.');

    if (request.type === 'step') {
      const stats = solver.step(request.count);
      const snapshot = serializeSnapshot(solver.snapshot());
      workerSelf.postMessage({ id: request.id, type: 'step', stats, snapshot }, [snapshot.phi.buffer, snapshot.temperature.buffer]);
      return;
    }

    if (request.type === 'snapshot') {
      postSnapshot(request.id, 'snapshot');
    }
  } catch (error: unknown) {
    workerSelf.postMessage({
      id: request.id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
};

function postSnapshot(id: number, type: 'ready' | 'snapshot'): void {
  if (!solver) throw new Error('3D worker solver has not been initialized.');
  const snapshot = serializeSnapshot(solver.snapshot());
  workerSelf.postMessage({ id, type, snapshot }, [snapshot.phi.buffer, snapshot.temperature.buffer]);
}

function serializeSnapshot(snapshot: SimulationSnapshot): SerializedSnapshot {
  return {
    dimension: snapshot.dimension,
    nx: snapshot.nx,
    ny: snapshot.ny,
    nz: snapshot.nz,
    phi: new Float32Array(snapshot.phi),
    temperature: new Float32Array(snapshot.temperature),
    step: snapshot.step,
    time: snapshot.time,
    minPhi: snapshot.minPhi,
    maxPhi: snapshot.maxPhi,
    minTemperature: snapshot.minTemperature,
    maxTemperature: snapshot.maxTemperature
  };
}
