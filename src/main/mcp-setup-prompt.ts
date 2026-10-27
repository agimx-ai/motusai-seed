import type { SeedLocale } from '../shared/contracts';

/** Resolve the endpoint from signed Cloud discovery, never from renderer input. */
export function mcpSetupPromptUrl(eventsUrl: string, locale: SeedLocale) {
  const url = new URL(eventsUrl);
  if (!url.pathname.endsWith('/events')) throw new Error('Invalid distribution events URL');
  if (url.protocol === 'wss:') url.protocol = 'https:';
  else if (url.protocol === 'ws:') url.protocol = 'http:';
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Invalid distribution events URL');
  url.pathname = locale === 'zh-CN' ? '/install/seed.md' : '/install/seed.en.md';
  url.search = '';
  url.hash = '';
  return url;
}

export async function fetchMcpSetupPrompt(
  input: {
    eventsUrl: string;
    locale: SeedLocale;
  },
  request: typeof fetch = fetch,
): Promise<string> {
  const url = mcpSetupPromptUrl(input.eventsUrl, input.locale);
  const response = await request(url, {
    headers: { Accept: 'text/markdown', 'Accept-Language': input.locale },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`MCP setup instructions unavailable (${response.status})`);
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/markdown'))
    throw new Error('Invalid MCP installation document');
  const document = await response.text();
  if (!document.trim() || document.length > 100_000) throw new Error('Invalid MCP installation document');
  return input.locale === 'zh-CN' ? `根据 ${url.href} 安装 Seed。` : `Follow ${url.href} to install Seed.`;
}
