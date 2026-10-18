import { describe, expect, it } from 'vitest';
import { capabilityProtocolDescriptor, pluginCapabilitySchema } from './plugin-capability';
import type { CapabilityDefinition } from '@motus-ai/seed-sdk';

const capability: CapabilityDefinition = {
  id: 'probe',
  version: 1,
  descriptionKey: 'probe.description',
  methods: [{ name: 'read_probe', risk: 'read', displayNameKey: 'probe.name', inputSchema: { type: 'object' } }],
};

describe('code-registered capability boundaries', () => {
  it('resolves exposure from the code contract, defaulting to terminal', () => {
    const definition = { id: 'probe', version: 1, methods: [{ name: 'now', risk: 'read' as const }] };
    expect(capabilityProtocolDescriptor(pluginCapabilitySchema.parse(definition)).exposure).toBe('terminal');
    for (const exposure of ['terminal', 'local', 'plugin'] as const)
      expect(capabilityProtocolDescriptor(pluginCapabilitySchema.parse({ ...definition, exposure })).exposure).toBe(
        exposure,
      );
  });

  it('preserves translated display names and enforces the public text limits after i18next resolution', () => {
    const translations = (name: string) => ({
      defaultLocale: 'en-US',
      resources: {
        'en-US': { probe: { name, description: 'Read a probe' } },
        'zh-CN': { probe: { name: '读取探针', description: '读取探针' } },
      },
    });
    expect(capabilityProtocolDescriptor(capability, translations('Read probe')).methods[0].display_name).toEqual({
      en_US: 'Read probe',
      zh_Hans: '读取探针',
    });
    for (const name of ['', ' ', 'x'.repeat(101)])
      expect(() => capabilityProtocolDescriptor(capability, translations(name))).toThrow();
    expect(() => capabilityProtocolDescriptor(capability, translations('Read probe'.repeat(100)))).toThrow();
    for (const displayNameKey of ['', 42, { en_US: 'Read probe' }, 'x'.repeat(513)])
      expect(() =>
        pluginCapabilitySchema.parse({ ...capability, methods: [{ ...capability.methods[0], displayNameKey }] }),
      ).toThrow();
    expect(() =>
      pluginCapabilitySchema.parse({
        ...capability,
        methods: [{ ...capability.methods[0], display_name: { en_US: 'Old declaration', zh_Hans: '旧声明' } }],
      }),
    ).toThrow();
  });

  it('validates desktop platforms at code registration', () => {
    const methods = [{ ...capability.methods[0], platforms: ['darwin', 'linux'] }];
    expect(pluginCapabilitySchema.parse({ ...capability, methods }).methods[0].platforms).toEqual(['darwin', 'linux']);
    for (const platforms of [[], ['windows']])
      expect(() => pluginCapabilitySchema.parse({ ...capability, methods: [{ ...methods[0], platforms }] })).toThrow();
  });

  it('requires an MCP description and object input schema in the code registration', () => {
    const method = { ...capability.methods[0], descriptionKey: 'probe.description', annotations: { 'mcp.tool': true } };
    expect(pluginCapabilitySchema.parse({ ...capability, methods: [method] })).toBeDefined();
    for (const invalid of [
      { ...method, descriptionKey: undefined },
      { ...method, inputSchema: { type: 'string' } },
    ])
      expect(() => pluginCapabilitySchema.parse({ ...capability, methods: [invalid] })).toThrow();
  });

  it('validates methods independently of manifest and view schemas', () => {
    expect(pluginCapabilitySchema.parse(capability)).toEqual(capability);
    expect(() => pluginCapabilitySchema.parse({ ...capability, renderer: 'seed.panel' })).toThrow();
    expect(() => pluginCapabilitySchema.parse({ ...capability, errors: {} })).toThrow();
    expect(() =>
      pluginCapabilitySchema.parse({ ...capability, methods: [...capability.methods, ...capability.methods] }),
    ).toThrow();
    expect(() =>
      pluginCapabilitySchema.parse({ ...capability, methods: [{ name: 'read_probe', risk: 'anything' }] }),
    ).toThrow();
    expect(() =>
      pluginCapabilitySchema.parse({
        ...capability,
        methods: [{ name: 'read_probe', risk: 'read', inputSchema: { $async: true } }],
      }),
    ).toThrow();
    expect(() =>
      pluginCapabilitySchema.parse({ ...capability, annotations: { executable: () => 'not metadata' } }),
    ).toThrow();
    expect(() =>
      pluginCapabilitySchema.parse({
        ...capability,
        methods: [{ name: 'read_probe', risk: 'read', annotations: { 'mcp.tool': true } }],
      }),
    ).toThrow();
  });

  it('resolves standard language resources only at the existing protocol boundary', () => {
    const descriptor = capabilityProtocolDescriptor(capability, {
      defaultLocale: 'en-US',
      resources: {
        'en-US': { probe: { description: 'Read a probe', name: 'Read probe' } },
        'zh-CN': { probe: { description: '读取探针', name: '读取探针' } },
      },
    });
    expect(descriptor.description).toEqual({ en_US: 'Read a probe', zh_Hans: '读取探针' });
    expect(descriptor.methods[0]?.display_name).toEqual({ en_US: 'Read probe', zh_Hans: '读取探针' });
    expect(descriptor.methods[0]?.inputSchema).toEqual({ type: 'object' });
    expect(descriptor).not.toHaveProperty('errors');
    expect(() => capabilityProtocolDescriptor(capability)).toThrow('Missing capability translation');
  });

  it('preserves dotted public methods while rejecting malformed explicit tool aliases', () => {
    const definition = {
      id: 'probe',
      version: 1,
      methods: [{ name: 'observation.start', risk: 'read', annotations: { 'agent.tool': true } }],
    };
    expect(pluginCapabilitySchema.parse(definition).methods[0]?.name).toBe('observation.start');
    for (const name of ['observation.start', 'InvalidAlias', '', 123]) {
      expect(() =>
        pluginCapabilitySchema.parse({
          ...definition,
          methods: [{ ...definition.methods[0], annotations: { 'agent.tool': true, 'agent.tool_name': name } }],
        }),
      ).toThrow('Invalid tool name');
    }
    expect(
      pluginCapabilitySchema.parse({
        ...definition,
        methods: [
          { ...definition.methods[0], annotations: { 'agent.tool': true, 'agent.tool_name': 'start_observation' } },
        ],
      }),
    ).toBeDefined();
    expect(() =>
      pluginCapabilitySchema.parse({
        ...definition,
        methods: [
          {
            ...definition.methods[0],
            descriptionKey: 'description',
            inputSchema: { type: 'object' },
            annotations: { 'mcp.tool': true },
          },
        ],
      }),
    ).toThrow('Invalid tool name');
  });

  it('keeps translated public error codes and scalar placeholders without putting errors in the manifest', () => {
    const descriptor = capabilityProtocolDescriptor(
      { id: 'probe', version: 1, methods: [{ name: 'read_probe', risk: 'read' }] },
      {
        defaultLocale: 'en-US',
        resources: {
          'en-US': { capabilities: { probe: { errors: { missing: 'Missing {{name}}' } } } },
          'zh-CN': { capabilities: { probe: { errors: { missing: '缺少 {{name}}' } } } },
        },
      },
    );
    expect(descriptor.errors).toEqual({ missing: { en_US: 'Missing {name}', zh_Hans: '缺少 {name}' } });
  });

  it('keeps billing mode and settlement validation at the code-registration boundary', () => {
    const annotations = {
      'billing.settlement': 'cloud_relay',
      'billing.relay_template': 'probe',
      'billing.product': 'probe',
    };
    const registered = (billing: Record<string, unknown>) => ({
      ...capability,
      methods: [{ ...capability.methods[0], annotations: billing }],
    });
    expect(pluginCapabilitySchema.parse(registered(annotations))).toBeDefined();
    expect(
      pluginCapabilitySchema.parse(registered({ 'billing.settlement': 'local_relay', 'billing.product': 'probe' })),
    ).toBeDefined();
    for (const invalid of [
      { ...annotations, 'billing.mode': 'free' },
      { ...annotations, 'billing.exempt': true },
      { ...annotations, 'billing.settlement': 'unsupported' },
      { 'billing.settlement': 'cloud_relay' },
      { 'billing.settlement': 'local_relay' },
      { 'billing.product': 'probe' },
      { ...annotations, 'billing.settlement': 'local_relay' },
    ]) {
      expect(() => pluginCapabilitySchema.parse(registered(invalid))).toThrow();
    }
  });
});
