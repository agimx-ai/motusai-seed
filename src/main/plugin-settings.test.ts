import { describe, expect, it, vi } from 'vitest';
import { invokePluginSettings } from './plugin-settings';
import { PluginSettingsStore } from '@motus-ai/seed-sdk';
import { pluginConfigurationKey, type StoredPluginConfiguration } from '../shared/contracts';

type Settings = {
  schema_version: 1;
  profiles: Array<{ id: string }>;
  default_profile_id: string;
  values: Record<string, string>;
};
const value = (): Settings => ({ schema_version: 1, profiles: [], default_profile_id: '', values: {} });
function fixture() {
  const records = new Map<string, StoredPluginConfiguration>();
  const active = vi.fn();
  const storage = {
    pluginConfiguration: (key: string) => records.get(key),
    setPluginConfigurations: vi.fn(async (updates: Record<string, StoredPluginConfiguration>, check?: () => void) => {
      await Promise.resolve();
      check?.();
      for (const [key, record] of Object.entries(updates)) records.set(key, structuredClone(record));
    }),
  };
  const invoke = (owner: string, request: unknown) => invokePluginSettings(storage, owner, request, active);
  const controller = new AbortController();
  const client = new PluginSettingsStore((_service, args) => invoke('com.example.owner', args), controller.signal);
  return { records, storage, active, invoke, controller, client };
}

describe('code-owned settings storage', () => {
  it('reads existing encrypted configuration records in place, retaining credentials and defaults', async () => {
    const { records, client } = fixture(),
      record = {
        ...value(),
        profiles: [{ id: 'existing', secret: 'saved-credential' }],
        default_profile_id: 'existing',
      };
    records.set(pluginConfigurationKey('com.example.owner', 'accounts'), record);
    expect(await client.get<Settings>('accounts')).toEqual(record);
    expect(records.size).toBe(1);
  });

  it('isolates identical setting names by plugin and rejects namespace injection', async () => {
    const { records, client } = fixture();
    records.set(pluginConfigurationKey('com.example.other', 'accounts'), { ...value(), values: { secret: 'private' } });
    expect(await client.get<Settings>('accounts')).toBeNull();
    await expect(client.get('com.example.other:accounts')).rejects.toThrow();
    await expect(client.get('../accounts')).rejects.toThrow();
  });

  it('rejects stale writes without restoring a deleted profile or losing another update', async () => {
    const { client } = fixture(),
      stale = await client.snapshot('accounts');
    await client.save('accounts', { ...value(), values: { current: 'new' } }, stale.revision);
    await expect(client.save('accounts', value(), stale.revision)).rejects.toMatchObject({
      code: 'plugin_settings_conflict',
    });
    expect((await client.get<Settings>('accounts'))?.values).toEqual({ current: 'new' });
  });

  it('updates related default groups atomically and rejects the entire conflicting batch', async () => {
    const { client, storage } = fixture();
    await client.transaction(['hosted', 'custom'], () => ({ hosted: value(), custom: value() }));
    expect(storage.setPluginConfigurations).toHaveBeenCalledTimes(1);
    const hosted = await client.snapshot('hosted'),
      custom = await client.snapshot('custom');
    await client.save('custom', { ...value(), values: { changed: 'yes' } }, custom.revision);
    const count = storage.setPluginConfigurations.mock.calls.length;
    await expect(
      client.transaction(['hosted', 'custom'], async () => {
        await client.save('custom', value(), (await client.snapshot('custom')).revision);
        return { hosted: { ...value(), values: { invalid: 'stale' } }, custom: value() };
      }),
    ).rejects.toMatchObject({ code: 'plugin_settings_conflict' });
    expect(storage.setPluginConfigurations).toHaveBeenCalledTimes(count + 1);
    expect((await client.snapshot('hosted')).revision).toBe(hosted.revision);
  });

  it('serializes updates in one service and preserves concurrent profile additions', async () => {
    const { client } = fixture();
    await Promise.all(
      ['one', 'two'].map((id) =>
        client.update<Settings>('accounts', (current) => ({
          ...(current ?? value()),
          profiles: [...(current?.profiles ?? []), { id }],
        })),
      ),
    );
    expect((await client.get<Settings>('accounts'))?.profiles.map((profile) => profile.id)).toEqual(['one', 'two']);
  });

  it('survives a new SDK instance without copying or reinitializing records', async () => {
    const { client, invoke } = fixture();
    await client.update<Settings>('accounts', () => ({ ...value(), values: { mode: 'saved' } }));
    const restarted = new PluginSettingsStore(
      (_service, args) => invoke('com.example.owner', args),
      new AbortController().signal,
    );
    expect((await restarted.get<Settings>('accounts'))?.values.mode).toBe('saved');
  });

  it('stores arbitrary plugin JSON without interpreting profiles or injecting defaults', async () => {
    const { client, records } = fixture();
    const values = [
      false,
      0,
      '',
      null,
      [1, true, { nested: 'value' }],
      {
        schema_version: 23,
        profiles: [{ id: 'same' }, { id: 'same' }],
        default_profile_id: 'missing',
        future: { enabled: true },
      },
    ];
    for (const [index, value] of values.entries()) {
      const id = 'record-' + index;
      const before = await client.snapshot(id);
      const after = await client.save(id, value, before.revision);
      expect(after.value).toEqual(value);
      expect(after.revision).not.toBe(before.revision);
      expect(await client.get(id)).toEqual(value);
      expect(records.get(pluginConfigurationKey('com.example.owner', id))).toEqual(value);
    }
  });
  it('rejects non-JSON and namespace spoofing before storing', async () => {
    const { client, invoke, storage } = fixture(),
      snapshot = await client.snapshot('accounts');
    for (const value of [undefined, NaN, Infinity, () => {}, { nested: undefined }])
      await expect(client.save('accounts', value, snapshot.revision)).rejects.toThrow();
    await expect(
      invoke('com.example.owner', { operation: 'load', ids: ['accounts'], package_id: 'com.example.other' }),
    ).rejects.toThrow();
    expect(storage.setPluginConfigurations).not.toHaveBeenCalled();
  });

  it('checks the runtime generation again inside the encrypted write queue', async () => {
    const { client, active, records } = fixture(),
      snapshot = await client.snapshot('accounts');
    active
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('Old runtime stopped');
      });
    await expect(client.save('accounts', value(), snapshot.revision)).rejects.toThrow('Old runtime stopped');
    expect(records.size).toBe(0);
  });

  it('does not start new work after unload or reinterpret storage errors as empty settings', async () => {
    const { client, controller, storage } = fixture();
    storage.pluginConfiguration = () => {
      throw new Error('Decryption unavailable');
    };
    await expect(client.get<Settings>('accounts')).rejects.toThrow('Decryption unavailable');
    controller.abort();
    await expect(client.get<Settings>('accounts')).rejects.toThrow('no longer running');
  });
});
