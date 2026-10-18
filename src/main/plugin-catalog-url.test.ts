import { describe, expect, it } from 'vitest';
import { pluginCatalogV2Url } from './plugin-catalog-url';

describe('v2 plugin catalog endpoint', () => {
  it('uses the same trusted host, distribution and base path without changing other API endpoints', () => {
    expect(
      pluginCatalogV2Url('https://cloud.example.com/base/api/v1/catalog/example/plugins?query=terminal').toString(),
    ).toBe('https://cloud.example.com/base/api/v2/catalog/example/plugins?query=terminal');
    expect(pluginCatalogV2Url('https://cloud.example.com/api/v2/catalog/example/plugins').pathname).toBe(
      '/api/v2/catalog/example/plugins',
    );
  });
  it('does not fall back to a v1 or unknown plugin endpoint', () => {
    expect(() => pluginCatalogV2Url('https://cloud.example.com/plugins')).toThrow('v2');
  });
});
