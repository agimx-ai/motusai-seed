import { mcpClientsResponseSchema, type McpClientEntry } from '../shared/mcp-clients';

export async function fetchMcpClients(eventsUrl: string, request: typeof fetch = fetch): Promise<(McpClientEntry | string)[]> {
  const url = new URL(eventsUrl);
  if (!url.pathname.endsWith('/events') || url.username || url.password) throw new Error('Invalid distribution URL');
  if (url.protocol === 'wss:') url.protocol = 'https:';
  else if (url.protocol === 'ws:') url.protocol = 'http:';
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid distribution protocol');
  url.pathname = url.pathname.replace(/\/events$/, '/mcp-clients');
  url.search = '';
  url.hash = '';
  const response = await request(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Client icons unavailable');
  const { entries, clients } = mcpClientsResponseSchema.parse(await response.json());
  return entries?.map((entry) => {
    if (!/^svg-[0-9a-f]{60}$/.test(entry.icon_id)) return entry;
    const iconUrl = new URL(url);
    iconUrl.pathname += `/icons/${entry.icon_id}`;
    return { ...entry, uploadedIconUrl: iconUrl.href };
  }) ?? clients;
}
