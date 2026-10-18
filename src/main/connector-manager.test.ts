import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerCommand, WorkerEvent } from '../shared/contracts';

const state = vi.hoisted(() => ({
  children: [] as Array<{
    messages: WorkerCommand[];
    emit(event: string, ...args: unknown[]): void;
  }>,
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Child extends EventEmitter {
    messages: WorkerCommand[] = [];
    stdout = new EventEmitter();
    stderr = new EventEmitter();

    constructor() {
      super();
      state.children.push(this);
    }

    postMessage(message: WorkerCommand) {
      this.messages.push(message);
      if (message.type === 'shutdown')
        queueMicrotask(() =>
          this.emit('message', {
            type: 'host.invoke',
            requestId: 'shutdown-request',
            service: 'seed.native.stop',
            arguments: {},
          } satisfies WorkerEvent),
        );
      if (message.type === 'host.result' && message.requestId === 'shutdown-request') {
        queueMicrotask(() => this.emit('exit', 0));
      }
    }

    kill() {
      this.emit('exit', 9);
    }
  }

  return { utilityProcess: { fork: () => new Child() } };
});

import { ConnectorManager } from './connector-manager';

describe('ConnectorManager', () => {
  it('forwards cancellation to the capability router and waits for the provider terminal result', async () => {
    const manager = new ConnectorManager('Seed', (event) => {
      if (event.type === 'host.invoke') manager.send({ type: 'host.result', requestId: event.requestId, ok: true });
    });
    const controller = new AbortController();
    const pending = manager.invokePluginCapability(
      'com.example.consumer',
      { capability: 'probe', method: 'echo', arguments: {} },
      [],
      controller.signal,
    );
    const child = state.children[0];
    const command = child.messages.find((item) => item.type === 'plugin.capability.invoke')!;
    controller.abort();
    expect(child.messages.at(-1)).toEqual({ type: 'plugin.capability.cancel', requestId: command.requestId });
    child.emit('message', {
      type: 'plugin.capability.result',
      requestId: command.requestId,
      ok: false,
      error: 'Cancelled',
      errorCode: 'probe_cancelled',
    });
    await expect(pending).rejects.toMatchObject({ code: 'probe_cancelled' });
    await manager.stop();
  });
  beforeEach(() => {
    state.children.length = 0;
  });

  it.each([true, false])(
    'preserves error parameters and billing returned by the capability router (complete=%s)',
    async (complete) => {
      const manager = new ConnectorManager('Seed', (event) => {
        if (event.type === 'host.invoke')
          manager.send({ type: 'host.result', requestId: event.requestId, ok: true, result: null });
      });
      manager.start();
      const pending = manager.invokePluginCapability(
        'com.example.consumer',
        { capability: 'probe', method: 'echo', arguments: {} },
        [],
      );
      const command = state.children[0]!.messages.find((message) => message.type === 'plugin.capability.invoke')!;
      state.children[0]!.emit('message', {
        type: 'plugin.capability.result',
        requestId: command.requestId,
        ok: false,
        error: 'Failure: permission denied',
        errorCode: 'probe_failed',
        errorParams: { detail: 'permission denied' },
        errorBilling: { version: 1, complete, charges: [{ call_id: 'confirmed', charged_amount: 2 }] },
      } satisfies WorkerEvent);
      await expect(pending).rejects.toMatchObject({
        code: 'probe_failed',
        params: { detail: 'permission denied' },
        billing: { version: 1, complete, charges: [{ call_id: 'confirmed', charged_amount: 2 }] },
      });
      await manager.stop();
    },
  );

  it('keeps the closing child available for host responses without starting another connector', async () => {
    const onExit = vi.fn();
    let manager!: ConnectorManager;
    manager = new ConnectorManager(
      'Seed',
      (event) => {
        if (event.type !== 'host.invoke') return;
        manager.send({ type: 'host.result', requestId: event.requestId, ok: true, result: null });
      },
      onExit,
    );
    manager.start();

    await manager.stop();

    expect(state.children).toHaveLength(1);
    expect(state.children[0]!.messages.map((message) => message.type)).toEqual(['shutdown', 'host.result']);
    expect(onExit).not.toHaveBeenCalled();

    manager.send({ type: 'unconfigure' });
    expect(state.children).toHaveLength(1);
  });
});
