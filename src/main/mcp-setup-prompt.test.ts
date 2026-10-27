import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { writeText } = vi.hoisted(() => ({ writeText: vi.fn() }));
vi.mock('electron', () => ({
  app: { getVersion: () => '0.3.11', getPreferredSystemLanguages: () => ['en-US'], getLocale: () => 'en-US' },
  clipboard: { writeText },
  BrowserWindow: class {},
  nativeTheme: {},
  powerSaveBlocker: {},
  shell: {},
  ipcMain: {},
  session: {},
}));
vi.mock('./updater', () => ({ SeedUpdater: class {} }));
import { SeedRuntime } from './runtime';
import { fetchMcpSetupPrompt, mcpSetupPromptUrl } from './mcp-setup-prompt';
import { seedLocalMcpUrl } from '../shared/local-api';

const eventsUrl = 'wss://cloud.example/api/v1/distributions/motusai/events';
const response = (template = 'Connect {{url}}', locale = 'en-US', revision = 1) =>
  Response.json({ revision, locale, template });
function runtime() {
  return Object.assign(Object.create(SeedRuntime.prototype), {
    user: { id: 'user-1' },
    authStatus: { status: 'signed_in' },
    stopping: false,
    store: { languagePreference: () => 'en-US' },
    currentDistribution: vi.fn(async () => ({ events_url: eventsUrl })),
  }) as SeedRuntime;
}
beforeEach(() => writeText.mockClear());
afterEach(() => vi.unstubAllGlobals());
describe('Cloud-backed MCP setup copying', () => {
  it('uses the signed distribution endpoint, sending the locale and rejecting redirects', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response('Use {{url}} then check {{url}}'));
    expect(await fetchMcpSetupPrompt({ eventsUrl, locale: 'en-US' }, fetcher)).toBe(
      `Use ${seedLocalMcpUrl} then check ${seedLocalMcpUrl}`,
    );
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://cloud.example/api/v1/distributions/motusai/mcp-prompt?locale=en-US');
    expect(init).toMatchObject({
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json', 'Accept-Language': 'en-US' },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(mcpSetupPromptUrl('ws://127.0.0.1:43180/api/v1/distributions/motusai/events').protocol).toBe('http:');
    for (const invalid of [
      'https://cloud.example/other',
      'file:///api/events',
      'https://name:secret@cloud.example/events',
    ])
      expect(() => mcpSetupPromptUrl(invalid)).toThrow();
  });
  it('fetches every time and copies newly saved revisions without a local template or cached fallback', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response('First {{url}}'))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(response('New {{url}}', 'en-US', 2));
    vi.stubGlobal('fetch', fetcher);
    const app = runtime();
    await app.copyMcpSetupPrompt();
    expect(writeText).toHaveBeenLastCalledWith(`First ${seedLocalMcpUrl}`);
    await expect(app.copyMcpSetupPrompt()).rejects.toThrow();
    expect(writeText).toHaveBeenCalledTimes(1);
    await app.copyMcpSetupPrompt();
    expect(writeText).toHaveBeenLastCalledWith(`New ${seedLocalMcpUrl}`);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(writeText).toHaveBeenCalledTimes(2);
  });
  it('selects the current language on each request and keeps network failures retryable', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(response('连接 {{url}}', 'zh-CN'));
    vi.stubGlobal('fetch', fetcher);
    const app = runtime();
    Reflect.set(app, 'store', { languagePreference: () => 'zh-CN' });
    await expect(app.copyMcpSetupPrompt()).rejects.toThrow('offline');
    expect(writeText).not.toHaveBeenCalled();
    await app.copyMcpSetupPrompt();
    expect(writeText).toHaveBeenCalledWith(`连接 ${seedLocalMcpUrl}`);
    expect(String(fetcher.mock.calls[1][0])).toContain('locale=zh-CN');
  });
  it.each([
    { revision: 1, locale: 'en-US', template: '' },
    { revision: 1, locale: 'en-US', template: 'Missing URL' },
    { revision: 1, locale: 'en-US', template: '{{url}} {{token}}' },
    { revision: 1, locale: 'en-US', template: '{{url}}' + 'x'.repeat(20_000) },
    { revision: 0, locale: 'en-US', template: '{{url}}' },
    { revision: 1, locale: 'zh-CN', template: '{{url}}' },
  ])('does not touch the clipboard for invalid response %#', async (value) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(value)));
    await expect(runtime().copyMcpSetupPrompt()).rejects.toThrow();
    expect(writeText).not.toHaveBeenCalled();
  });
  it('does not fetch while signed out or copy a response after logout/account replacement', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const app = runtime();
    Reflect.set(app, 'user', undefined);
    await expect(app.copyMcpSetupPrompt()).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    Reflect.set(app, 'user', { id: 'user-1' });
    let finish!: (value: Response) => void;
    fetcher.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = app.copyMcpSetupPrompt();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    Reflect.set(app, 'user', { id: 'user-2' });
    finish(response());
    await expect(pending).rejects.toThrow('account changed');
    expect(writeText).not.toHaveBeenCalled();
  });
});
