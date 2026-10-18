import { announcementPageSchema, type SeedAnnouncement } from '../shared/announcements';

export function announcementFeedUrl(eventsUrl: string) {
  const url = new URL(eventsUrl);
  if (!url.pathname.endsWith('/events')) throw new Error('Invalid distribution events URL');
  if (url.protocol === 'wss:') url.protocol = 'https:';
  else if (url.protocol === 'ws:') url.protocol = 'http:';
  else if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid distribution events protocol');
  url.pathname = url.pathname.replace(/\/events$/, '/announcements');
  url.search = '';
  return url;
}

/** Existing distribution socket invalidates this inbox; content remains authoritative in Cloud. */
export class AnnouncementInbox {
  private items: SeedAnnouncement[] = [];
  private generation = 0;
  private pending = false;
  private loading: Promise<void> | undefined;
  constructor(
    private readonly options: {
      userId: () => string | undefined;
      eventsUrl: () => Promise<string>;
      readIds: (userId: string) => Promise<string[]>;
      markRead: (userId: string, id: string) => Promise<void>;
      changed: () => void;
      fetch?: typeof fetch;
    },
  ) {}
  snapshot() {
    return this.items;
  }
  clear() {
    this.generation += 1;
    this.items = [];
    this.options.changed();
  }
  refresh(): Promise<void> {
    this.pending = true;
    this.loading ??= this.drain().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }
  private async drain() {
    while (this.pending) {
      this.pending = false;
      const userId = this.options.userId();
      if (!userId) return;
      const generation = this.generation;
      try {
        const url = announcementFeedUrl(await this.options.eventsUrl());
        url.searchParams.set('page_size', '100');
        const collected = new Map<string, SeedAnnouncement>();
        const cursors = new Set<string>();
        do {
          const response = await (this.options.fetch ?? fetch)(url, { signal: AbortSignal.timeout(15_000) });
          if (!response.ok) throw new Error(`Announcement request failed (${response.status})`);
          const page = announcementPageSchema.parse(await response.json());
          for (const item of page.items) collected.set(item.id, item);
          if (!page.next_cursor) break;
          if (cursors.has(page.next_cursor)) throw new Error('Repeated announcement cursor');
          cursors.add(page.next_cursor);
          url.searchParams.set('cursor', page.next_cursor);
        } while (generation === this.generation && userId === this.options.userId());
        // Reading last prevents a concurrent close from resurrecting a notice.
        const read = new Set(await this.options.readIds(userId));
        if (generation !== this.generation || userId !== this.options.userId()) continue;
        this.items = [...collected.values()].filter((item) => !read.has(item.id));
        this.options.changed();
      } catch {
        // Editorial content never blocks startup/authentication; the next socket event retries.
      }
    }
  }
  async dismiss(id: string) {
    const userId = this.options.userId();
    if (!userId || !this.items.some((item) => item.id === id)) return;
    await this.options.markRead(userId, id);
    if (userId !== this.options.userId()) return;
    this.items = this.items.filter((item) => item.id !== id);
    this.options.changed();
  }
  async background(id: string) {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) throw new Error('Announcement no longer available');
    const feed = announcementFeedUrl(await this.options.eventsUrl());
    const url = new URL(item.background_url);
    if (url.origin !== feed.origin || !url.pathname.startsWith(`/api/v1/announcements/${id}/background/`))
      throw new Error('Untrusted announcement background');
    const response = await (this.options.fetch ?? fetch)(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const mime = response.headers.get('content-type')?.split(';')[0];
    if (!response.ok || !mime || !['image/png', 'image/jpeg', 'image/webp'].includes(mime) || !response.body)
      throw new Error('Announcement background unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > 4 * 1024 * 1024) throw new Error('Announcement background too large');
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    return `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`;
  }
}
