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

const eventsUrl = 'wss://cloud.example/api/v1/distributions/motusai/events';
const response = (document = '# Connect Seed\n\nUse the local MCP service.') =>
  new Response(document, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
const englishPrompt = 'Follow https://cloud.example/install/seed.en.md to install Seed.';
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
  it('checks the installation document on the signed Cloud origin and copies only a one-line instruction', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
    expect(await fetchMcpSetupPrompt({ eventsUrl, locale: 'en-US' }, fetcher)).toBe(englishPrompt);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://cloud.example/install/seed.en.md');
    expect(init).toMatchObject({
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'text/markdown', 'Accept-Language': 'en-US' },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(mcpSetupPromptUrl('ws://127.0.0.1:43180/api/v1/distributions/motusai/events', 'zh-CN').href).toBe(
      'http://127.0.0.1:43180/install/seed.md',
    );
    for (const invalid of [
      'https://cloud.example/other',
      'file:///api/events',
      'https://name:secret@cloud.example/events',
    ])
      expect(() => mcpSetupPromptUrl(invalid, 'en-US')).toThrow();
  });
  it('checks the latest document on every copy and leaves a failed copy retryable without a cached fallback', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response('First installation instructions'))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(response('Updated installation instructions'));
    vi.stubGlobal('fetch', fetcher);
    const app = runtime();
    await app.copyMcpSetupPrompt();
    expect(writeText).toHaveBeenLastCalledWith(englishPrompt);
    await expect(app.copyMcpSetupPrompt()).rejects.toThrow();
    expect(writeText).toHaveBeenCalledTimes(1);
    await app.copyMcpSetupPrompt();
    expect(writeText).toHaveBeenLastCalledWith(englishPrompt);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(writeText).toHaveBeenCalledTimes(2);
  });
  it('selects the current language on each request and keeps network failures retryable', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(response('# 连接 Seed\n\n使用本机 MCP 服务。'));
    vi.stubGlobal('fetch', fetcher);
    const app = runtime();
    Reflect.set(app, 'store', { languagePreference: () => 'zh-CN' });
    await expect(app.copyMcpSetupPrompt()).rejects.toThrow('offline');
    expect(writeText).not.toHaveBeenCalled();
    await app.copyMcpSetupPrompt();
    expect(writeText).toHaveBeenCalledWith('根据 https://cloud.example/install/seed.md 安装 Seed。');
    expect(String(fetcher.mock.calls[1][0])).toBe('https://cloud.example/install/seed.md');
  });
  it.each([
    () => response(''),
    () => response('   '),
    () => response('x'.repeat(100_001)),
    () => new Response('<html>Cloud home page</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => Response.json({ error: 'unavailable' }),
  ])('does not touch the clipboard for invalid response %#', async (value) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(value()));
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
