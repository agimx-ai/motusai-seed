import { describe, expect, it, vi } from 'vitest';
import { fetchMcpClients } from './mcp-clients';

describe('MCP client icon configuration', () => {
  it('reads ordered IDs from the verified distribution origin', async () => {
    const request = vi.fn(async (_url: URL) => new Response(JSON.stringify({ clients: ['vscode', 'codex', 'future-icon'] })));
    expect(await fetchMcpClients('wss://cloud.example/api/v1/distributions/motusai/events', request)).toEqual(['vscode', 'codex', 'future-icon']);
    expect(String(request.mock.calls[0]?.[0])).toBe('https://cloud.example/api/v1/distributions/motusai/mcp-clients');
  });
  it('prefers the new ordered entries even when the legacy list differs', async () => {
    const entries = [{ id: 'cursor-client', name: 'Cursor', icon_id: 'cursor' }];
    const request = vi.fn(async () => new Response(JSON.stringify({ clients: ['codex'], entries })));
    const url = 'https://cloud.example/api/events';
    expect(await fetchMcpClients(url, request)).toEqual(entries);
    request.mockImplementation(async () => new Response(JSON.stringify({ clients: ['codex'], entries: [] })));
    expect(await fetchMcpClients(url, request)).toEqual([]);
  });
  it('derives custom SVG URLs from the distribution origin', async () => {
    const icon_id = 'svg-' + 'a'.repeat(60);
    const entry = { id: 'custom', name: 'Custom', icon_id };
    const request = vi.fn(async () => new Response(JSON.stringify({
      clients: [],
      entries: [{ ...entry, uploadedIconUrl: 'https://untrusted.example/icon.svg' }],
    })));
    const entries = await fetchMcpClients('wss://cloud.example/distributions/motusai/events?token=x', request);
    expect(entries).toEqual([{
      ...entry,
      uploadedIconUrl: `https://cloud.example/distributions/motusai/mcp-clients/icons/${icon_id}`,
    }]);
  });
  it('rejects malformed data and untrusted URL shapes', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ clients: ['../icon'] })));
    await expect(fetchMcpClients('https://cloud.example/api/events', request)).rejects.toThrow();
    await expect(fetchMcpClients('https://user@cloud.example/api/events', request)).rejects.toThrow();
  });
});
