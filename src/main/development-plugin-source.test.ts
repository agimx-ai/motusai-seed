import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevelopmentPluginSource } from './development-plugin-source';
import { SeedPluginHost } from '../connector/plugin-host';

const roots: string[] = [],
  sources: DevelopmentPluginSource[] = [],
  hosts: SeedPluginHost[] = [];
afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.stop()));
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const hash = (body: Buffer) => createHash('sha256').update(body).digest('hex');
async function bundle(root: string, id = 'com.example.probe', value = 'first', extra: Record<string, unknown> = {}) {
  const directory = join(root, id);
  await mkdir(directory, { recursive: true });
  const main = Buffer.from(`export const seedPluginBundleVersion = 2;
export function loadView(modules) { return class extends modules['@motus-ai/seed-sdk'].Plugin {}; }
export function loadService(modules) { return class extends modules['@motus-ai/seed-sdk'].PluginService {
  onload() { this.registerMethod('value', () => ${JSON.stringify(value)});
    this.registerMethod('identity', () => this.identity ??= crypto.randomUUID());
    this.addCapability({ id: 'probe', version: 1, methods: [{ name: 'echo', risk: 'read' }] }, { invoke: async (_method, request) => request.arguments }); }
}; }`);
  const style = Buffer.from('.custom-control { color: red; }');
  const manifest = {
    id,
    name: 'Probe',
    description: 'Fixture',
    author: 'Example',
    version: '1.0.0',
    minAppVersion: '0.2.15',
    apiVersion: 2,
    runtime: 'native-host',
    service: true,
    resources: [
      { path: 'main.js', sha256: hash(main) },
      { path: 'styles.css', sha256: hash(style) },
    ],
    ...extra,
  };
  await writeFile(join(directory, 'main.js'), main);
  await writeFile(join(directory, 'styles.css'), style);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  return directory;
}
async function fixture() {
  const userData = await mkdtemp(join(tmpdir(), 'seed-development-source-'));
  roots.push(userData);
  const root = join(userData, 'plugins/development'),
    changed = vi.fn(),
    report = vi.fn();
  const source = new DevelopmentPluginSource(root, '0.2.15', changed, report);
  sources.push(source);
  await source.start();
  const host = new SeedPluginHost({
    configuration: () => ({
      type: 'configure',
      appVersion: '0.2.15',
      locale: 'en-US',
      backupRoot: join(userData, 'backups'),
      pluginDataRoot: join(userData, 'plugin-data'),
      plugins: [],
    }),
    invoke_host: async () => null,
  });
  hosts.push(host);
  return { root, userData, source, changed, report, host };
}

describe('development directory discovery and reload', () => {
  it('recognizes manually placed bundles without marketplace state, a ZIP or source execution', async () => {
    const h = await fixture();
    await bundle(h.root);
    const entries = await h.source.refresh();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.installed).toMatchObject({ source: 'development', version: '1.0.0' });
    expect(entries[0]!.runtime.entry_path).toContain(join('.runtime', 'com.example.probe'));
    expect(await h.host.start(entries.map((entry) => entry.runtime))).toEqual([]);
    expect(await h.host.callService('com.example.probe', 'value', {})).toBe('first');
    expect(await readdir(join(h.userData, 'plugins'))).toEqual(['development']);
  });
  it('reloads same-version builds, keeps unrelated instances and reuses private data paths', async () => {
    const h = await fixture();
    await bundle(h.root);
    await bundle(h.root, 'com.example.other', 'other');
    let entries = await h.source.refresh();
    await h.host.start(entries.map((entry) => entry.runtime));
    const original = entries[0]!.installed.version;
    const identity = await h.host.callService('com.example.other', 'identity', {});
    const data = join(h.userData, 'plugin-data/com.example.probe/session.json');
    await writeFile(data, '{"pending":true}');
    await bundle(h.root, 'com.example.probe', 'second');
    entries = await h.source.refresh();
    expect(await h.host.start(entries.map((entry) => entry.runtime))).toEqual([]);
    expect(await h.host.callService('com.example.probe', 'value', {})).toBe('second');
    expect(await h.host.callService('com.example.other', 'identity', {})).toBe(identity);
    expect(entries[0]!.installed.version).toBe(original);
    expect(await readFile(data, 'utf8')).toBe('{"pending":true}');
    await h.source.pruneSnapshots();
    expect(await readdir(join(h.root, '.runtime/com.example.probe'))).toHaveLength(1);
  });
  it('retains the last complete snapshot during partial edits and checksum failures', async () => {
    const h = await fixture(),
      directory = await bundle(h.root);
    const [original] = await h.source.refresh();
    await h.host.start([original!.runtime]);
    await writeFile(join(directory, 'main.js'), 'incomplete');
    const [retained] = await h.source.refresh();
    expect(retained).toBe(original);
    expect(h.report).toHaveBeenCalled();
    expect(await h.host.callService('com.example.probe', 'value', {})).toBe('first');
    expect(await readFile(original!.runtime.entry_path, 'utf8')).not.toBe('incomplete');
    await bundle(h.root, 'com.example.probe', 'recovered');
    expect((await h.source.refresh())[0]!.installed.manifestDigest).not.toBe(original!.installed.manifestDigest);
  });
  it('unloads removed folders without deleting retained conversations', async () => {
    const h = await fixture(),
      directory = await bundle(h.root),
      [entry] = await h.source.refresh();
    await h.host.start([entry!.runtime]);
    const data = join(h.userData, 'plugin-data/com.example.probe/session.json');
    await writeFile(data, '{"pending":true}');
    await rm(directory, { recursive: true });
    const entries = await h.source.refresh();
    expect(entries).toEqual([]);
    await h.host.start([]);
    await h.source.pruneSnapshots();
    expect(h.host.supports('probe', 'echo')).toBe(false);
    expect(await readFile(data, 'utf8')).toBe('{"pending":true}');
  });
  it('restores valid bundles after host restart without a registration database', async () => {
    const h = await fixture();
    await bundle(h.root);
    const [before] = await h.source.refresh();
    await h.source.stop();
    const fresh = new DevelopmentPluginSource(h.root, '0.2.15', vi.fn(), vi.fn());
    sources.push(fresh);
    await fresh.start();
    const [after] = await fresh.refresh();
    expect(after!.runtime).toEqual(before!.runtime);
  });
  it('coalesces filesystem changes and stops watching on shutdown', async () => {
    const h = await fixture();
    await bundle(h.root);
    await vi.waitFor(() => expect(h.changed).toHaveBeenCalled(), { timeout: 3000 });
    await h.source.stop();
    h.changed.mockClear();
    await bundle(h.root, 'com.example.probe', 'after stop');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(h.changed).not.toHaveBeenCalled();
  });
  it('does not accept a runtime snapshot whose manifest differs from the verified source', async () => {
    const h = await fixture();
    await bundle(h.root);
    const [entry] = await h.source.refresh();
    const file = join(entry!.runtime.root_path, 'manifest.json');
    await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), name: 'Tampered snapshot' }));
    await h.source.stop();
    const fresh = new DevelopmentPluginSource(h.root, '0.2.15', vi.fn(), h.report);
    sources.push(fresh);
    await fresh.start();
    expect(await fresh.refresh()).toEqual([]);
    expect(h.report).toHaveBeenCalled();
  });
  it('rejects mismatched identities, symlinks and unsupported bundles', async () => {
    const h = await fixture();
    await bundle(h.root, 'com.example.wrong', 'first', { id: 'com.example.other' });
    await bundle(h.root, 'com.example.old', 'first', { apiVersion: 1 });
    await symlink(
      join(h.root, 'com.example.wrong'),
      join(h.root, 'com.example.link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(await h.source.refresh()).toEqual([]);
    expect(h.report).toHaveBeenCalledTimes(3);
  });
});
