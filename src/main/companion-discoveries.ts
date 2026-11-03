import { companionDiscoveryFeedSchema, type CompanionDiscovery } from '../shared/companion-discoveries';

export class CompanionDiscoveryFeed {
  private items: CompanionDiscovery[] = [];
  private loading: Promise<void> | undefined;
  private pending = false;
  constructor(private readonly options: {
    eventsUrl: () => Promise<string>;
    readCache: () => Promise<string | undefined>;
    writeCache: (value: string) => Promise<void>;
    changed: () => void;
    fetch?: typeof fetch;
  }) {}
  snapshot() { return this.items; }
  async loadCache() {
    try {
      const value = await this.options.readCache();
      if (value) this.items = companionDiscoveryFeedSchema.parse(JSON.parse(value)).items;
    } catch { /* Ignore a damaged cache and fetch again. */ }
  }
  refresh(): Promise<void> {
    this.pending = true;
    this.loading ??= this.drain().finally(() => { this.loading = undefined; });
    return this.loading;
  }
  private async drain() {
    while (this.pending) {
      this.pending = false;
      try {
        const url = new URL(await this.options.eventsUrl());
        if (!url.pathname.endsWith('/events') || url.username || url.password) throw new Error('Invalid distribution events URL');
        if (url.protocol === 'wss:') url.protocol = 'https:';
        else if (url.protocol === 'ws:') url.protocol = 'http:';
        else if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid distribution protocol');
        url.pathname = url.pathname.replace(/\/events$/, '/discoveries'); url.search = ''; url.hash = '';
        const response = await (this.options.fetch ?? fetch)(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error('Companion introductions unavailable');
        const feed = companionDiscoveryFeedSchema.parse(await response.json());
        await this.options.writeCache(JSON.stringify(feed));
        this.items = feed.items;
        this.options.changed();
      } catch { /* Retain the last successfully validated content. */ }
    }
  }
}
