import { randomUUID } from 'node:crypto';
import type { WorkerCommand, WorkerEvent } from '../shared/contracts';
import type { PluginHostServices } from './plugin-runtime';
import { ConnectorCommandDispatcher } from './command-dispatcher';
import { SeedLocalHttpGateway, seedLocalApiPort } from './local-http-gateway';
import { SeedPluginHost } from './plugin-host';
import { GlobalTaskActivityObserver } from './global-task-activity-observer';
import { pluginErrorBilling, pluginErrorParams } from '../shared/plugin-error';

type ParentPort = {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
if (!parentPort) throw new Error('The local connector must run as an Electron utility process.');

let configuration: Extract<WorkerCommand, { type: 'configure' }> | null = null;
const pendingHostInvocations = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
const capabilityCalls = new Map<string, AbortController>();

function invokeHost(service: string, argumentsValue: Record<string, unknown>) {
  const requestId = randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    pendingHostInvocations.set(requestId, { resolve, reject });
    emit({
      type: 'host.invoke',
      requestId,
      service,
      arguments: argumentsValue,
      trace: pluginHost.activeDiagnosticTrace(),
    });
  });
}

const runtimeService: PluginHostServices = {
  configuration: () => configuration,
  invoke_host: invokeHost,
};
const taskActivityObserver = new GlobalTaskActivityObserver(emit);
let pluginHost = new SeedPluginHost(runtimeService, taskActivityObserver, 'remote', undefined, true, (event) =>
  emit({ type: 'diagnostic', level: event.phase === 'failed' ? 'error' : 'info', ...event }),
);
const localHttpGateway = new SeedLocalHttpGateway(
  runtimeService,
  () => pluginHost,
  seedLocalApiPort,
  taskActivityObserver,
  (event) => emit({ type: 'diagnostic', level: event.phase === 'failed' ? 'error' : 'info', ...event }),
);
let pluginsReady: Promise<void> = Promise.resolve();

function configurePlugins(command: Extract<WorkerCommand, { type: 'configure' }>) {
  pluginsReady = pluginsReady.then(async () => {
    await localHttpGateway.start();
    const failures = await pluginHost.start(command.plugins);
    for (const failure of failures) emit({ type: 'plugin.runtime.failed', ...failure });
    const failedIds = new Set(failures.map((failure) => failure.packageId));
    localHttpGateway.updatePluginStates(
      command.plugins.map((plugin) => ({
        plugin_id: plugin.package_id,
        version: plugin.version,
        state: failedIds.has(plugin.package_id) ? 'failed' : 'ready',
        ...(plugin.configuration_revision ? { configuration_revision: plugin.configuration_revision } : {}),
      })),
    );
  });
  return pluginsReady;
}

function emit(event: WorkerEvent) {
  parentPort!.postMessage(event);
}

function reportFailure(
  event: string,
  error: unknown,
  level: 'error' | 'fatal' = 'error',
  pluginId?: string,
  requestId?: string,
  operation?: string,
) {
  emit({
    type: 'diagnostic',
    level,
    event,
    message: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error ? { error_name: error.name, error_stack: error.stack } : {}),
    ...(pluginId ? { plugin_id: pluginId } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    ...(operation ? { operation } : {}),
  });
}
process.on('uncaughtExceptionMonitor', (error) => reportFailure('connector.uncaught_exception', error, 'fatal'));
process.on('unhandledRejection', (reason) => {
  reportFailure('connector.unhandled_rejection', reason, 'fatal');
  process.exitCode = 1;
  setImmediate(() => process.exit(1));
});

async function handleCommand(command: WorkerCommand) {
  if (command.type === 'plugin.capability.cancel') {
    capabilityCalls.get(command.requestId)?.abort(new Error('Capability call cancelled.'));
    return;
  }
  if (command.type === 'native.runtime.updated') {
    let snapshot = command.snapshot;
    const remainsConfigured = configuration?.plugins.some((plugin) => plugin.package_id === command.packageId) === true;
    try {
      // Process loss revokes its routes immediately; the independent UI host remains mounted.
      pluginHost.applyRemoteSnapshot(command.packageId, snapshot);
    } catch (error) {
      snapshot = null;
      if (!remainsConfigured) pluginHost.applyRemoteSnapshot(command.packageId, null);
      await invokeHost('seed.native.stop', { package_id: command.packageId }).catch(() => undefined);
      emit({
        type: 'plugin.runtime.failed',
        packageId: command.packageId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (configuration)
      localHttpGateway.updatePluginStates(
        configuration.plugins.map((plugin) => ({
          plugin_id: plugin.package_id,
          version: plugin.version,
          state: plugin.package_id === command.packageId && !snapshot ? 'failed' : 'ready',
          ...(plugin.configuration_revision ? { configuration_revision: plugin.configuration_revision } : {}),
        })),
      );
    return;
  }
  if (command.type === 'plugin.capability.list' || command.type === 'plugin.capability.invoke') {
    const controller = new AbortController();
    capabilityCalls.set(command.requestId, controller);
    try {
      const result =
        command.type === 'plugin.capability.list'
          ? pluginHost.consumedCapabilitiesByPackage(command.packageId)
          : await pluginHost.invokeConsumedByPackage(
              command.packageId,
              { ...command.invocation, signal: controller.signal },
              command.chain,
            );
      emit({ type: 'plugin.capability.result', requestId: command.requestId, ok: true, result });
    } catch (error) {
      const errorBilling = pluginErrorBilling(error);
      emit({
        type: 'plugin.capability.result',
        requestId: command.requestId,
        ok: false,
        ...(errorBilling ? { errorBilling } : {}),
        error: error instanceof Error ? error.message : String(error),
        errorParams: pluginErrorParams(error),
        errorCode:
          error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
            ? String((error as { code: string }).code)
            : 'native_capability_error',
      });
    } finally {
      capabilityCalls.delete(command.requestId);
    }
    return;
  }
  if (command.type === 'local-gateway.event') {
    localHttpGateway.publishStateEvent(command.event);
    return;
  }
  if (command.type === 'configure') {
    configuration = command;
    await configurePlugins(command);
    return;
  }
  if (command.type === 'host.result') {
    const pending = pendingHostInvocations.get(command.requestId);
    if (!pending) return;
    pendingHostInvocations.delete(command.requestId);
    if (command.ok) pending.resolve(command.result);
    else {
      const error = Object.assign(new Error(command.error || '主进程能力调用失败。'), {
        code: command.errorCode || 'host_invoke_error',
        params: command.errorParams,
        billing: pluginErrorBilling({ billing: command.errorBilling }),
      });
      pending.reject(error);
    }
    return;
  }
  if (command.type === 'unconfigure') {
    configuration = null;
    for (const pending of pendingHostInvocations.values()) pending.reject(new Error('客户端已退出登录。'));
    pendingHostInvocations.clear();
    const previous = pluginHost;
    pluginHost = new SeedPluginHost(runtimeService, taskActivityObserver, 'remote', undefined, true, (event) =>
      emit({ type: 'diagnostic', level: event.phase === 'failed' ? 'error' : 'info', ...event }),
    );
    pluginsReady = Promise.all([previous.stop(), localHttpGateway.stop()]).then(() => undefined);
    await pluginsReady;
  }
  if (command.type === 'shutdown') {
    void Promise.all([pluginHost.stop(), localHttpGateway.stop()]).finally(() => process.exit(0));
  }
}

const commandDispatcher = new ConnectorCommandDispatcher<WorkerCommand>(handleCommand, (error) => {
  reportFailure('connector.command.failed', error);
});

parentPort.on('message', (event) => {
  commandDispatcher.dispatch(event.data as WorkerCommand);
});
