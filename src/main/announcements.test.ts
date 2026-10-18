import { describe, expect, it, vi } from 'vitest';
import { AnnouncementInbox, announcementFeedUrl } from './announcements';
import { announcementSchema } from '../shared/announcements';

const id = '550e8400-e29b-41d4-a716-446655440001';
const text = { 'zh-CN': '介绍', 'en-US': 'Announcement' };
const item = {
  id,
  title: text,
  description: text,
  button_label: text,
  dismiss_label: text,
  action: { kind: 'plugin', plugin_id: 'com.example.plugin' },
  background_url: `https://cloud.example/api/v1/announcements/${id}/background/image.png`,
};
const page = () => Response.json({ items: [item], next_cursor: null });
function fixture() {
  let user: string | undefined = 'alice';
  const reads = new Map<string, Set<string>>();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => page());
  const changed = vi.fn();
  const inbox = new AnnouncementInbox({
    userId: () => user,
    eventsUrl: async () => 'wss://cloud.example/api/v1/distributions/motusai/events',
    readIds: async (user) => [...(reads.get(user) ?? [])],
    markRead: async (user, id) => {
      const ids = reads.get(user) ?? new Set();
      ids.add(id);
      reads.set(user, ids);
    },
    fetch: fetcher,
    changed,
  });
  return {
    inbox,
    fetcher,
    changed,
    reads,
    user: (next: string | undefined) => {
      user = next;
      inbox.clear();
    },
  };
}
describe('announcement inbox', () => {
  it('defaults existing content to immersive and accepts only the two supported templates', () => {
    expect(announcementSchema.parse(item).template).toBe('immersive');
    expect(announcementSchema.parse({ ...item, template: 'image-above' }).template).toBe('image-above');
    expect(announcementSchema.safeParse({ ...item, template: 'unknown' }).success).toBe(false);
  });
  it('does not remove unread content if local persistence fails', async () => {
    const inbox = new AnnouncementInbox({
      userId: () => 'alice',
      eventsUrl: async () => 'https://cloud.example/api/v1/distributions/motusai/events',
      readIds: async () => [],
      markRead: async () => {
        throw new Error('disk full');
      },
      changed: vi.fn(),
      fetch: vi.fn().mockResolvedValue(page()),
    });
    await inbox.refresh();
    await expect(inbox.dismiss(id)).rejects.toThrow('disk full');
    expect(inbox.snapshot()).toHaveLength(1);
  });
  it('uses signed distribution origin without altering discovery', () => {
    expect(announcementFeedUrl('wss://cloud.example/api/v1/distributions/motusai/events').href).toBe(
      'https://cloud.example/api/v1/distributions/motusai/announcements',
    );
    expect(announcementFeedUrl('https://cloud.example/api/v1/distributions/motusai/events').href).toBe(
      'https://cloud.example/api/v1/distributions/motusai/announcements',
    );
    expect(announcementFeedUrl('ws://127.0.0.1:43180/api/v1/distributions/motusai/events').protocol).toBe('http:');
    expect(() => announcementFeedUrl('https://cloud.example/other')).toThrow();
  });
  it('backfills on reconnect and filters locally read IDs without cross-device state', async () => {
    const { inbox, reads } = fixture();
    await inbox.refresh();
    expect(inbox.snapshot()).toHaveLength(1);
    await inbox.dismiss(id);
    await inbox.refresh();
    expect(inbox.snapshot()).toEqual([]);
    expect(reads.get('alice')?.has(id)).toBe(true);
    const anotherDevice = fixture();
    await anotherDevice.inbox.refresh();
    expect(anotherDevice.inbox.snapshot()).toHaveLength(1);
  });
  it('does not resurrect a close during an in-flight fetch', async () => {
    const { inbox, fetcher } = fixture();
    await inbox.refresh();
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = inbox.refresh();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    await inbox.dismiss(id);
    resolve(page());
    await pending;
    expect(inbox.snapshot()).toEqual([]);
  });
  it('discards responses from an old account and does not fetch while signed out', async () => {
    const { inbox, fetcher, user } = fixture();
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = inbox.refresh();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    user(undefined);
    resolve(page());
    await pending;
    await inbox.refresh();
    expect(inbox.snapshot()).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    user('bob');
    await inbox.refresh();
    expect(inbox.snapshot()).toHaveLength(1);
  });
  it('preserves a loaded feed on temporary failure and removes withdrawn content on successful refresh', async () => {
    const { inbox, fetcher } = fixture();
    await inbox.refresh();
    fetcher.mockRejectedValueOnce(new Error('offline'));
    await inbox.refresh();
    expect(inbox.snapshot()).toHaveLength(1);
    fetcher.mockResolvedValueOnce(Response.json({ items: [], next_cursor: null }));
    await inbox.refresh();
    expect(inbox.snapshot()).toEqual([]);
  });
  it('rejects unsafe external destinations and untrusted background fetches', async () => {
    const { inbox, fetcher } = fixture();
    fetcher.mockResolvedValueOnce(
      Response.json({ items: [{ ...item, action: { kind: 'url', url: 'javascript:alert(1)' } }], next_cursor: null }),
    );
    await inbox.refresh();
    expect(inbox.snapshot()).toEqual([]);
    fetcher.mockResolvedValueOnce(
      Response.json({ items: [{ ...item, background_url: 'https://other.example/a.png' }], next_cursor: null }),
    );
    await inbox.refresh();
    await expect(inbox.background(id)).rejects.toThrow('Untrusted');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('loads only the requested raster background through the trusted host', async () => {
    const { inbox, fetcher } = fixture();
    await inbox.refresh();
    fetcher.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    );
    expect(await inbox.background(id)).toBe('data:image/png;base64,AQID');
    expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({ redirect: 'error' });
  });
  it('collects a complete feed without duplicate IDs or looping cursors', async () => {
    const { inbox, fetcher } = fixture();
    fetcher.mockResolvedValueOnce(Response.json({ items: [item], next_cursor: '100' }));
    await inbox.refresh();
    expect(inbox.snapshot()).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
