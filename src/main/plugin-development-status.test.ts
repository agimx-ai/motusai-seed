import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pluginDevelopmentStatusFile, type PluginDevelopmentStatus } from '@motus-ai/seed-sdk';
import { readDevelopmentFeedback } from '@motus-ai/seed-sdk/tools';
import { PluginDevelopmentStatusWriter } from './plugin-development-status';

const roots: string[] = [];
const writers: PluginDevelopmentStatusWriter[] = [];
afterEach(async () => {
  await Promise.all(writers.splice(0).map((writer) => writer.stop()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('development CLI feedback from the real client status writer', () => {
  it('distinguishes a missing client, disabled mode, pending builds, exact loaded builds and errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seed-development-feedback-'));
    roots.push(root);
    const id = 'com.example.sample',
      digest = 'sha256:' + 'a'.repeat(64);
    expect(await readDevelopmentFeedback(root, id, digest)).toContain('Waiting for Seed');
    const state: Pick<PluginDevelopmentStatus, 'enabled' | 'plugins'> = { enabled: false, plugins: {} };
    const writer = new PluginDevelopmentStatusWriter(
      root,
      '0.3.11',
      () => state,
      () => {},
    );
    writers.push(writer);
    await writer.start();
    expect(await readDevelopmentFeedback(root, id, digest)).toContain('mode off');
    state.enabled = true;
    state.plugins[id] = { manifestDigest: digest, state: 'loading' };
    await writer.publish();
    expect(await readDevelopmentFeedback(root, id, digest)).toContain('is loading');
    state.plugins[id]!.state = 'loaded';
    await writer.publish();
    expect(await readDevelopmentFeedback(root, id, digest)).toContain('Seed loaded this build');
    expect(await readDevelopmentFeedback(root, id, 'sha256:' + 'b'.repeat(64))).toContain('waiting for Seed');
    state.plugins[id] = { manifestDigest: digest, state: 'failed', message: 'Requires a newer Seed client.' };
    await writer.publish();
    expect(await readDevelopmentFeedback(root, id, digest)).toContain('Requires a newer Seed client');
    state.plugins[id]!.state = 'superseded';
    await writer.publish();
    expect(await readDevelopmentFeedback(root, id, digest)).toContain('newer installed version');
  });

  it('does not accept stale acknowledgements and does not remove another client session on shutdown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seed-development-sessions-'));
    roots.push(root);
    const state = {
      enabled: true,
      plugins: { 'com.example.sample': { manifestDigest: 'digest', state: 'loaded' as const } },
    };
    const first = new PluginDevelopmentStatusWriter(
      root,
      '0.3.11',
      () => state,
      () => {},
    );
    const second = new PluginDevelopmentStatusWriter(
      root,
      '0.3.11',
      () => state,
      () => {},
    );
    writers.push(first, second);
    await first.start();
    const target = join(root, pluginDevelopmentStatusFile);
    const document = JSON.parse(await readFile(target, 'utf8'));
    document.updatedAt = Date.now() - 30_000;
    await writeFile(target, JSON.stringify(document));
    expect(await readDevelopmentFeedback(root, 'com.example.sample', 'digest')).not.toContain('Seed loaded');
    await second.start();
    await first.stop();
    expect(await readDevelopmentFeedback(root, 'com.example.sample', 'digest')).toContain('Seed loaded');
    await second.stop();
    expect(await readDevelopmentFeedback(root, 'com.example.sample', 'digest')).toContain('Waiting for Seed');
  });
});
