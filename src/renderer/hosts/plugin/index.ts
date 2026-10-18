import * as sdk from '@motus-ai/seed-sdk';
import type { SeedCapabilityHandler } from '@motus-ai/seed-sdk';
import { pluginBundle, pluginServiceConstructor } from '../../../shared/plugin-bundle';
import type { SandboxPluginConfiguration } from '../../../shared/sandbox-plugin';

type RuntimeRecord = {
  scope: sdk.Component;
  handlers: Map<string, SeedCapabilityHandler>;
  service?: sdk.PluginService;
  brokerToken?: string;
};
const runtimes = new Map<string, RuntimeRecord>();
const runtimeBridge = window.seedPluginRuntime;
const calls = new Map<string, AbortController>();

async function clearRuntimes() {
  for (const controller of calls.values()) controller.abort(new Error('Plugin service stopped.'));
  calls.clear();
  const cleanup = await Promise.allSettled([...runtimes.values()].map(({ scope }) => scope.unload()));
  runtimes.clear();
  const failures = cleanup.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      'Plugin cleanup failed.',
    );
}

runtimeBridge.onConfigure(async (configuration: SandboxPluginConfiguration) => {
  try {
    await clearRuntimes();
    for (const owner of configuration.plugins) {
      const scope = new sdk.Component();
      if (owner.api_version !== 2) throw new Error('Only class-based plugin bundles are supported.');
      const handlers = new Map<string, SeedCapabilityHandler>();
      const module = await import(/* @vite-ignore */ owner.entry_url);
      const Service = pluginServiceConstructor(
        pluginBundle(module),
        { '@motus-ai/seed-sdk': sdk },
        (name) => {
          throw new Error('Module unavailable in sandbox service: ' + name);
        },
        owner.entry_url,
      );
      const record: RuntimeRecord = { scope, handlers };
      // Own the registry before initialization, including partially loaded registrations.
      runtimes.set(owner.package_id, record);
      const taskControllers = new Set<AbortController>();
      const pendingAuthorizations = new Set<string>();
      let acceptingHostCalls = true;
      scope.register(() => {
        acceptingHostCalls = false;
      });
      scope.register(() => {
        for (const controller of taskControllers) controller.abort(new Error('Plugin stopped.'));
        taskControllers.clear();
        for (const requestId of pendingAuthorizations) {
          void runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin-authorization', {
            operation: 'cancel',
            request_id: requestId,
          });
        }
        pendingAuthorizations.clear();
      });
      const startTask = (input: { id?: string; label?: string; run_id?: string; request_id?: string }) => {
        if (scope.signal.aborted) throw new Error('Plugin service stopped.');
        const controller = new AbortController();
        const id = input.id || input.run_id || input.request_id || crypto.randomUUID();
        const started = runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin-task', {
          id,
          label: input.label,
          phase: 'started',
        });
        void started.catch(() => controller.abort(new Error('Plugin task registration failed.')));
        taskControllers.add(controller);
        let settled = false;
        const settle = (failed = false) => {
          if (!settled) {
            settled = true;
            taskControllers.delete(controller);
            void started
              .then(() =>
                runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin-task', {
                  id,
                  phase: failed ? 'failed' : 'completed',
                }),
              )
              .catch(() => undefined);
          }
        };
        controller.signal.addEventListener('abort', () => settle(), { once: true });
        return {
          id,
          signal: controller.signal,
          finish: settle,
          fail: (_error?: unknown) => settle(true),
        };
      };
      const context: Omit<sdk.PluginServices, 'data'> = {
        package: { package_id: owner.package_id, version: owner.version, data_path: '' },
        audit: {
          record: async (entry) => {
            await runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin.audit', { entry });
          },
        },
        diagnostics: {
          report: async (entry) => {
            await runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin.diagnostic', { entry });
          },
          error: async (event, error, details) => {
            await runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin.diagnostic', {
              entry: {
                level: 'error',
                event,
                message: error instanceof Error ? error.message : String(error),
                ...(error instanceof Error ? { error_name: error.name, error_stack: error.stack } : {}),
                ...details,
              },
            });
          },
        },
        capabilities: sdk.createCapabilityClient(
          (service, args) => runtimeBridge.invokeBroker(owner.broker_token, service, args),
          scope.signal,
        ),
        localApi: {
          register: () => {
            throw new Error('本地 HTTP API 需要 native-host 运行时。');
          },
        },
        tasks: {
          start: startTask,
          run: async (input, work) => {
            const task = startTask(input);
            try {
              const value = await work(task.signal);
              task.finish();
              return value;
            } catch (error) {
              task.fail(error);
              throw error;
            }
          },
        },
        connections: {
          register: () => {
            throw new Error('主动网络连接需要声明 network.connect.* 权限并使用 native-host 运行时。');
          },
        },
        secrets: {
          get: async (key) => {
            const result = (await runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin-secret', {
              operation: 'get',
              key,
            })) as { value?: unknown };
            return typeof result.value === 'string' ? result.value : undefined;
          },
          set: async (key, value) => {
            await runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin-secret', {
              operation: 'set',
              key,
              value,
            });
          },
          delete: async (key) => {
            await runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin-secret', {
              operation: 'delete',
              key,
            });
          },
        },
        authorization: {
          authorize: async (request, signal) => {
            if (signal?.aborted) throw new Error('插件授权已取消。');
            const requestId = crypto.randomUUID();
            pendingAuthorizations.add(requestId);
            const cancel = () => {
              void runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin-authorization', {
                operation: 'cancel',
                request_id: requestId,
              });
            };
            signal?.addEventListener('abort', cancel, { once: true });
            try {
              return (await runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin-authorization', {
                operation: 'start',
                request_id: requestId,
                request,
              })) as import('@motus-ai/seed-sdk').SeedBrowserAuthorizationResult;
            } finally {
              signal?.removeEventListener('abort', cancel);
              pendingAuthorizations.delete(requestId);
            }
          },
        },
        invokeHost: async (service, argumentsValue) => {
          if (!acceptingHostCalls) throw new Error('Plugin service stopped.');
          return await runtimeBridge.invokeBroker(owner.broker_token, service, argumentsValue);
        },
      };
      if (!owner.sdk_manifest) throw new Error('Plugin SDK manifest is missing.');
      const definitions = new Map<string, sdk.CapabilityDefinition>();
      const publications: Promise<unknown>[] = [];
      const publish = () => {
        if (scope.signal.aborted) return;
        const pending = context.invokeHost('seed.plugin-capabilities', {
          definitions: [...definitions.values()],
        });
        publications.push(pending);
        void pending.catch(() => undefined);
      };
      record.service = scope.addChild(
        new Service(
          {
            ...context,
            resources: sdk.createPluginResources(owner.entry_url, owner.resources ?? []),
            locale: owner.locale,
            registerCapability: (definition, handler) => {
              if (scope.signal.aborted) throw new Error('Plugin service stopped.');
              if (handlers.has(definition.id)) throw new Error('Duplicate sandbox capability: ' + definition.id);
              definitions.set(definition.id, definition);
              handlers.set(definition.id, handler);
              publish();
              return () => {
                definitions.delete(definition.id);
                handlers.delete(definition.id);
                publish();
              };
            },
            data: {
              load: async () =>
                (await context.invokeHost('seed.plugin-data', { operation: 'load' })) as sdk.PluginDataSnapshot,
              save: async (data, revision) =>
                (await context.invokeHost('seed.plugin-data', {
                  operation: 'save',
                  data,
                  revision,
                })) as sdk.PluginDataSnapshot,
            },
          },
          owner.sdk_manifest,
        ),
      );
      await scope.load();
      await Promise.all(publications);

      record.brokerToken = owner.broker_token;
    }
    runtimeBridge.configured(configuration.configuration_id, true);
  } catch (error) {
    for (const owner of configuration.plugins) {
      await runtimeBridge
        .invokeBroker(owner.broker_token, 'seed.plugin.diagnostic', {
          entry: {
            level: 'error',
            event: 'plugin.start.failed',
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof Error ? { error_name: error.name, error_stack: error.stack } : {}),
          },
        })
        .catch(() => undefined);
    }
    await clearRuntimes().catch(() => undefined);
    runtimeBridge.configured(
      configuration.configuration_id,
      false,
      error instanceof Error ? error.message : String(error),
    );
  }
});

runtimeBridge.onInvoke(async (message) => {
  const controller = new AbortController();
  calls.set(message.request_id, controller);
  try {
    const record = runtimes.get(message.package_id);
    let result: unknown;
    if (message.operation === 'service') {
      if (!record?.service) throw new Error('Plugin service is unavailable.');
      result = await record.service.call(message.method, message.arguments, controller.signal);
    } else {
      const handler = record?.handlers.get(message.capability);
      if (!handler) throw new Error(`插件能力尚未注册：${message.package_id}/${message.capability}`);
      result = await handler.invoke(message.method, {
        ...message.invocation,
        capability: message.capability,
        signal: controller.signal,
      });
    }
    runtimeBridge.result(message.request_id, true, result);
  } catch (error) {
    const owner = runtimes.get(message.package_id)?.brokerToken;
    if (owner && !controller.signal.aborted) {
      await runtimeBridge
        .invokeBroker(owner, 'seed.plugin.diagnostic', {
          entry: {
            level: 'error',
            event: 'capability.failed',
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof Error ? { error_name: error.name, error_stack: error.stack } : {}),
            request_id: message.request_id,
            operation:
              message.operation === 'service' ? `service.${message.method}` : `${message.capability}.${message.method}`,
          },
        })
        .catch(() => undefined);
    }
    runtimeBridge.result(
      message.request_id,
      false,
      undefined,
      error instanceof Error ? error.message : String(error),
      error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
        ? String((error as { code: string }).code)
        : 'plugin_invoke_error',
      error &&
        typeof error === 'object' &&
        (error as { params?: unknown }).params &&
        typeof (error as { params?: unknown }).params === 'object'
        ? (error as { params: Record<string, string | number | boolean> }).params
        : undefined,
    );
  } finally {
    calls.delete(message.request_id);
  }
});

runtimeBridge.onCancel((requestId) => {
  calls.get(requestId)?.abort(new Error('Plugin call cancelled.'));
});
runtimeBridge.onLocale((locale) => {
  for (const { service } of runtimes.values())
    if (service) {
      service.app.locale = locale;
      const bundle = service.manifest.translations ?? { defaultLocale: 'en-US', resources: { 'en-US': {} } };
      void service.i18n.changeLanguage(sdk.pluginTranslationLocale(locale, bundle));
    }
});

runtimeBridge.ready();
