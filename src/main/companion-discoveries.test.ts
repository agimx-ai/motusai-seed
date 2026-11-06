import { describe, expect, it, vi } from 'vitest';
import { CompanionDiscoveryFeed } from './companion-discoveries';

const corners = ['top-left', 'bottom-left', 'top-right', 'bottom-right'] as const;
const fixture = {
  revision: 1,
  updated_at: '2026-11-03T00:00:00.000Z',
  items: corners.map((corner) => ({ corner, enabled: true, title: { 'zh-CN': '介绍', 'en-US': 'Introduction' }, url: 'https://example.com/guide' })),
};

describe('companion discovery feed', () => {
  it('loads cached content, retains it on failures and replaces it with a valid disabled configuration', async () => {
    let cache = JSON.stringify(fixture);
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...fixture, revision: 2, items: fixture.items.map((item) => ({ ...item, enabled: false })) }), { status: 200 }));
    const changed = vi.fn();
    const feed = new CompanionDiscoveryFeed({
      eventsUrl: async () => 'wss://cloud.example.com/api/v1/distributions/motusai/events',
      readCache: async () => cache,
      writeCache: async (value) => { cache = value; },
      changed,
      fetch: fetcher,
    });
    await feed.loadCache();
    expect(feed.snapshot()).toEqual(fixture.items);
    await feed.refresh();
    expect(feed.snapshot()).toEqual(fixture.items);
    expect(changed).not.toHaveBeenCalled();
    await feed.refresh();
    expect(feed.snapshot().every((item) => !item.enabled)).toBe(true);
    expect(JSON.parse(cache).revision).toBe(2);
    expect(changed).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[1]![0])).toBe('https://cloud.example.com/api/v1/distributions/motusai/discoveries');
  });
  it('does not cache untrusted links or malformed content', async () => {
    const writeCache = vi.fn();
    const feed = new CompanionDiscoveryFeed({ eventsUrl: async () => 'wss://cloud.example.com/api/v1/distributions/motusai/events', readCache: async () => undefined, writeCache, changed: vi.fn(), fetch: vi.fn(async () => new Response(JSON.stringify({ ...fixture, items: fixture.items.map((item) => ({ ...item, url: 'javascript:alert(1)' })) }))) });
    await feed.refresh();
    expect(feed.snapshot()).toEqual([]);
    expect(writeCache).not.toHaveBeenCalled();
  });
  it('loads, refreshes and caches introductions without destinations', async () => {
    const items = fixture.items.map((item, index) => ({ ...item, url: index === 0 ? undefined : index === 1 ? '' : item.url }));
    let cache = JSON.stringify({ ...fixture, items });
    const changed = vi.fn();
    const feed = new CompanionDiscoveryFeed({
      eventsUrl: async () => 'wss://cloud.example.com/api/v1/distributions/motusai/events',
      readCache: async () => cache,
      writeCache: async (value) => { cache = value; },
      changed,
      fetch: vi.fn(async () => new Response(JSON.stringify({ ...fixture, revision: 2, items: items.map((item) => ({ ...item, url: '   ' })) }))),
    });
    await feed.loadCache();
    expect(feed.snapshot()).toEqual(items);
    await feed.refresh();
    expect(feed.snapshot()).toHaveLength(4);
    expect(feed.snapshot().every((item) => item.url === '')).toBe(true);
    expect(JSON.parse(cache).items.every((item: { url: string }) => item.url === '')).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
  });
});
