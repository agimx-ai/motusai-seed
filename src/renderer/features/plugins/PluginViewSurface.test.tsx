// @vitest-environment jsdom
import i18next from 'i18next';
import { act, cleanup, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedI18nResources } from '../../i18n/resources';
import { PluginViewSurface } from './PluginViewSurface';

const { mount } = vi.hoisted(() => ({ mount: vi.fn() }));
vi.mock('./plugin-dom-host', () => ({ mountPluginDom: mount }));

beforeEach(() => {
  mount.mockImplementation((_id, container, _error, loading) => {
    loading(true);
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Plugin draft');
    container.append(input);
    return vi.fn(() => input.remove());
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function fixture(locale: 'zh-CN' | 'en-US' = 'zh-CN') {
  const i18n = i18next.createInstance();
  void i18n.init({ lng: locale, defaultNS: 'app', resources: seedI18nResources, initAsync: false });
  const view = (revision: string) => (
    <I18nextProvider i18n={i18n}>
      <PluginViewSurface pluginId="com.example.generic" revision={revision} />
    </I18nextProvider>
  );
  return { ...render(view('one')), view };
}

describe('Plugin detail loading feedback', () => {
  it.each([
    ['zh-CN', '正在加载插件…'],
    ['en-US', 'Loading plugin…'],
  ] as const)('shows a compact accessible loading indicator in %s until content is ready', (locale, label) => {
    const { container } = fixture(locale);
    const surface = container.querySelector('[data-plugin-view-surface]')!;
    expect(screen.getByRole('status').textContent).toBe(label);
    expect(surface.getAttribute('aria-busy')).toBe('true');
    const icon = screen.getByRole('status').querySelector('svg')!;
    expect(icon.getAttribute('width')).toBe('16');
    expect(icon.classList.contains('motion-safe:animate-spin')).toBe(true);
    act(() => mount.mock.calls[0][3](false));
    expect(screen.queryByRole('status')).toBeNull();
    expect(surface.getAttribute('aria-busy')).toBe('false');
    expect(screen.getByRole('textbox', { name: 'Plugin draft' })).toBeTruthy();
  });

  it('shows loading during an automatic remount without replacing plugin-owned DOM during state updates', () => {
    fixture();
    const loading = mount.mock.calls[0][3];
    act(() => loading(false));
    const draft = screen.getByRole('textbox', { name: 'Plugin draft' }) as HTMLInputElement;
    draft.value = 'Unsaved plugin content';
    act(() => loading(true));
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => loading(false));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Plugin draft' })).toBe(draft);
    expect(draft.value).toBe('Unsaved plugin content');
  });

  it('replaces loading with a real error and clears the old error when loading starts again', () => {
    fixture();
    const [, , error, loading] = mount.mock.calls[0];
    act(() => {
      loading(false);
      error(new Error('Plugin failed to load'));
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('Plugin failed to load');
    act(() => loading(true));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('releases the previous mount and restores loading when the plugin revision changes', () => {
    const { rerender, view, unmount } = fixture();
    act(() => mount.mock.calls[0][3](false));
    const firstRelease = mount.mock.results[0].value;
    rerender(view('two'));
    expect(firstRelease).toHaveBeenCalledOnce();
    expect(mount).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toBeTruthy();
    const secondRelease = mount.mock.results[1].value;
    unmount();
    expect(secondRelease).toHaveBeenCalledOnce();
  });
});
