import { expect, it, vi } from 'vitest';
import type { WorkerCommand, WorkerEvent } from '../shared/contracts';

const state = vi.hoisted(() => ({ start: vi.fn(), gatewayStart: vi.fn() }));
vi.mock('./plugin-host', () => ({
  SeedPluginHost: class {
    start = state.start;
    activeDiagnosticTrace() { return undefined; }
  },
}));
vi.mock('./local-http-gateway', () => ({
  seedLocalApiPort: 0,
  SeedLocalHttpGateway: class {
    start = state.gatewayStart;
    updatePluginStates() {}
  },
}));

it('acknowledges configuration only after services start and recovers after a rejected build', async () => {
  const emitted: WorkerEvent[] = [];
  let dispatch!: (event: { data: WorkerCommand }) => void;
  const port = {
    on: (_event: string, listener: typeof dispatch) => { dispatch = listener; },
    postMessage: (event: WorkerEvent) => emitted.push(event),
  };
  const configuration = (requestId: string): WorkerCommand => ({
    type: 'configure', requestId, appVersion: '0.3.5', locale: 'en-US',
    backupRoot: '/isolated/backups', pluginDataRoot: '/isolated/data', plugins: [],
  });
  const originalPort = Object.getOwnPropertyDescriptor(process, 'parentPort');
  const originalListeners = new Map(
    ['uncaughtExceptionMonitor', 'unhandledRejection'].map((name) => [name, process.listeners(name)]),
  );
  Object.defineProperty(process, 'parentPort', { configurable: true, value: port });
  try {
    await import('./worker');
    let finish!: (failures: []) => void;
    state.start.mockImplementationOnce(() => new Promise<[]>((resolve) => { finish = resolve; }));
    dispatch({ data: configuration('first') });
    await vi.waitFor(() => expect(state.start).toHaveBeenCalledTimes(1));
    expect(emitted.some((event) => event.type === 'configure.result')).toBe(false);
    finish([]);
    await vi.waitFor(() => expect(emitted).toContainEqual({ type: 'configure.result', requestId: 'first', ok: true }));

    state.start.mockRejectedValueOnce(new Error('Broken build'));
    dispatch({ data: configuration('broken') });
    await vi.waitFor(() => expect(emitted).toContainEqual({
      type: 'configure.result', requestId: 'broken', ok: false, error: 'Broken build',
    }));
    state.start.mockResolvedValueOnce([]);
    dispatch({ data: configuration('recovered') });
    await vi.waitFor(() => expect(emitted).toContainEqual({ type: 'configure.result', requestId: 'recovered', ok: true }));
  } finally {
    for (const [name, before] of originalListeners)
      for (const listener of process.listeners(name))
        if (!before.includes(listener)) process.removeListener(name, listener);
    if (originalPort) Object.defineProperty(process, 'parentPort', originalPort);
    else Reflect.deleteProperty(process, 'parentPort');
  }
});
