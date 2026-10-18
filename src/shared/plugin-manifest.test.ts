import { describe, expect, it } from 'vitest';
import { seedConsumedCapabilitySchema, seedPluginLabelsSchema } from './plugin-manifest';

describe('static consumption boundaries', () => {
  it('retains exact method and annotation-based consumption without view declarations', () => {
    expect(seedConsumedCapabilitySchema.parse({ capability: 'probe', methods: ['echo'] })).toEqual({
      capability: 'probe',
      methods: ['echo'],
    });
    expect(seedConsumedCapabilitySchema.parse({ match: { method_annotation: 'agent.tool', equals: true } })).toEqual({
      match: { method_annotation: 'agent.tool', equals: true },
    });
    expect(() => seedConsumedCapabilitySchema.parse({ capability: 'probe', methods: ['echo', 'echo'] })).toThrow();
    expect(() => seedPluginLabelsSchema.parse(['utilities', 'utilities'])).toThrow();
  });
});
