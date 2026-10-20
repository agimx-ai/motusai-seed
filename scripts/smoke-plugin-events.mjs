import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { app, protocol } from 'electron';
import { buildPlugin } from '@motus-ai/seed-sdk/tools';

const require = createRequire(import.meta.url);
const { SeedRuntime } = require('../dist/electron/main/runtime.js');
const { PluginCapabilityCatalog } = require('../dist/electron/main/plugin-capability-catalog.js');
const { PluginEventBroker } = require('../dist/electron/main/plugin-event-broker.js');
const { NativePluginManager } = require('../dist/electron/main/native-plugin-manager.js');
const { SeedPluginSandboxSupervisor } = require('../dist/electron/main/plugin-sandbox-host.js');
const { inspectPluginDirectory, directoryRuntimePlugin } = require('../dist/electron/main/plugin-directory.js');
const root = await mkdtemp(join(tmpdir(), 'seed-plugin-events-'));
app.setPath('userData', join(root, 'user-data'));
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  { scheme: 'seed-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
const deadline = setTimeout(() => {
  process.stderr.write('Plugin event smoke timed out.\n');
  app.exit(2);
}, 60_000);

const definition = {
  id: 'probe', version: 1, exposure: 'plugin', methods: [],
  events: [{ name: 'changed', version: 1, dataSchema: {
    type: 'object', additionalProperties: false, properties: { value: { type: 'integer' } }, required: ['value'],
  } }],
};

async function fixture(name, kind, producer) {
  const directory = join(root, name);
  await mkdir(join(directory, 'src'), { recursive: true });
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({
    id: 'com.example.' + name, name, version: '1.0.0', minAppVersion: app.getVersion(),
    author: 'Example', description: 'Generic public event fixture.',
    ...(producer ? {} : { consumes: [{ capability: 'probe', events: ['changed'] }] }),
  }));
  await writeFile(join(directory, 'src/main.ts'), `import {Plugin} from '@motus-ai/seed-sdk'; export default class extends Plugin {}`);
  if (producer) await writeFile(join(directory, 'src/capabilities.ts'), `export const capabilities = [${JSON.stringify(definition)}];`);
  await writeFile(join(directory, 'src/service.ts'), producer ? `
import {PluginService} from '@motus-ai/seed-sdk';
import {capabilities} from './capabilities';
export default class extends PluginService { onload() {
  this.addCapability(capabilities[0]);
  this.registerMethod('publish', args => this.app.events.publish({capability:'probe',event:'changed',version:1,data:args}));
  this.registerMethod('private', () => this.publish('changed', {value:999}));
} }` : `
import {PluginService} from '@motus-ai/seed-sdk';
export default class extends PluginService {
  received = []; closedError = ''; subscription;
  onload() {
    this.registerMethod('listen', async args => {
      this.closedError = '';
      this.subscription = await this.app.events.subscribe({provider_plugin_id:String(args.provider),capability:'probe',event:'changed',version:1}, event => {this.received.push(event)});
      void this.subscription.closed.catch(error => {this.closedError = error.code});
      return this.subscription.id;
    });
    this.registerMethod('status', () => ({received:this.received,closedError:this.closedError}));
    this.registerMethod('unsubscribe', async () => {await this.subscription.unsubscribe();await this.subscription.closed;return true});
  }
}`);
  const { output } = await buildPlugin({ root: directory, runtime: kind, service: 'src/service.ts' });
  const metadata = JSON.parse(await readFile(join(output, 'metadata.json'), 'utf8'));
  if (producer) assert.deepEqual(metadata.capabilities[0].events, definition.events);
  return directoryRuntimePlugin(await inspectPluginDirectory(output), 'official');
}

app.whenReady().then(async () => {
  let failed = false, native, sandbox;
  try {
    const catalog = new PluginCapabilityCatalog(), diagnostics = [];
    const runtime = Object.assign(Object.create(SeedRuntime.prototype), {
      runtimePlugins: [], stopping: false, pluginCapabilityCatalog: catalog,
      pluginIsAuthorized: () => true, configureWorker: () => Promise.resolve(),
      pluginViewHosts: new Map(), capabilityCalls: new Map(), sandboxCalls: new Map(), sandboxTasks: new Map(),
      systemNotifications: {clear: () => {}},
      hostServices: new Map([['seed.plugin.diagnostic', args => {diagnostics.push(args);return null}]]),
    });
    runtime.pluginEvents = new PluginEventBroker(() => runtime.runtimePlugins, catalog);
    const broker = (...args) => runtime.invokePluginBroker(...args);
    const stopped = id => {void runtime.releasePluginWork(id);catalog.remove(id)};
    native = new NativePluginManager('Event smoke', broker,
      (id, snapshot) => {if(!snapshot) stopped(id)},
      (_id, event, error) => {if(event === 'native.process.gone') throw error},
      () => {}, (_id, stream, chunk) => {if(stream === 'stderr') process.stderr.write(chunk)});
    sandbox = new SeedPluginSandboxSupervisor(broker, (id, event, message) => {
      if(event === 'plugin.process.gone') stopped(id);
      if(event.endsWith('.failed')) process.stderr.write(event + ': ' + message + '\n');
    });
    const configuration = () => ({type:'configure',appVersion:app.getVersion(),locale:'en-US',
      backupRoot:join(root,'backups'),pluginDataRoot:join(root,'data'),plugins:runtime.runtimePlugins});
    const start = async plugin => {
      if(plugin.runtime_kind === 'native-host') await native.start(plugin, configuration());
      else await sandbox.configure(runtime.runtimePlugins);
    };
    const call = (plugin, method, args = {}) => plugin.runtime_kind === 'native-host'
      ? native.call(plugin.package_id, {type:'service-call',method,arguments:args})
      : sandbox.callService(plugin.package_id, method, args);
    const waitStatus = async (plugin, check) => {
      const until = Date.now() + 5000;
      while(Date.now() < until) {
        const status = await call(plugin, 'status');
        if(check(status)) return status;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Consumer did not reach expected state: ' + JSON.stringify(await call(plugin, 'status')));
    };
    let index = 0;
    for(const producerKind of ['native-host','sandboxed-web']) for(const consumerKind of ['native-host','sandboxed-web']) {
      index++;
      let producer = await fixture('source-' + index, producerKind, true);
      const consumer = await fixture('consumer-' + index, consumerKind, false);
      runtime.runtimePlugins = [producer]; await start(producer);
      runtime.runtimePlugins = [producer, consumer]; await start(consumer);
      await call(consumer, 'listen', {provider:producer.package_id});
      for(const value of [1,2,3]) await call(producer, 'publish', {value});
      const status = await waitStatus(consumer, state => state.received.length === 3);
      assert.deepEqual(status.received.map(event => event.data.value), [1,2,3]);
      assert(status.received.every(event => event.provider_plugin_id === producer.package_id));
      await assert.rejects(call(producer, 'publish', {value:'invalid'}), {code:'plugin_event_schema'});
      await call(producer, 'private');
      assert.equal((await call(consumer, 'status')).received.length, 3);
      await runtime.releasePluginWork(producer.package_id);
      if(producerKind === 'native-host') await native.stop(producer.package_id);
      else await sandbox.configure([consumer]);
      catalog.remove(producer.package_id);
      await waitStatus(consumer, state => state.closedError === 'plugin_event_provider_stopped');
      producer = {...producer,configuration_revision:randomUUID()};
      runtime.runtimePlugins = [producer, consumer]; await start(producer);
      await call(producer, 'publish', {value:4});
      assert.equal((await call(consumer, 'status')).received.length, 3);
      await call(consumer, 'listen', {provider:producer.package_id});
      await call(producer, 'publish', {value:5});
      const restored = await waitStatus(consumer, state => state.received.length === 4);
      assert.deepEqual(restored.received.map(event => event.data.value), [1,2,3,5]);
      await call(consumer, 'unsubscribe');
      assert.equal(runtime.pluginEvents.subscriptions.size, 0);
      runtime.pluginEvents.clear();
      await native.stopAll(); sandbox.destroy();
      catalog.remove(producer.package_id); catalog.remove(consumer.package_id);
      runtime.runtimePlugins = [];
      process.stdout.write(`PASS ${producerKind} -> ${consumerKind}: code contract, schema rejection, private UI isolation, reload and cancellation.\n`);
    }
    assert(diagnostics.every(({entry}) => entry?.event === 'plugin.event.subscription.failed' ||
      (entry?.event === 'capability.failed' && entry.operation === 'service.publish' &&
        entry.message === 'Plugin event data does not match its registered schema.')));
  } catch(error) {failed = true;process.stderr.write(String(error.stack || error) + '\n')}
  finally {
    await native?.stopAll(); sandbox?.destroy();
    await rm(root, {recursive:true,force:true}); clearTimeout(deadline); app.exit(failed ? 1 : 0);
  }
});
