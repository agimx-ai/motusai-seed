import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PluginSettingsSnapshot } from '@motus-ai/seed-sdk';
import { pluginConfigurationKey, type StoredPluginConfiguration } from '../shared/contracts';

const id = z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);
const value = z.json();
const request = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('load'), ids: z.array(id).min(1).max(16) }).strict(),
  z
    .object({
      operation: z.literal('save'),
      updates: z
        .array(z.object({ id, revision: z.string().regex(/^[0-9a-f]{64}$/), value }).strict())
        .min(1)
        .max(16),
    })
    .strict(),
]);

type SettingsStorage = {
  pluginConfiguration(key: string): StoredPluginConfiguration | undefined;
  setPluginConfigurations(updates: Record<string, StoredPluginConfiguration>, assertActive?: () => void): Promise<void>;
};

function snapshot(source: StoredPluginConfiguration | undefined): PluginSettingsSnapshot {
  const revision = createHash('sha256')
    .update(JSON.stringify(source === undefined ? { exists: false } : { exists: true, value: source }))
    .digest('hex');
  // Read the existing record in place, including credentials. Only the owning backend gets this API.
  return { revision, value: source === undefined ? null : structuredClone(source) };
}

/** The caller holds the shared per-plugin write lock, including for old configuration writes. */
export async function invokePluginSettings(
  store: SettingsStorage,
  pluginId: string,
  input: unknown,
  assertActive: () => void,
) {
  if (JSON.stringify(input).length > 1_048_576) throw new Error('Plugin settings request is too large.');
  const parsed = request.parse(input);
  const ids = parsed.operation === 'load' ? parsed.ids : parsed.updates.map((update) => update.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate settings record.');
  assertActive();
  if (parsed.operation === 'save') {
    const updates: Record<string, StoredPluginConfiguration> = {};
    for (const change of parsed.updates) {
      const key = pluginConfigurationKey(pluginId, change.id);
      if (snapshot(store.pluginConfiguration(key)).revision !== change.revision) {
        throw Object.assign(new Error('Plugin settings changed. Reload before saving.'), {
          code: 'plugin_settings_conflict',
        });
      }
      updates[key] = change.value as StoredPluginConfiguration;
    }
    await store.setPluginConfigurations(updates, assertActive);
    assertActive();
  }
  return Object.fromEntries(
    ids.map((id) => [id, snapshot(store.pluginConfiguration(pluginConfigurationKey(pluginId, id)))]),
  );
}
