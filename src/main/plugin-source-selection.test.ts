import { describe, expect, it } from 'vitest';
import { selectDevelopmentOverrides } from './plugin-source-selection';

describe('local plugin source selection', () => {
  it.each([
    ['0.2.31', '0.3.0', false],
    ['0.4.0', '0.3.0', true],
    ['0.3.0', '0.3.0', true],
    ['0.10.0', '0.9.0', true],
    ['1.0.0-beta.10', '1.0.0-beta.2', true],
    ['1.0.0-beta.2', '1.0.0', false],
  ])('chooses the higher version: development %s versus installed %s', (developmentVersion, installedVersion, selected) => {
    const entry = { installed: { id: 'com.example.plugin', version: developmentVersion } };
    expect(selectDevelopmentOverrides([entry], [{ id: entry.installed.id, version: installedVersion }]))
      .toEqual(selected ? [entry] : []);
  });

  it('keeps development-only plugins and does not compare unrelated IDs', () => {
    const entry = { installed: { id: 'com.example.development', version: '0.1.0' } };
    expect(selectDevelopmentOverrides([entry], [{ id: 'com.example.other', version: '99.0.0' }])).toEqual([entry]);
  });
});
