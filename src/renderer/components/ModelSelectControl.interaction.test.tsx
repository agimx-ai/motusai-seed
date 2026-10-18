// @vitest-environment jsdom
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeedI18nProvider } from '../i18n';
import { ModelSelectControl } from '@motus-ai/seed-sdk/react';
import { SelectControl } from '@motus-ai/seed-sdk/react';

const options = [
  { value: 'one', label: 'Model one', group: 'seed' as const, thinkingLevels: ['off', 'low', 'high'] },
  { value: 'two', label: 'Model two', group: 'custom' as const, thinkingLevels: ['off', 'low'] },
];
let style: HTMLStyleElement;

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('motusSeed', {
    snapshot: async () => ({ locale: 'en-US', languagePreference: 'en-US' }),
    subscribe: () => () => undefined,
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 20,
    y: 80,
    left: 20,
    top: 80,
    right: 140,
    bottom: 116,
    width: 120,
    height: 36,
    toJSON() {},
  });
  style = document.createElement('style');
  style.textContent =
    'button { column-gap: 12px; padding: 0px 8px; border: 1px solid; }' +
    readFileSync('packages/seed-sdk/src/react/components/ThemedIcon.css', 'utf8');
  document.head.append(style);
});
afterEach(() => {
  cleanup();
  style.remove();
  document.documentElement.removeAttribute('data-theme');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const iconDataUrl = 'data:image/svg+xml;base64,PHN2Zy8+';
const iconDarkDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
function expectIconTheme(container: Element, theme: 'light' | 'dark') {
  const images = Array.from(container.querySelectorAll('.seed-themed-icon img'));
  expect(
    images.filter((image) => getComputedStyle(image).display !== 'none').map((image) => image.getAttribute('src')),
  ).toEqual([theme === 'dark' ? iconDarkDataUrl : iconDataUrl]);
}

function Picker({
  onChange,
  size = 'default',
  initial = 'one',
  levels = options,
  disabled = false,
  loading = false,
}: {
  onChange: (model: string, thinking: string) => void;
  size?: 'default' | 'form';
  initial?: string;
  levels?: typeof options;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [model, setModel] = useState(initial);
  const [thinking, setThinking] = useState('high');
  return (
    <>
      <button type="button">Outside</button>
      <ModelSelectControl
        label="Model picker"
        value={model}
        options={levels}
        thinkingValue={thinking}
        size={size}
        disabled={disabled}
        loading={loading}
        onChange={(next, effort) => {
          setModel(next);
          setThinking(effort);
          onChange(next, effort);
        }}
      />
    </>
  );
}
function mountPicker(props: Partial<Parameters<typeof Picker>[0]> = {}) {
  const onChange = vi.fn();
  const result = render(
    <SeedI18nProvider>
      <Picker onChange={onChange} {...props} />
    </SeedI18nProvider>,
  );
  return {
    ...result,
    onChange,
    user: userEvent.setup(),
    trigger: screen.getByRole('button', { name: 'Model picker' }),
  };
}

describe('shared model picker DOM interactions', () => {
  it('focuses a portalled option only after placement makes it visible', async () => {
    const originalFocus = HTMLElement.prototype.focus;
    const focus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options) {
      const popup = this.closest('[role="dialog"]') as HTMLElement | null;
      if (popup) expect(popup.style.visibility).toBe('visible');
      originalFocus.call(this, options);
    });
    const h = mountPicker();
    await h.user.click(h.trigger);
    const selected = screen.getByRole('option', { name: 'Model one' });
    await waitFor(() => expect(document.activeElement).toBe(selected));
    await h.user.keyboard('{Escape}');
    expect(h.trigger.getAttribute('aria-expanded')).toBe('false');
    expect(focus).toHaveBeenCalled();
  });

  it.each(['default', 'form'] as const)(
    'keeps the %s picker arrow anchored to the animated right edge',
    async (size) => {
      const h = mountPicker({ size });
      const arrow = h.trigger.querySelector('.lucide-chevron-down')!;
      expect(h.trigger.querySelector('.seed-model-trigger-value')?.textContent).toMatch(/^Model one · (High|高)$/);
      expect(arrow.classList.contains('ml-auto')).toBe(true);

      await h.user.click(h.trigger);
      expect(h.trigger.getAttribute('aria-expanded')).toBe('true');
      expect(arrow.classList.contains('ml-auto')).toBe(true);

      await h.user.click(h.trigger);
      expect(h.trigger.getAttribute('aria-expanded')).toBe('false');
      expect(arrow.classList.contains('ml-auto')).toBe(true);
    },
  );

  it.each(['default', 'form'] as const)(
    'switches the %s trigger and portal icons together while preserving width, focus and selection',
    async (size) => {
      const h = mountPicker({ size, levels: options.map((option) => ({ ...option, iconDataUrl, iconDarkDataUrl })) });
      document.documentElement.dataset.theme = 'light';
      expectIconTheme(h.trigger, 'light');
      await h.user.click(h.trigger);
      const width = h.trigger.parentElement!.style.width;
      const focus = document.activeElement;
      for (const theme of ['dark', 'light'] as const) {
        document.documentElement.dataset.theme = theme;
        expectIconTheme(h.trigger, theme);
        for (const option of screen.getAllByRole('option')) expectIconTheme(option, theme);
        expect(document.activeElement).toBe(focus);
        expect(h.trigger.parentElement!.style.width).toBe(width);
        expect(h.trigger.getAttribute('aria-expanded')).toBe('true');
        expect(h.onChange).not.toHaveBeenCalled();
      }
    },
  );
  it.each(['default', 'form'] as const)(
    'starts the %s popup with the model groups and keeps the thinking footer outside the scroll viewport',
    async (size) => {
      const h = mountPicker({ size });
      const height = h.trigger.style.height;
      await h.user.click(h.trigger);
      const menu = screen.getByRole('dialog', { name: 'Model picker' });
      const viewport = screen.getByRole('listbox', { name: 'Model picker' }).parentElement!;
      const footer = screen.getByRole('group', { name: 'Thinking level' });
      expect(menu.classList.contains('py-3')).toBe(true);
      expect(menu.classList.contains('scroll-py-3')).toBe(false);
      expect(menu.classList.contains('overflow-hidden')).toBe(true);
      expect(menu.classList.contains('overflow-y-auto')).toBe(false);
      expect(viewport.classList.contains('overflow-y-auto')).toBe(true);
      expect(viewport.classList.contains('min-h-0')).toBe(true);
      expect(viewport.classList.contains('py-3')).toBe(false);
      expect(menu.querySelectorAll('.py-3, .scroll-py-3')).toHaveLength(0);
      expect(viewport.contains(screen.getByRole('option', { name: 'Model one' }))).toBe(true);
      expect(viewport.contains(footer)).toBe(false);
      expect(footer.contains(screen.getByRole('slider'))).toBe(true);
      expect(Array.from(menu.children)).toEqual([viewport, footer]);
      expect(menu.firstElementChild).toBe(viewport);
      expect(screen.queryByText('Model and thinking level')).toBeNull();
      expect(footer.classList.contains('shrink-0')).toBe(true);
      expect(footer.classList.contains('mt-1')).toBe(true);
      expect(footer.classList.contains('pt-2')).toBe(true);
      expect(footer.classList.contains('pb-2')).toBe(false);
      expect(footer.classList.contains('pt-2.5')).toBe(false);
      expect(footer.children).toHaveLength(1);
      expect(footer.firstElementChild?.classList.contains('seed-discrete-slider')).toBe(true);
      expect(screen.queryByText('Thinking level', { exact: true })).toBeNull();
      expect(screen.getByRole('slider', { name: 'Thinking level' }).getAttribute('aria-valuetext')).toBe('High');
      expect(footer.querySelector('.seed-discrete-slider-summary')?.textContent).toBe('HighHigh');
      expect(menu.querySelectorAll('.overflow-y-auto')).toHaveLength(1);
      expect(footer.classList.contains('absolute')).toBe(false);
      expect(footer.classList.contains('sticky')).toBe(false);
      expect(menu.classList.contains('px-2')).toBe(false);
      expect(menu.classList.contains('pl-2')).toBe(true);
      expect(menu.classList.contains('pr-1')).toBe(true);
      expect(viewport.classList.contains('pr-1')).toBe(true);
      expect(menu.classList.contains('min-w-[260px]')).toBe(true);
      const modelList = screen.getByRole('listbox', { name: 'Model picker' });
      expect(modelList.classList.contains('grid')).toBe(true);
      expect(modelList.classList.contains('gap-px')).toBe(true);
      const firstHeading = screen.getByRole('group', { name: 'Seed built-in models' }).firstElementChild!;
      expect(firstHeading.classList.contains('pt-0')).toBe(true);
      expect(firstHeading.classList.contains('pt-2')).toBe(false);
      for (const row of screen.getAllByRole('option')) {
        expect(row.classList.contains('min-h-8')).toBe(true);
        expect(row.classList.contains('scroll-mt-8')).toBe(true);
        expect(row.classList.contains('min-h-9')).toBe(false);
      }
      expect(h.trigger.style.height).toBe(height);
    },
  );
  it.each(['default', 'form'] as const)(
    'bounds each %s sticky heading to its own group from the top of the popup',
    async (size) => {
      const h = mountPicker({ size });
      await h.user.click(h.trigger);
      const list = screen.getByRole('listbox', { name: 'Model picker' });
      const viewport = list.parentElement!;
      const footer = screen.getByRole('group', { name: 'Thinking level' });
      const groups = [
        screen.getByRole('group', { name: 'Seed built-in models' }),
        screen.getByRole('group', { name: 'Custom models' }),
      ];
      expect(Array.from(list.children)).toEqual(groups);
      for (const [index, group] of groups.entries()) {
        const heading = group.firstElementChild as HTMLElement;
        expect(heading.textContent).toBe(index === 0 ? 'Seed built-in models' : 'Custom models');
        for (const className of ['sticky', 'top-0', 'z-10', 'bg-card', 'leading-4'])
          expect(heading.classList.contains(className)).toBe(true);
        expect(heading.classList.contains(index === 0 ? 'pt-0' : 'pt-2')).toBe(true);
        expect(heading.classList.contains(index === 0 ? 'pt-2' : 'pt-0')).toBe(false);
        expect(group.classList.contains('overflow-hidden')).toBe(false);
        expect(group.classList.contains('gap-px')).toBe(true);
        expect(group.contains(screen.getByRole('option', { name: index === 0 ? 'Model one' : 'Model two' }))).toBe(
          true,
        );
        expect(group.querySelectorAll('[role="option"]')).toHaveLength(1);
      }
      expect(viewport.classList.contains('overflow-y-auto')).toBe(true);
      expect(viewport.contains(footer)).toBe(false);
      expect(list.querySelectorAll('.sticky')).toHaveLength(2);
      const thumb = footer.querySelector('.seed-discrete-slider-thumb');
      fireEvent.scroll(viewport, { target: { scrollTop: 300 } });
      expect(footer.querySelector('.seed-discrete-slider-thumb')).toBe(thumb);
      expect(h.onChange).not.toHaveBeenCalled();
    },
  );
  it.each(['seed', 'custom'] as const)(
    'does not leave an empty sticky heading when only the %s group exists',
    async (group) => {
      const h = mountPicker({ levels: options.map((option) => ({ ...option, group })) });
      await h.user.click(h.trigger);
      const list = screen.getByRole('listbox', { name: 'Model picker' });
      expect(list.children).toHaveLength(1);
      expect(list.querySelectorAll('.sticky')).toHaveLength(1);
      expect(list.firstElementChild?.getAttribute('aria-label')).toBe(
        group === 'seed' ? 'Seed built-in models' : 'Custom models',
      );
      expect(list.firstElementChild?.firstElementChild?.classList.contains('pt-0')).toBe(true);
      expect(list.firstElementChild?.firstElementChild?.classList.contains('pt-2')).toBe(false);
      expect(list.querySelectorAll('[role="option"]')).toHaveLength(2);
      expect(screen.queryByText(group === 'seed' ? 'Custom models' : 'Seed built-in models')).toBeNull();
    },
  );
  it('preserves cross-group keyboard navigation and Tab to the fixed slider after scrolling', async () => {
    const h = mountPicker();
    await h.user.click(h.trigger);
    const list = screen.getByRole('listbox', { name: 'Model picker' });
    fireEvent.scroll(list.parentElement!, { target: { scrollTop: 300 } });
    await h.user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Model two' }));
    await h.user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Model one' }));
    await h.user.keyboard('{ArrowDown}{Enter}');
    expect(h.onChange).toHaveBeenCalledExactlyOnceWith('two', '');
    await h.user.tab();
    expect(document.activeElement).toBe(screen.getByRole('slider', { name: 'Thinking level' }));
    expect(h.trigger.getAttribute('aria-expanded')).toBe('true');
  });
  it('positions an overflowing menu using its inner content height plus the outer frame', async () => {
    vi.stubGlobal('innerHeight', 600);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 20,
      y: 450,
      left: 20,
      top: 450,
      right: 140,
      bottom: 486,
      width: 120,
      height: 36,
      toJSON() {},
    });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('overflow-y-auto') ? 700 : 180;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('overflow-y-auto') ? 300 : 120;
    });
    style.textContent += '[role="dialog"] { padding: 12px 8px; border: 1px solid; }';
    const h = mountPicker();
    await h.user.click(h.trigger);
    const menu = screen.getByRole('dialog', { name: 'Model picker' });
    const viewport = screen.getByRole('listbox', { name: 'Model picker' }).parentElement!;
    expect(menu.style.top).toBe('56px');
    expect(menu.style.maxHeight).toBe('389px');
    fireEvent.scroll(viewport, { target: { scrollTop: 300 } });
    expect(menu.style.top).toBe('56px');
    expect(menu.classList.contains('py-3')).toBe(true);
    expect(viewport.classList.contains('py-3')).toBe(false);
    vi.stubGlobal('innerHeight', 1000);
    fireEvent.resize(window);
    expect(menu.style.top).toBe('491px');
    expect(menu.style.maxHeight).toBe('501px');
    expect(menu.classList.contains('overflow-y-auto')).toBe(false);
  });
  it('excludes the removed title while including the fixed thinking footer and margins in placement', async () => {
    vi.stubGlobal('innerHeight', 600);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 20,
      y: 350,
      left: 20,
      top: 350,
      right: 140,
      bottom: 386,
      width: 120,
      height: 36,
      toJSON() {},
    });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(110);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') === 'group') return this.querySelector('input') ? 57 : 25;
      return this.classList.contains('shrink-0') ? 20 : 0;
    });
    style.textContent +=
      '[role="dialog"] { padding: 12px 8px; border: 1px solid; } [role="dialog"] > [role="group"] { margin-top: 4px; }';
    const h = mountPicker();
    await h.user.click(h.trigger);
    const menu = screen.getByRole('dialog', { name: 'Model picker' });
    // 110px list + 57px footer + 4px margin + 26px frame; without the duplicate title it fits below.
    expect(menu.style.top).toBe('391px');
    expect(menu.style.maxHeight).toBe('201px');
    h.rerender(
      <SeedI18nProvider>
        <Picker onChange={h.onChange} levels={[{ ...options[0]!, thinkingLevels: [] }]} />
      </SeedI18nProvider>,
    );
    // The shorter empty footer makes the full menu fit below without clipping it.
    expect(menu.style.top).toBe('391px');
    expect(menu.style.maxHeight).toBe('201px');
    expect(h.onChange).not.toHaveBeenCalled();
  });
  it('keeps the footer slider mounted and keyboard-accessible while a long model list scrolls', async () => {
    const levels = Array.from({ length: 40 }, (_, index) => ({
      ...options[0]!,
      value: String(index),
      label: `Model ${index}`,
    }));
    const h = mountPicker({ initial: '0', levels });
    await h.user.click(h.trigger);
    const menu = screen.getByRole('dialog', { name: 'Model picker' });
    const viewport = screen.getByRole('listbox', { name: 'Model picker' }).parentElement!;
    const footer = screen.getByRole('group', { name: 'Thinking level' });
    const slider = screen.getByRole('slider');
    const thumb = footer.querySelector('.seed-discrete-slider-thumb');
    fireEvent.scroll(viewport, { target: { scrollTop: 900 } });
    expect(menu.firstElementChild).toBe(viewport);
    expect(menu.lastElementChild).toBe(footer);
    expect(footer.querySelector('.seed-discrete-slider-thumb')).toBe(thumb);
    await h.user.keyboard('{End}{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Model 39' }));
    expect(h.onChange).toHaveBeenCalledExactlyOnceWith('39', 'high');
    await h.user.tab();
    expect(document.activeElement).toBe(slider);
    expect(slider.getAttribute('aria-valuetext')).toBe('High');
    h.onChange.mockClear();
    fireEvent.change(slider, { target: { value: '1' } });
    expect(h.onChange).toHaveBeenCalledExactlyOnceWith('39', 'low');
    expect(h.trigger.getAttribute('aria-expanded')).toBe('true');
    expect(footer.querySelector('.seed-discrete-slider-thumb')).toBe(thumb);
    await h.user.keyboard('{Escape}');
    expect(h.trigger.getAttribute('aria-expanded')).toBe('false');
  });
  it('keeps an explanatory footer for models without adjustable thinking, without inventing a value', async () => {
    const h = mountPicker({ levels: [options[0]!, { ...options[1]!, thinkingLevels: [] }] });
    await h.user.click(h.trigger);
    await h.user.click(screen.getByRole('option', { name: 'Model two' }));
    const footer = screen.getByRole('group', { name: 'Thinking level' });
    expect(footer.textContent).toContain('This model does not support adjustable thinking levels.');
    expect(screen.queryByRole('slider')).toBeNull();
    expect(h.onChange).toHaveBeenCalledExactlyOnceWith('two', '');
    expect(h.trigger.getAttribute('aria-expanded')).toBe('true');
    h.onChange.mockClear();
    await h.user.click(screen.getByRole('option', { name: 'Model one' }));
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('No thinking level selected');
    expect(h.onChange).toHaveBeenCalledExactlyOnceWith('one', '');
  });
  it('prompts for a model in the fixed footer when none is selected', async () => {
    const h = mountPicker({ initial: '' });
    await h.user.click(h.trigger);
    expect(screen.getByRole('group', { name: 'Thinking level' }).textContent).toContain(
      'Select a model to set its thinking level.',
    );
    expect(screen.queryByRole('slider')).toBeNull();
    expect(h.onChange).not.toHaveBeenCalled();
  });
  it('keeps model-only menus generic without adding a thinking footer', async () => {
    render(
      <SeedI18nProvider>
        <ModelSelectControl label="Model only" value="one" options={options} onChange={vi.fn()} />
      </SeedI18nProvider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Model only' }));
    const menu = screen.getByRole('dialog', { name: 'Model only' });
    expect(menu.firstElementChild).toBe(screen.getByRole('listbox', { name: 'Model only' }).parentElement);
    expect(menu.children).toHaveLength(1);
    expect(screen.queryByText('Select model')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Thinking level' })).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });
  it.each(['default', 'form'] as const)(
    'keeps loading inside the %s trigger and restores the arrow when ready',
    async (size) => {
      const h = mountPicker({ size, loading: true });
      const width = h.trigger.parentElement!.style.width;
      expect(h.trigger.getAttribute('aria-busy')).toBe('true');
      expect((h.trigger as HTMLButtonElement).disabled).toBe(true);
      expect(h.trigger.querySelector('.lucide-loader-circle')).not.toBeNull();
      expect(h.trigger.querySelector('.lucide-chevron-down')).toBeNull();
      await h.user.click(h.trigger);
      expect(h.trigger.getAttribute('aria-expanded')).toBe('false');
      h.rerender(
        <SeedI18nProvider>
          <Picker onChange={h.onChange} size={size} loading={false} />
        </SeedI18nProvider>,
      );
      expect(h.trigger.querySelector('.lucide-loader-circle')).toBeNull();
      expect(h.trigger.querySelector('.lucide-chevron-down')).not.toBeNull();
      expect(h.trigger.getAttribute('aria-busy')).toBeNull();
      expect(h.trigger.parentElement!.style.width).toBe(width);
      expect(h.onChange).not.toHaveBeenCalled();
      await h.user.click(h.trigger);
      expect(h.trigger.getAttribute('aria-expanded')).toBe('true');
    },
  );
  it('dismisses an open menu when loading restarts without submitting a stale choice', async () => {
    const h = mountPicker();
    await h.user.click(h.trigger);
    expect(h.trigger.getAttribute('aria-expanded')).toBe('true');
    h.rerender(
      <SeedI18nProvider>
        <Picker onChange={h.onChange} loading />
      </SeedI18nProvider>,
    );
    expect(h.trigger.getAttribute('aria-expanded')).toBe('false');
    expect(h.trigger.getAttribute('aria-busy')).toBe('true');
    expect(h.onChange).not.toHaveBeenCalled();
  });
  it.each(['default', 'form'] as const)(
    'keeps the %s picker open after selection so thinking can be adjusted',
    async (size) => {
      const h = mountPicker({ size });
      await h.user.click(h.trigger);
      expect(h.trigger.getAttribute('aria-expanded')).toBe('true');
      await h.user.click(screen.getByRole('option', { name: 'Model two' }));
      expect(h.onChange).toHaveBeenCalledExactlyOnceWith('two', '');
      expect(h.trigger.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByRole('option', { name: 'Model two' }).getAttribute('aria-selected')).toBe('true');
      expect(h.trigger.textContent).toContain('Model two');
      h.onChange.mockClear();
      fireEvent.change(screen.getByRole('slider'), { target: { value: '1' } });
      expect(h.onChange).toHaveBeenCalledExactlyOnceWith('two', 'low');
      expect(h.trigger.querySelector('.seed-model-trigger-value')?.textContent).toMatch(/^Model two · (Low|低)$/);
      expect(h.trigger.getAttribute('aria-expanded')).toBe('true');
      await h.user.click(h.trigger);
      expect(h.trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(h.trigger);
    },
  );
  it.each(['{Enter}', ' '] as const)('confirms exactly once through a Portal with %s', async (key) => {
    const h = mountPicker();
    await h.user.click(h.trigger);
    await h.user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Model two' }));
    await h.user.keyboard(key);
    expect(h.onChange).toHaveBeenCalledExactlyOnceWith('two', '');
    expect(h.trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Model two' }));
    await h.user.tab();
    expect(document.activeElement).toBe(screen.getByRole('slider'));
    expect(h.trigger.getAttribute('aria-expanded')).toBe('true');
  });
  it.each(['{Enter}', ' '] as const)('allows the trigger to dismiss the open picker with %s', async (key) => {
    const h = mountPicker();
    await h.user.click(h.trigger);
    await h.user.tab({ shift: true });
    expect(document.activeElement).toBe(h.trigger);
    await h.user.keyboard(key);
    expect(h.trigger.getAttribute('aria-expanded')).toBe('false');
    expect(h.onChange).not.toHaveBeenCalled();
  });
  it('dismisses outside after changing models without reopening or changing thinking', async () => {
    const h = mountPicker();
    await h.user.click(h.trigger);
    await h.user.click(screen.getByRole('option', { name: 'Model two' }));
    expect(h.trigger.getAttribute('aria-expanded')).toBe('true');
    await h.user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(h.trigger.getAttribute('aria-expanded')).toBe('false');
    expect(h.onChange).toHaveBeenCalledExactlyOnceWith('two', '');
  });
  it('supports Home, End and Escape without changing the selection', async () => {
    const h = mountPicker();
    await h.user.keyboard('{Tab}{Tab}{ArrowDown}{End}');
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Model two' }));
    await h.user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Model one' }));
    await h.user.keyboard('{Escape}');
    expect(h.trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(h.trigger);
    expect(h.onChange).not.toHaveBeenCalled();
  });
  it('closes on blank outside clicks, including when the target stops propagation', async () => {
    const h = mountPicker();
    const outside = screen.getByRole('button', { name: 'Outside' });
    outside.addEventListener('pointerdown', (event) => event.stopPropagation());
    await h.user.click(h.trigger);
    await h.user.pointer({ target: outside, keys: '[MouseLeft>]' });
    expect(h.trigger.getAttribute('aria-expanded')).toBe('false');
    await h.user.pointer({ keys: '[/MouseLeft]' });
    expect(h.onChange).not.toHaveBeenCalled();
  });
  it('keeps focus transitions inside the popup open and closes when Tab leaves it', async () => {
    const h = mountPicker();
    await h.user.click(h.trigger);
    await h.user.tab();
    expect(document.activeElement).toBe(screen.getByRole('slider'));
    expect(h.trigger.getAttribute('aria-expanded')).toBe('true');
    await h.user.tab();
    expect(h.trigger.getAttribute('aria-expanded')).toBe('false');
    expect(h.onChange).not.toHaveBeenCalled();
  });
  it('closes on Shift+Tab and programmatic focus outside without stealing focus back', async () => {
    const h = mountPicker();
    await h.user.click(h.trigger);
    await h.user.tab({ shift: true });
    expect(document.activeElement).toBe(h.trigger);
    expect(h.trigger.getAttribute('aria-expanded')).toBe('true');
    await h.user.tab({ shift: true });
    expect(h.trigger.getAttribute('aria-expanded')).toBe('false');
    await h.user.click(h.trigger);
    const outside = screen.getByRole('button', { name: 'Outside' });
    act(() => outside.focus());
    expect(h.trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(outside);
  });
  it('allows switching thinking back to off and Escape from the slider closes only this popup', async () => {
    const h = mountPicker();
    await h.user.click(h.trigger);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '0' } });
    expect(h.onChange).toHaveBeenCalledExactlyOnceWith('one', 'off');
    expect(slider.getAttribute('aria-valuetext')).toBe('Off');
    act(() => slider.focus());
    await h.user.keyboard('{Escape}');
    expect(h.trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(h.trigger);
  });
  it('shows a visible placeholder or unavailable state without choosing the first model', async () => {
    const h = mountPicker({ initial: '' });
    await waitFor(() => expect(h.trigger.textContent).toContain('Select model'));
    h.unmount();
    const missing = mountPicker({ initial: 'removed' });
    await waitFor(() => expect(missing.trigger.textContent).toContain('Model unavailable'));
    expect(missing.trigger.textContent).not.toContain('Model one');
    expect(missing.onChange).not.toHaveBeenCalled();
  });
  it('does not invent off for a model that does not support it', async () => {
    const h = mountPicker({ levels: [{ ...options[0]!, thinkingLevels: ['low', 'high'] }] });
    await h.user.click(h.trigger);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } });
    expect(h.onChange).toHaveBeenCalledExactlyOnceWith('one', 'low');
  });
  it('keeps native slider keys separate from model navigation and consumes Escape once', async () => {
    const parentKeyDown = vi.fn();
    render(
      <SeedI18nProvider>
        <div onKeyDown={parentKeyDown}>
          <Picker onChange={vi.fn()} />
        </div>
      </SeedI18nProvider>,
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Model picker' });
    await user.click(trigger);
    const slider = screen.getByRole('slider');
    act(() => slider.focus());
    const key = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    act(() => {
      slider.dispatchEvent(key);
    });
    expect(key.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(slider);
    parentKeyDown.mockClear();
    await user.keyboard('{Escape}');
    expect(parentKeyDown).not.toHaveBeenCalled();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
  it('supports a model with only the off level without losing its slider', async () => {
    const h = mountPicker({ levels: [{ ...options[0]!, thinkingLevels: ['off'] }] });
    await h.user.click(h.trigger);
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('max')).toBe('0');
    await h.user.click(slider);
    expect(h.onChange).toHaveBeenCalledExactlyOnceWith('one', 'off');
  });
  it('rebuilds the slider when supported levels change without persisting a guessed level', async () => {
    const h = mountPicker();
    await h.user.click(h.trigger);
    const oldThumb = document.querySelector('.seed-discrete-slider-thumb')!;
    h.rerender(
      <SeedI18nProvider>
        <Picker onChange={h.onChange} levels={[{ ...options[0]!, thinkingLevels: ['off', 'low'] }]} />
      </SeedI18nProvider>,
    );
    expect(oldThumb.isConnected).toBe(false);
    expect(document.querySelectorAll('.seed-discrete-slider-tick')).toHaveLength(2);
    expect(screen.getByRole('slider').getAttribute('max')).toBe('1');
    expect(h.onChange).not.toHaveBeenCalled();
  });
  it('keeps keyboard selection in the ordinary portaled select single-shot', async () => {
    const onChange = vi.fn();
    render(<SelectControl portal label="Ordinary select" value="one" options={options} onValueChange={onChange} />);
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Ordinary select' });
    await user.click(trigger);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('two');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it('supports keeping an ordinary select open through the same generic option', async () => {
    const onChange = vi.fn();
    render(
      <SelectControl
        portal
        closeOnSelect={false}
        label="Persistent select"
        value="one"
        options={options}
        onValueChange={onChange}
      />,
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Persistent select' });
    await user.click(trigger);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('two');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
  it('does not open disabled controls and cleans up its Portal on unmount', async () => {
    const h = mountPicker({ disabled: true });
    await h.user.click(h.trigger);
    expect(h.trigger.getAttribute('aria-expanded')).toBe('false');
    h.unmount();
    const active = mountPicker();
    await active.user.click(active.trigger);
    active.unmount();
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    await active.user.click(document.body);
  });
});
