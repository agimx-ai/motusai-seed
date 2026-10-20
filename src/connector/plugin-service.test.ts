import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeedPluginHost } from './plugin-host';
import type { SeedPluginRuntimeDefinition } from '../shared/contracts';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(fail = false) {
  const root = await mkdtemp(join(tmpdir(), 'seed-service-'));
  directories.push(root);
  await cp(resolve('packages/seed-sdk/tests/fixtures/generic'), join(root, 'plugin'), { recursive: true });
  const source = `import { PluginService } from '@motus-ai/seed-sdk'
export default class Service extends PluginService {
  onload() {
    this.addCapability({ id: 'probe', version: 1, methods: [{ name: 'echo', risk: 'read',
      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
      outputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
    }] }, { invoke: async (_method, request) => ({ value: request.arguments.value }) })
    this.registerMethod('private', () => this.app.package.data_path)
    this.register(() => this.app.invokeHost('fixture.cleanup', {}))
    ${fail ? "throw new Error('failed initialization')" : ''}
  }
}`;
  await writeFile(join(root, 'plugin/src/service.ts'), source);
  const tools = await import(/* @vite-ignore */ pathToFileURL(resolve('packages/seed-sdk/dist/tools/index.mjs')).href);
  const { output, manifest } = await tools.buildPlugin({
    root: join(root, 'plugin'),
    runtime: 'native-host',
    service: 'src/service.ts',
  });
  const definition: SeedPluginRuntimeDefinition = {
    api_version: 2,
    has_service: true,
    resources: manifest.resources.map((resource: { path: string }) => resource.path),
    sdk_manifest: manifest,
    package_id: manifest.id,
    version: manifest.version,
    publisher_type: 'official',
    runtime_kind: 'native-host',
    root_path: output,
    entry_path: join(output, 'main.js'),
    sidecars: [],
    permissions: [],
    consumes: [],
    capabilities: [],
  };
  const invoke = vi.fn(async () => null);
  const host = new SeedPluginHost({
    configuration: () => ({
      type: 'configure',
      appVersion: '0.2.15',
      locale: 'en-US',
      backupRoot: join(root, 'backups'),
      pluginDataRoot: join(root, 'plugin-data'),
      plugins: [definition],
    }),
    invoke_host: invoke,
  });
  return { root, definition, host, invoke };
}

describe('class-based plugin service execution', () => {
  it('retains capability contracts, private data paths and scoped private service calls', async () => {
    const { root, definition, host, invoke } = await fixture();
    const privateRoot = join(root, 'plugin-data', definition.package_id);
    await mkdir(privateRoot, { recursive: true });
    await writeFile(join(privateRoot, 'existing-session.json'), '{"pending":true}');
    try {
      expect(await host.start([definition])).toEqual([]);
      expect(
        await host.invoke('probe', 'echo', { request_id: 'echo', arguments: { value: 'same interface' } }),
      ).toEqual({ value: 'same interface' });
      await expect(
        host.invoke('probe', 'echo', { request_id: 'invalid', arguments: { value: 42 } }),
      ).rejects.toMatchObject({ code: 'invalid_arguments' });
      expect(await host.callService(definition.package_id, 'private', {})).toBe(privateRoot);
      await expect(host.callService('com.example.other', 'private', {})).rejects.toThrow('not running');
      expect(await readFile(join(privateRoot, 'existing-session.json'), 'utf8')).toBe('{"pending":true}');
    } finally {
      await host.stop();
    }
    expect(invoke.mock.calls.filter(([service]) => service === 'fixture.cleanup')).toHaveLength(1);
    await expect(host.callService(definition.package_id, 'private', {})).rejects.toThrow('not running');
  });

  it('removes partial registrations after onload fails without trying a legacy entry', async () => {
    const { definition, host, invoke } = await fixture(true);
    try {
      expect(await host.start([definition])).toEqual([
        expect.objectContaining({ packageId: definition.package_id, message: 'failed initialization' }),
      ]);
      expect(host.runtimeSnapshot(definition.package_id).capabilities).toEqual([]);
      await expect(host.callService(definition.package_id, 'private', {})).rejects.toThrow('not running');
      expect(invoke.mock.calls.filter(([service]) => service === 'fixture.cleanup')).toHaveLength(1);
    } finally {
      await host.stop();
    }
  });

  it('discovers and validates code-registered methods without a manifest capability list', async () => {
    const { definition, host } = await fixture();
    try {
      expect(definition.capabilities).toEqual([]);
      expect(await host.start([definition])).toEqual([]);
      expect(host.runtimeSnapshot(definition.package_id)).toMatchObject({
        capabilities: ['probe'],
        capabilityDefinitions: [{ id: 'probe', methods: [{ name: 'echo', risk: 'read' }] }],
      });
      expect(host.methodDescriptor('probe', 'echo')?.method.risk).toBe('read');
      expect(
        await host.invoke('probe', 'echo', { request_id: 'echo', arguments: { value: 'code registration' } }),
      ).toEqual({ value: 'code registration' });
      await expect(host.invoke('probe', 'echo', { request_id: 'bad', arguments: { value: 42 } })).rejects.toMatchObject(
        { code: 'invalid_arguments' },
      );
      expect(await host.start([definition])).toEqual([]);
      expect(
        await host.invoke('probe', 'echo', {
          request_id: 'restart-config',
          arguments: { value: 'retained validators' },
        }),
      ).toEqual({ value: 'retained validators' });
    } finally {
      await host.stop();
    }
    expect(host.runtimeSnapshot(definition.package_id)).not.toHaveProperty('capabilityDefinitions');
    expect(host.supports('probe', 'echo')).toBe(false);
  });

  it('publishes no code-registered capability after partial initialization fails', async () => {
    const { definition, host } = await fixture(true);
    try {
      expect(await host.start([definition])).toHaveLength(1);
      expect(host.runtimeSnapshot(definition.package_id).capabilities).toEqual([]);
      expect(host.runtimeSnapshot(definition.package_id)).not.toHaveProperty('capabilityDefinitions');
      expect(host.supports('probe', 'echo')).toBe(false);
    } finally {
      await host.stop();
    }
  });

  it('validates process snapshots, preserves the prior registration after rejection, and removes it on exit', async () => {
    const { definition, host: local, invoke } = await fixture();
    await local.start([definition]);
    const snapshot = local.runtimeSnapshot(definition.package_id);
    const remoteInvoke = vi.fn(async (service: string) => (service === 'seed.native.start' ? snapshot : null));
    const remote = new SeedPluginHost({ configuration: () => null, invoke_host: remoteInvoke }, undefined, 'remote');
    try {
      expect(await remote.start([definition])).toEqual([]);
      expect(remote.methodDescriptor('probe', 'echo')?.method.inputSchema).toMatchObject({ type: 'object' });
      await expect(
        remote.invoke('probe', 'echo', { request_id: 'invalid-remote', arguments: { value: false } }),
      ).rejects.toMatchObject({ code: 'invalid_arguments' });
      expect(remoteInvoke.mock.calls.some(([service]) => service === 'seed.native.invoke')).toBe(false);
      expect(() =>
        remote.applyRemoteSnapshot(definition.package_id, {
          ...snapshot,
          capabilityDefinitions: [
            {
              ...snapshot.capabilityDefinitions![0]!,
              methods: [{ name: 'echo', risk: 'write', inputSchema: { type: 'object', $async: true } }],
            },
          ],
        }),
      ).toThrow();
      expect(remote.methodDescriptor('probe', 'echo')?.method.risk).toBe('read');
      remote.applyRemoteSnapshot(definition.package_id, null);
      expect(remote.supports('probe', 'echo')).toBe(false);
      expect(invoke).not.toHaveBeenCalledWith('fixture.cleanup', expect.anything());
    } finally {
      await remote.stop();
      await local.stop();
    }
  });
});
