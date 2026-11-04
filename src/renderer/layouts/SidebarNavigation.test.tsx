// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedI18nResources } from '../i18n/resources';
import { pluginSidebar } from '../features/plugins/plugin-sidebar';
import { SidebarNavigation } from './SidebarNavigation';

const dispose: Array<() => void> = [];
afterEach(() => {
  cleanup();
  dispose.splice(0).forEach((release) => release());
});
function fixture() {
  const owner = pluginSidebar.attach('com.example.docs');
  dispose.push(owner.dispose);
  const other = pluginSidebar.attach('com.example.status');
  dispose.push(other.dispose);
  owner.api.register({ id: 'group', title: 'Documents', icon: 'folder', parent: { host: 'overview' } });
  const action = vi.fn();
  owner.api.register({ id: 'new', title: 'New document', parent: { host: 'overview' }, onSelect: action });
  const handle = owner.api.register({
    id: 'inbox',
    title: 'Inbox',
    parent: { item: 'group' },
    view: 'inbox',
    badge: 2,
  });
  other.api.register({ id: 'monitor', title: 'Monitor', view: 'dashboard' });
  const i18n = i18next.createInstance();
  void i18n.init({ lng: 'en-US', defaultNS: 'app', resources: seedI18nResources, initAsync: false });
  const open = vi.fn();
  dispose.push(pluginSidebar.onOpen(open));
  const navigate = vi.fn();
  const result = render(
    <I18nextProvider i18n={i18n}>
      <SidebarNavigation view="plugin-view" selectedKey="com.example.docs:inbox" onNavigate={navigate} onOpenPlugin={open} />
    </I18nextProvider>,
  );
  return { ...result, handle, open, navigate, action };
}
describe('host-rendered plugin navigation', () => {
  it('executes an action without navigating away from the current page', () => {
    const { action, open, navigate } = fixture();
    fireEvent.click(screen.getByRole('button', { name: 'New document' }));
    expect(action).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Inbox, 2' }).getAttribute('aria-current')).toBe('page');
  });
  it('renders the configured navigation icon', () => {
    const { handle } = fixture();
    act(() => handle.update({ icon: 'messages-square' }));
    const button = screen.getByRole('button', { name: 'Inbox, 2' });
    expect(button.querySelector('svg.lucide-messages-square')).not.toBeNull();
    expect(button.querySelectorAll('img')).toHaveLength(0);
  });
  it('renders separate extension positions and routes through owner-scoped metadata', () => {
    const { open, navigate } = fixture();
    expect(screen.getByRole('button', { name: 'Inbox, 2' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Monitor' }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ pluginId: 'com.example.status', view: 'dashboard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Activity log' }));
    expect(navigate).toHaveBeenCalledWith('activity');
    expect(screen.getByRole('navigation').querySelectorAll('iframe')).toHaveLength(0);
  });
  it('keeps expand controls separate from page actions and updates badges without remounting', () => {
    const { handle, open } = fixture();
    fireEvent.click(screen.getByRole('button', { name: 'Documents' }));
    expect(screen.queryByRole('button', { name: 'Inbox, 2' })).toBeNull();
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Documents' }));
    const button = screen.getByRole('button', { name: 'Inbox, 2' });
    act(() => handle.update({ badge: 4 }));
    expect(screen.getByRole('button', { name: 'Inbox, 4' })).toBe(button);
    act(() => handle.dispose());
    expect(screen.queryByRole('button', { name: 'Inbox, 4' })).toBeNull();
  });
});
