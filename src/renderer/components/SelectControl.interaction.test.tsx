// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentProvider, SelectControl, type SelectControlOption } from '@motus-ai/seed-sdk/react';

const options: SelectControlOption<string>[] = [
  { value: 'empty', label: 'Empty category', children: [] },
  {
    value: 'disabled',
    label: 'Disabled category',
    disabled: true,
    children: [{ value: 'blocked', label: 'Blocked leaf' }],
  },
  {
    value: 'first',
    label: 'First category',
    children: [
      { value: 'disabled-leaf', label: 'Disabled leaf', disabled: true },
      {
        value: 'nested',
        label: 'Nested category',
        children: [
          { value: 'leaf', label: 'Leaf name', description: 'Available' },
          { value: 'other-leaf', label: 'Other leaf' },
        ],
      },
    ],
  },
  { value: 'second', label: 'Second category', children: [{ value: 'another', label: 'Another name' }] },
];
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 300,
    y: 80,
    left: 300,
    top: 80,
    right: 620,
    bottom: 116,
    width: 320,
    height: 36,
    toJSON() {},
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(extra: Partial<React.ComponentProps<typeof SelectControl<string>>> = {}) {
  const change = vi.fn();
  const props = { label: 'Destination', value: 'leaf', options, onValueChange: change, ...extra };
  const view = render(
    <ComponentProvider pluginId="test.plugin">
      <SelectControl {...props} />
    </ComponentProvider>,
  );
  return { ...view, change, trigger: screen.getByRole('button', { name: 'Destination' }), user: userEvent.setup() };
}

describe('SDK recursive select', () => {
  it('shows a leaf name in the trigger and selects only leaves through three levels', async () => {
    const h = mount({ portal: true });
    expect(h.trigger.textContent).toContain('Leaf name');
    await h.user.click(h.trigger);
    await h.user.click(screen.getByRole('menuitem', { name: 'First category' }));
    expect(h.change).not.toHaveBeenCalled();
    await h.user.click(screen.getByRole('menuitem', { name: 'Nested category' }));
    expect(h.change).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[data-select-column]')).toHaveLength(3);
    expect(screen.getByRole('menuitemradio', { name: 'Leaf name' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: 'Leaf name' }).getAttribute('aria-description')).toBe('Available');
    await h.user.click(screen.getByRole('menuitemradio', { name: 'Other leaf' }));
    expect(h.change).toHaveBeenCalledExactlyOnceWith('other-leaf');
    expect(h.trigger.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(h.trigger));
  });

  it('supports right/left, up/down and Home/End, skipping disabled and empty branches', async () => {
    const h = mount({ portal: true });
    await h.user.click(h.trigger);
    expect(document.activeElement?.textContent).toBe('First category');
    await h.user.keyboard('{Home}');
    expect(document.activeElement?.textContent).toBe('First category');
    await h.user.keyboard('{ArrowRight}');
    expect(document.activeElement?.textContent).toBe('Nested category');
    await h.user.keyboard('{ArrowRight}{End}');
    expect(document.activeElement?.textContent).toBe('Other leaf');
    await h.user.keyboard('{ArrowLeft}');
    expect(document.activeElement?.textContent).toBe('Nested category');
    expect(document.querySelectorAll('[data-select-column]')).toHaveLength(2);
    await h.user.keyboard('{ArrowLeft}{ArrowDown}{ArrowRight}{Enter}');
    expect(h.change).toHaveBeenCalledExactlyOnceWith('another');
  });

  it('switches branches without leaking the previous descendants', async () => {
    const h = mount();
    await h.user.click(h.trigger);
    await h.user.click(screen.getByRole('menuitem', { name: 'First category' }));
    await h.user.click(screen.getByRole('menuitem', { name: 'Nested category' }));
    await h.user.click(screen.getByRole('menuitem', { name: 'Second category' }));
    expect(screen.queryByRole('menuitemradio', { name: 'Other leaf' })).toBeNull();
    expect(screen.getByRole('menuitemradio', { name: 'Another name' })).toBeTruthy();
    expect(h.change).not.toHaveBeenCalled();
  });

  it('marks the portal scope and dismisses with Escape or an outside click', async () => {
    const h = mount({ portal: true });
    await h.user.click(h.trigger);
    expect(document.querySelector('[data-plugin-view-portal="test.plugin"]')).toBeTruthy();
    await h.user.keyboard('{Escape}');
    expect(document.activeElement).toBe(h.trigger);
    expect(h.change).not.toHaveBeenCalled();
    await h.user.click(h.trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu', { name: 'Destination' })).toBeNull();
  });

  it('keeps the menu open when closeOnSelect is false and removes a stale column on refresh', async () => {
    const h = mount({ portal: true, closeOnSelect: false });
    await h.user.click(h.trigger);
    await h.user.click(screen.getByRole('menuitem', { name: 'Second category' }));
    await h.user.click(screen.getByRole('menuitemradio', { name: 'Another name' }));
    expect(h.trigger.getAttribute('aria-expanded')).toBe('true');
    h.rerender(
      <ComponentProvider pluginId="test.plugin">
        <SelectControl portal value="leaf" label="Destination" options={options.slice(0, 3)} onValueChange={h.change} />
      </ComponentProvider>,
    );
    expect(h.trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('menuitemradio', { name: 'Another name' })).toBeNull();
    h.unmount();
    expect(document.querySelector('[data-select-column]')).toBeNull();
  });

  it('does not open while disabled or loading', async () => {
    const h = mount({ loading: true });
    await h.user.click(h.trigger);
    expect(h.trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens at the last category with End and selects from there using the keyboard', async () => {
    const h = mount({ portal: true });
    h.trigger.focus();
    await h.user.keyboard('{End}');
    expect(document.activeElement?.textContent).toBe('Second category');
    await h.user.keyboard('{ArrowRight}{Enter}');
    expect(h.change).toHaveBeenCalledExactlyOnceWith('another');
  });

  it.each([true, false])('keeps a multi-column menu inside a narrow viewport (portal %s)', async (portal) => {
    vi.stubGlobal('innerWidth', 320);
    const h = mount({ portal });
    await h.user.click(h.trigger);
    await h.user.click(screen.getByRole('menuitem', { name: 'First category' }));
    await h.user.click(screen.getByRole('menuitem', { name: 'Nested category' }));
    const menu = screen.getByRole('menu', { name: 'Destination' });
    expect(Number.parseFloat(menu.style.width)).toBeLessThanOrEqual(304);
    expect(Number.parseFloat(menu.style.left) + (portal ? 0 : 300)).toBeGreaterThanOrEqual(8);
  });
});
