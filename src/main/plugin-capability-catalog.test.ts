import { describe, expect, it } from 'vitest';
import { PluginCapabilityCatalog } from './plugin-capability-catalog';
import type { SeedPluginRuntimeDefinition } from '../shared/contracts';

const plugin = (): SeedPluginRuntimeDefinition => ({
  package_id: 'com.example.probe',
  version: '1.0.0',
  api_version: 2,
  publisher_type: 'official',
  runtime_kind: 'native-host',
  root_path: '/plugin',
  entry_path: '/plugin/main.js',
  permissions: ['cloud.relay'],
  consumes: [],
  sidecars: [],
  capabilities: [],
  sdk_manifest: {
    id: 'com.example.probe',
    name: 'Probe',
    description: 'Probe',
    author: 'Example',
    version: '1.0.0',
    minAppVersion: '0.2.15',
    translations: {
      defaultLocale: 'en-US',
      resources: { 'en-US': { probe: 'Read probe' }, 'zh-CN': { probe: '读取探针' } },
    },
  },
});
const definition = {
  id: 'probe',
  version: 1,
  methods: [
    {
      name: 'read_probe',
      risk: 'read',
      descriptionKey: 'probe',
      annotations: {
        'billing.settlement': 'cloud_relay',
        'billing.relay_template': 'probe',
        'billing.product': 'probe',
      },
      inputSchema: { type: 'object' },
    },
  ],
};

describe('host catalog from code registration', () => {
  it('makes billing metadata available without putting methods in the package manifest', () => {
    const catalog = new PluginCapabilityCatalog(),
      owner = plugin();
    expect(catalog.capabilities(owner)).toEqual([]);
    catalog.publish(owner, [definition]);
    expect(catalog.capabilities(owner)[0]?.methods[0]?.annotations?.['billing.settlement']).toBe('cloud_relay');
    expect(owner.capabilities).toEqual([]);
    expect(catalog.withCapabilities(owner).capabilities).toHaveLength(1);
  });

  it('rejects unsupported, duplicate and non-JSON code contracts', () => {
    const catalog = new PluginCapabilityCatalog(),
      owner = plugin();
    expect(() => catalog.publish(owner, [definition, definition])).toThrow('Duplicate');
    expect(() => catalog.publish(owner, [{ ...definition, renderer: 'seed.form' }])).toThrow();
    expect(() => catalog.publish({ ...owner, api_version: undefined }, [definition])).toThrow();
    expect(() => catalog.publish(owner, [{ ...definition, methods: [{ name: 'bad', risk: 'other' }] }])).toThrow();
    expect(catalog.capabilities(owner)).toEqual([]);
  });

  it('isolates plugin owners, rejects stale versions and removes stopped contributions', () => {
    const catalog = new PluginCapabilityCatalog(),
      owner = plugin();
    catalog.publish(owner, [definition]);
    expect(catalog.capabilities({ ...owner, package_id: 'com.example.other' })).toEqual([]);
    expect(catalog.capabilities({ ...owner, version: '2.0.0' })).toEqual([]);
    expect(catalog.capabilities({ ...owner, permissions: [] })).toEqual([]);
    catalog.remove(owner.package_id);
    expect(catalog.capabilities(owner)).toEqual([]);
  });
});
