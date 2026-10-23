// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SeedI18nProvider } from '../i18n';
import { AppHeader } from './AppHeader';
import type { PluginHeaderNavigation } from '../features/plugins/plugin-navigation';
import type { SeedInstalledPlugin } from '../../shared/contracts';

afterEach(cleanup);

async function fixture(navigation?: PluginHeaderNavigation, locale = 'zh-CN', platform = 'darwin') {
  window.motusWindow = { platform } as any;
  window.motusSeed = { snapshot: async () => ({ locale, languagePreference: locale }), subscribe: () => () => {} } as any;
  const back = vi.fn();
  const plugin = { id: 'com.example.generic', name: { en_US: 'Assistant', zh_Hans: '个人助理' } } as SeedInstalledPlugin;
  render(<SeedI18nProvider><AppHeader
    sidebarCollapsed={false} view="plugins" selectedPlugin={plugin} pluginNavigation={navigation}
    refreshing={false} onBackToPlugins={back} onRefreshPlugins={vi.fn()} onEditProfile={vi.fn()} onAddCredits={vi.fn()}
  /></SeedI18nProvider>);
  await screen.findByRole('button', { name: locale === 'en-US' ? 'Plugins' : '插件' });
  return { back };
}

describe('product header breadcrumbs', () => {
  it('preserves the existing two-level header for plugins without navigation', async () => {
    const { back } = await fixture();
    expect(screen.getByRole('navigation').querySelectorAll('svg')).toHaveLength(1);
    expect(screen.getByText('个人助理').getAttribute('aria-current')).toBe('page');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '插件' }));
    expect(back).toHaveBeenCalledOnce();
  });

  it.each(['darwin', 'win32', 'linux'])('renders arbitrary ancestors as keyboard buttons on %s', async (platform) => {
    const navigate = vi.fn(async () => true);
    const { back } = await fixture({ pluginId: 'com.example.generic', busy: false, navigate, path: [
      { id: 'rules', label: 'Rules' }, { id: 'rule', label: 'Morning briefing' }, { id: 'execution', label: 'Execution detail' },
    ] }, 'en-US', platform);
    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }));
    expect(navigate).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    expect(navigate).toHaveBeenLastCalledWith('rules');
    fireEvent.click(screen.getByRole('button', { name: 'Morning briefing' }));
    expect(navigate).toHaveBeenLastCalledWith('rule');
    expect(screen.queryByRole('button', { name: 'Execution detail' })).toBeNull();
    expect(screen.getByText('Execution detail').getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('navigation').querySelectorAll('svg')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Plugins' }));
    expect(back).toHaveBeenCalledOnce();
  });

  it('disables plugin navigation while busy and ignores another plugin’s contribution', async () => {
    await fixture({ pluginId: 'com.example.generic', busy: true, navigate: vi.fn(), path: [{ id: 'draft', label: 'Draft' }] });
    expect((screen.getByRole('button', { name: '个人助理' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('navigation').getAttribute('aria-busy')).toBe('true');
    expect((screen.getByRole('button', { name: '插件' }) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    await fixture({ pluginId: 'com.example.other', busy: false, navigate: vi.fn(), path: [{ id: 'stale', label: 'Stale' }] });
    expect(screen.queryByText('Stale')).toBeNull();
    expect(screen.getByText('个人助理').getAttribute('aria-current')).toBe('page');
  });
});
