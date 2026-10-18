import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { WorkerCommand, WorkerEvent } from '../shared/contracts';
import { pluginErrorBilling } from '../shared/plugin-error';

export class ConnectorManager {
  private child: UtilityProcess | null = null;
  private stopping = false;
  private readonly pendingPluginCapabilities = new Map<
    string,
    { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private serviceName: string,
    private onEvent: (event: WorkerEvent) => void,
    private onExit: (code: number) => void = () => undefined,
    private onOutput: (stream: 'stdout' | 'stderr', chunk: string) => void = () => undefined,
  ) {}

  start() {
    if (this.stopping || this.child) return;
    const workerPath = join(__dirname, '../connector/worker.js');
    const child = utilityProcess.fork(workerPath, [], {
      serviceName: `${this.serviceName} Connector`,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => this.onOutput('stdout', chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => this.onOutput('stderr', chunk.toString('utf8')));
    child.on('message', (message) => {
      const event = message as WorkerEvent;
      if (event.type === 'plugin.capability.result') {
        const pending = this.pendingPluginCapabilities.get(event.requestId);
        if (!pending) return;
        this.pendingPluginCapabilities.delete(event.requestId);
        clearTimeout(pending.timer);
        if (event.ok) pending.resolve(event.result);
        else
          pending.reject(
            Object.assign(new Error(event.error || '插件能力调用失败。'), {
              code: event.errorCode,
              params: event.errorParams,
              billing: pluginErrorBilling({ billing: event.errorBilling }),
            }),
          );
        return;
      }
      this.onEvent(event);
    });
    child.on('exit', (code) => {
      if (this.child !== child) return;
      if (!this.stopping) this.onExit(code);
      this.child = null;
      this.rejectPendingRequests(new Error(`本地连接器已退出（${code}）。`));
    });
  }

  send(command: WorkerCommand) {
    if (!this.child) {
      if (this.stopping) return;
      this.start();
    }
    this.child?.postMessage(command);
  }

  queryPluginCapabilities(packageId: string) {
    return this.requestPluginCapability({ type: 'plugin.capability.list', packageId });
  }

  invokePluginCapability(
    packageId: string,
    invocation: import('@motus-ai/seed-sdk').SeedPluginCapabilityInvocation,
    chain: string[],
    signal?: AbortSignal,
  ) {
    return this.requestPluginCapability({ type: 'plugin.capability.invoke', packageId, invocation, chain }, signal);
  }

  private requestPluginCapability(
    command:
      | { type: 'plugin.capability.list'; packageId: string }
      | {
          type: 'plugin.capability.invoke';
          packageId: string;
          invocation: import('@motus-ai/seed-sdk').SeedPluginCapabilityInvocation;
          chain: string[];
        },
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const requestId = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const cancel = () => this.send({ type: 'plugin.capability.cancel', requestId });
      const clean = () => signal?.removeEventListener('abort', cancel);
      signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => {
        cancel();
        clean();
        this.pendingPluginCapabilities.delete(requestId);
        reject(new Error('插件能力请求超时。'));
      }, 10 * 60_000);
      this.pendingPluginCapabilities.set(requestId, {
        resolve: (value) => {
          clean();
          resolve(value);
        },
        reject: (error) => {
          clean();
          reject(error);
        },
        timer,
      });
      try {
        this.send({ ...command, requestId } as WorkerCommand);
      } catch (error) {
        clean();
        clearTimeout(timer);
        this.pendingPluginCapabilities.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private rejectPendingRequests(error: Error) {
    for (const pending of this.pendingPluginCapabilities.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingPluginCapabilities.clear();
  }
  async stop() {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    this.rejectPendingRequests(new Error('本地连接器已停止。'));
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (this.child === child) this.child = null;
        resolve();
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish();
      }, 5_000);
      child.once('exit', finish);
      child.postMessage({ type: 'shutdown' } satisfies WorkerCommand);
    });
  }
}
