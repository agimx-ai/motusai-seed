// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SeedI18nProvider } from '../i18n';
import { DockIconControl } from './DockIconControl';

afterEach(cleanup);

describe('Dock icon picker', () => {
  it('offers system, light and dark with accessible labels and no native title tooltip', () => {
    window.motusSeed = {
      snapshot: async () => ({ locale: 'zh-CN', languagePreference: 'system' }),
      subscribe: () => () => {},
    } as any;
    const change = vi.fn();
    render(<SeedI18nProvider><DockIconControl value="system" onValueChange={change} /></SeedI18nProvider>);
    const group = screen.getByRole('radiogroup', { name: 'Dock 图标' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => radio.textContent)).toEqual(['系统', '浅色', '深色']);
    expect(group.querySelector('[title]')).toBeNull();
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    fireEvent.click(radios[2]);
    expect(change).toHaveBeenLastCalledWith('dark');
    fireEvent.keyDown(radios[0], { key: 'ArrowRight' });
    expect(change).toHaveBeenLastCalledWith('light');
    expect(document.activeElement).toBe(radios[1]);
    fireEvent.keyDown(radios[1], { key: 'Home' });
    expect(change).toHaveBeenLastCalledWith('system');
  });

  it('uses previews for the running system’s native icon design', () => {
    window.motusSeed = {
      snapshot: async () => ({ locale: 'zh-CN', languagePreference: 'system' }),
      subscribe: () => () => {},
    } as any;
    const fixture = (generation: 26 | 27) => <SeedI18nProvider><DockIconControl value="light" designGeneration={generation} onValueChange={() => {}} /></SeedI18nProvider>;
    const view = render(fixture(26));
    const image = () => screen.getByRole('radio', { name: '浅色' }).querySelector('img')!;
    expect(image().getAttribute('src')).toContain('/26/light-preview.png');
    view.rerender(fixture(27));
    expect(image().getAttribute('src')).toContain('/27/light-preview.png');
  });
});
