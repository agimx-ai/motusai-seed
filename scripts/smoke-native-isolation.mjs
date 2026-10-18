import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import { NativePluginManager } from '../dist/electron/main/native-plugin-manager.js';
import { SeedPluginHost } from '../dist/electron/connector/plugin-host.js';
import { PluginCapabilityCatalog } from '../dist/electron/main/plugin-capability-catalog.js';
import { invokeLocalCreditRelay } from '../dist/electron/main/local-credit-relay.js';

const root = await mkdtemp(join(tmpdir(), 'seed-native-isolation-'));
app.setPath('userData', root);
const watchdog = setTimeout(() => {
  process.stderr.write('Native isolation smoke timed out.\n');
  process.exit(2);
}, 30_000);

function runtime(name, entryPath) {
  return {
    api_version: 2,
    has_service: true,
    resources: ['index.mjs'],
    sdk_manifest: {
      id: `com.example.${name}`,
      name,
      version: '1.0.0',
      minAppVersion: '0.2.15',
      author: 'Example',
      description: name,
      translations: {
        defaultLocale: 'en-US',
        resources: {
          'en-US': { capabilities: { [`probe_${name}`]: { errors: { probe_failed: 'Probe failed: {{detail}}' } } } },
          'zh-CN': { capabilities: { [`probe_${name}`]: { errors: { probe_failed: '探针失败：{{detail}}' } } } },
        },
      },
    },
    package_id: `com.example.${name}`,
    version: '1.0.0',
    name: { en_US: name, zh_Hans: name },
    publisher_type: 'official',
    runtime_kind: 'native-host',
    root_path: join(root, name),
    entry_path: entryPath,
    sidecars: [],
    permissions: name === 'one' ? ['local.http-api', 'network.connect.loopback'] : ['cloud.relay'],
    consumes: name === 'one' ? [{ capability: 'probe_two', methods: ['echo'] }] : [],
    capabilities: [],
  };
}
function capability(name) {
  return {
    id: `probe_${name}`,
    version: 1,
    exposure: 'terminal',
    methods: [
      {
        name: 'echo',
        risk: 'read',
        ...(name === 'two'
          ? {
              annotations: { 'billing.settlement': 'local_relay', 'billing.product': 'iq.generate' },
            }
          : {}),
      },
      { name: 'crash', risk: 'read' },
      ...(name === 'one' ? [{ name: 'delegate', risk: 'read' }] : []),
    ],
  };
}

function invocation(id, argumentsValue = {}) {
  return { request_id: id, arguments: argumentsValue };
}

app
  .whenReady()
  .then(async () => {
    let manager;
    let router;
    let failed = false;
    try {
      const entries = [];
      const profileWrites = [];
      for (const name of ['one', 'two']) {
        const directory = join(root, name);
        await mkdir(directory, { recursive: true });
        const entry = join(directory, 'index.mjs');
        const contributions =
          name === 'one'
            ? `
        this.registerLocalApi({ allowed_origins: ['app://test'], allowed_client_ids: ['com.example.client'],
          routes: [{ method: 'GET', path: '/events', public: true }],
          handle: () => new Response(new ReadableStream({ start(controller) {
            controller.enqueue(new TextEncoder().encode('data: ready\\n\\n'))
            controller.close()
          } }), { headers: { 'content-type': 'text/event-stream' } }) })
        const connection = this.registerConnection({ id: 'primary', transport: 'websocket',
          permission: 'network.connect.loopback', profile: { configuration_id: 'source', profile_id: 'source-1' },
          close() {}, reconnect() {} })
        connection.update({ state: 'connected' })
      `
            : '';
        await writeFile(
          entry,
          `export const seedPluginBundleVersion = 2;
export function loadView(modules) { return class extends modules['@motus-ai/seed-sdk'].Plugin {}; }
export function loadService(modules) { const { PluginService, SeedPluginError } = modules['@motus-ai/seed-sdk'];
return class extends PluginService { async onload() {
        const ctx = this.app;
        this.addCapability(${JSON.stringify(capability(name))}, {
          invoke: async (method, request) => {
            if (method === 'crash') process.exit(7)
            if (request.arguments.add_profile) {
              await ctx.settings.update('source', (stored) => ({ ...stored, profiles: [...stored.profiles, { id: 'source-new', kind: 'custom', value: 'new value' }] }));
              return { saved: true };
            }
            if (method === 'delegate') return await ctx.capabilities.invoke({ capability: 'probe_two', method: 'echo', arguments: request.arguments })
            if (request.arguments.local_outcome) return await ctx.invokeHost('seed.local.relay', {
              capability_id: 'probe_two', method: 'echo',
              call_id: '11111111-1111-4111-8111-111111111111', task_id: '22222222-2222-4222-8222-222222222222',
              outcome: request.arguments.local_outcome,
            })
            if (request.arguments.error_case) throw new SeedPluginError('probe_failed', 'Raw permission failure', { detail: 'permission denied' })
            if (request.arguments.billing_case) {
              const response = await ctx.invokeHost('seed.cloud.relay', {
                capability_id: 'probe_two', method: 'echo', payload: request.arguments,
              });
              if (request.arguments.billing_error) throw new SeedPluginError('probe_failed', 'Failure after relay', { detail: 'after relay' });
              return response.payload;
            }
            return request.arguments
          },
        })
        ${contributions}
      } }; }`,
        );
        entries.push(runtime(name, entry));
      }
      const snapshots = [];
      const catalog = new PluginCapabilityCatalog();
      manager = new NativePluginManager(
        'Seed Smoke',
        async (packageId, service, args) => {
          if (service === 'seed.plugin-capabilities') {
            catalog.publish(
              entries.find((plugin) => plugin.package_id === packageId),
              args.definitions,
            );
            return null;
          }
          if (service === 'seed.plugin-settings') {
            const existing = {
              schema_version: 1,
              profiles: [{ id: 'existing', secret: 'kept' }],
              default_profile_id: 'existing',
              values: {},
            };
            if (args.operation === 'load')
              return Object.fromEntries(args.ids.map((id) => [id, { revision: 'a'.repeat(64), value: existing }]));
            for (const update of args.updates) {
              if (
                packageId !== 'com.example.one' ||
                update.id !== 'source' ||
                update.value.profiles[0].secret !== 'kept'
              )
                throw new Error('Settings update escaped its owner or lost an existing credential.');
              profileWrites.push(update.value.profiles.at(-1));
            }
            return Object.fromEntries(
              args.updates.map((update) => [update.id, { revision: 'b'.repeat(64), value: update.value }]),
            );
          }
          if (service === 'seed.capabilities.list') return router.consumedCapabilitiesByPackage(packageId);
          if (service === 'seed.capabilities.invoke')
            return router.invokeConsumedByPackage(packageId, args.invocation, args.chain);
          if (service === 'seed.local.relay')
            return invokeLocalCreditRelay(
              {
                prepare: async () => {
                  throw new Error('Settlement must not prepare a new call.');
                },
                localRelay: async (input) => ({
                  billable: true,
                  call_id: input.call_id,
                  amount: 100,
                  price_revision: 1,
                  state:
                    input.outcome === 'started' ? 'executing' : input.outcome === 'succeeded' ? 'settled' : 'released',
                  charged_amount: input.outcome === 'started' ? null : input.outcome === 'succeeded' ? 100 : 0,
                }),
              },
              catalog.withCapabilities(entries.find((plugin) => plugin.package_id === packageId)),
              service,
              args,
            );
          if (service === 'seed.cloud.relay')
            return {
              payload: args.payload,
              ...(args.payload.unknown_billing
                ? {}
                : { billing: { state: 'settled', call_id: args.payload.billing_case, charged_amount: 2 } }),
            };
          return undefined;
        },
        (packageId, snapshot) => {
          snapshots.push(`${packageId}:${snapshot ? 'ready' : 'gone'}`);
          router?.applyRemoteSnapshot(packageId, snapshot);
        },
        () => undefined,
        () => undefined,
        () => undefined,
      );
      const configuration = {
        type: 'configure',
        serverUrl: 'https://example.test',
        terminalId: 'test',
        token: 'not-for-child',
        grants: [],
        appVersion: '0.0.0',
        locale: 'en-US',
        backupRoot: join(root, 'backups'),
        pluginDataRoot: join(root, 'data'),
        plugins: entries,
      };
      const [firstSnapshot] = await Promise.all(entries.map((plugin) => manager.start(plugin, configuration)));
      router = new SeedPluginHost(
        {
          configuration: () => configuration,
          invoke_host: async (service, args) => {
            const packageId = args.package_id;
            if (service === 'seed.native.start') return manager.start(args.plugin, args.configuration);
            if (service === 'seed.native.stop') return manager.stop(packageId);
            if (service === 'seed.native.invoke')
              return manager.call(
                packageId,
                {
                  type: 'invoke',
                  capability: args.capability,
                  method: args.method,
                  invocation: args.invocation,
                  chain: args.chain,
                  include_billing: args.include_billing,
                },
                args.invocation.request_id,
              );
            if (service === 'seed.native.cancel') return manager.cancel(packageId, args.request_id);
            if (service === 'seed.plugin.diagnostic' || service === 'seed.plugin.audit') return undefined;
            throw new Error(`Unexpected routing service: ${service}`);
          },
        },
        undefined,
        'remote',
      );
      const failures = await router.start(entries);
      if (failures.length) throw new Error(`Router startup failed: ${JSON.stringify(failures)}`);
      const saved = await router.invoke('probe_one', 'echo', {
        request_id: 'profile-write',
        arguments: { add_profile: true },
      });
      if (saved?.saved !== true || profileWrites.length !== 1)
        throw new Error('Native configuration write acknowledgement failed.');
      const delegated = await router.invoke('probe_one', 'delegate', {
        request_id: 'delegated',
        arguments: { cross_process: true },
      });
      if (delegated?.cross_process !== true) throw new Error('Cross-plugin capability routing failed.');
      try {
        await router.invoke('probe_one', 'delegate', {
          request_id: 'delegated-error',
          arguments: { error_case: true },
        });
        throw new Error('Expected a delegated plugin failure.');
      } catch (error) {
        if (
          error.code !== 'probe_failed' ||
          error.params?.detail !== 'permission denied' ||
          error.message !== 'Probe failed: permission denied'
        )
          throw error;
      }
      const billed = await Promise.all(
        ['charge-one', 'charge-two'].map((id) =>
          router.withBillingReceipt(() =>
            router.invoke('probe_one', 'delegate', { request_id: id, arguments: { billing_case: id } }),
          ),
        ),
      );
      for (const [index, response] of billed.entries()) {
        const id = ['charge-one', 'charge-two'][index];
        if (
          response.result?.billing_case !== id ||
          !response.billing.complete ||
          response.billing.charges.length !== 1 ||
          response.billing.charges[0].call_id !== id ||
          response.billing.charges[0].charged_amount !== 2
        ) {
          throw new Error(`Cross-process billing receipt was lost or duplicated: ${JSON.stringify(response)}`);
        }
      }
      for (const outcome of ['started', 'succeeded', 'cancelled']) {
        const response = await router.withBillingReceipt(() =>
          router.invoke('probe_one', 'delegate', {
            request_id: `local-${outcome}`,
            arguments: { local_outcome: outcome },
          }),
        );
        const expected =
          outcome === 'started'
            ? []
            : [{ call_id: '11111111-1111-4111-8111-111111111111', charged_amount: outcome === 'succeeded' ? 100 : 0 }];
        if (
          response.billing.complete !== (outcome !== 'started') ||
          JSON.stringify(response.billing.charges) !== JSON.stringify(expected)
        ) {
          throw new Error(`Local relay settlement receipt was lost: ${JSON.stringify(response)}`);
        }
      }
      for (const [id, args, expected] of [
        ['free-error', { error_case: true }, { complete: true, charges: [] }],
        [
          'paid-error',
          { billing_case: 'paid-error', billing_error: true },
          { complete: true, charges: [{ call_id: 'paid-error', charged_amount: 2 }] },
        ],
        [
          'unknown-error',
          { billing_case: 'unknown-error', billing_error: true, unknown_billing: true },
          { complete: false, charges: [] },
        ],
      ]) {
        let failure;
        try {
          await router.withBillingReceipt(() => router.invoke('probe_one', 'delegate', invocation(id, args)));
        } catch (error) {
          failure = error;
        }
        if (
          failure?.code !== 'probe_failed' ||
          failure.billing?.version !== 1 ||
          failure.billing.complete !== expected.complete ||
          JSON.stringify(failure.billing.charges) !== JSON.stringify(expected.charges)
        ) {
          throw new Error(`Failed cross-process invocation lost its authoritative receipt: ${id}`);
        }
      }
      if (
        firstSnapshot.capabilityDefinitions[0]?.id !== 'probe_one' ||
        firstSnapshot.connections[0]?.state !== 'connected' ||
        firstSnapshot.localApi?.routes[0]?.path !== '/events'
      )
        throw new Error('Native runtime contributions were not transferred.');
      const local = await manager.call(entries[0].package_id, {
        type: 'local-api',
        url: 'http://127.0.0.1/events',
        method: 'GET',
        headers: [],
        client: null,
      });
      if (!local?.stream_id || local.status !== 200) throw new Error('Local API stream did not open.');
      const chunk = await manager.call(entries[0].package_id, { type: 'local-api-read', stream_id: local.stream_id });
      if (new TextDecoder().decode(chunk?.chunk) !== 'data: ready\n\n')
        throw new Error('Local API stream chunk was lost.');
      const end = await manager.call(entries[0].package_id, { type: 'local-api-read', stream_id: local.stream_id });
      if (!end?.done) throw new Error('Local API stream did not close.');
      const result = await manager.call(entries[1].package_id, {
        type: 'invoke',
        capability: 'probe_two',
        method: 'echo',
        invocation: invocation('healthy-before', { ok: true }),
        chain: [],
      });
      if (result?.ok !== true) throw new Error('Second plugin did not answer before crash.');
      await manager
        .call(entries[0].package_id, {
          type: 'invoke',
          capability: 'probe_one',
          method: 'crash',
          invocation: invocation('crash'),
          chain: [],
        })
        .then(
          () => {
            throw new Error('Crashed plugin unexpectedly returned.');
          },
          () => undefined,
        );
      if (router.supports('probe_one', 'echo') || !router.supports('probe_two', 'echo')) {
        throw new Error('Router did not remove only the crashed plugin.');
      }
      const readyBeforeRestart = snapshots.filter((value) => value === 'com.example.one:ready').length;
      const after = await manager.call(entries[1].package_id, {
        type: 'invoke',
        capability: 'probe_two',
        method: 'echo',
        invocation: invocation('healthy-after', { ok: true }),
        chain: [],
      });
      if (after?.ok !== true) throw new Error('Second plugin stopped after first plugin crashed.');
      const deadline = Date.now() + 5_000;
      while (
        snapshots.filter((value) => value === 'com.example.one:ready').length <= readyBeforeRestart &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (
        !snapshots.includes('com.example.one:gone') ||
        snapshots.filter((value) => value === 'com.example.one:ready').length <= readyBeforeRestart
      ) {
        throw new Error(`Native restart was not observed: ${snapshots.join(', ')}`);
      }
      if (!router.supports('probe_one', 'echo') || !router.supports('probe_two', 'echo')) {
        throw new Error('Router did not recover the crashed plugin while retaining the healthy one.');
      }
      process.stdout.write(
        'Independent native processes, owned configuration writes, success/failure billing receipts, crash isolation, and restart passed.\n',
      );
    } catch (error) {
      failed = true;
      process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    } finally {
      try {
        if (router) await router.stop();
      } catch (error) {
        failed = true;
        process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
      }
      try {
        if (manager) await manager.stopAll();
      } catch (error) {
        failed = true;
        process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
      }
      try {
        await rm(root, { recursive: true, force: true });
      } catch (error) {
        failed = true;
        process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
      }
      clearTimeout(watchdog);
      app.exit(failed ? 1 : 0);
    }
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exit(1);
  });
