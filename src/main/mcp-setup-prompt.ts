import { z } from 'zod';
import type { SeedLocale } from '../shared/contracts';
import { seedLocalMcpUrl } from '../shared/local-api';

const responseSchema = z
  .object({
    revision: z.number().int().positive(),
    locale: z.enum(['zh-CN', 'en-US']),
    template: z
      .string()
      .trim()
      .min(1)
      .max(20_000)
      .refine(
        (value) =>
          value.includes('{{url}}') &&
          [...value.matchAll(/{{\s*[\w.-]+\s*}}/g)].every(([match]) => match === '{{url}}'),
      ),
  })
  .strict();

/** Resolve the endpoint from signed Cloud discovery, never from renderer input. */
export function mcpSetupPromptUrl(eventsUrl: string) {
  const url = new URL(eventsUrl);
  if (!url.pathname.endsWith('/events')) throw new Error('Invalid distribution events URL');
  if (url.protocol === 'wss:') url.protocol = 'https:';
  else if (url.protocol === 'ws:') url.protocol = 'http:';
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Invalid distribution events URL');
  url.pathname = url.pathname.replace(/\/events$/, '/mcp-prompt');
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
  const url = mcpSetupPromptUrl(input.eventsUrl);
  url.searchParams.set('locale', input.locale);
  const response = await request(url, {
    headers: { Accept: 'application/json', 'Accept-Language': input.locale },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`MCP setup instructions unavailable (${response.status})`);
  const content = responseSchema.parse(await response.json());
  if (content.locale !== input.locale) throw new Error('MCP setup instruction language mismatch');
  return content.template.replaceAll('{{url}}', seedLocalMcpUrl);
}
