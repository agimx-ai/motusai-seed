// @vitest-environment jsdom
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscreteSlider } from '@motus-ai/seed-sdk/react';

const options = ['off', 'low', 'high', 'max'].map((value) => ({ value, label: value.toUpperCase() }));
let reduced = true;
let mediaListeners: Set<() => void>;
let frames: Map<number, FrameRequestCallback>;
let observers: Set<object>;
let frameId: number;
beforeEach(() => {
  reduced = true;
  mediaListeners = new Set();
  frames = new Map();
  observers = new Set();
  frameId = 0;
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        observers.add(this);
      }
      disconnect() {
        observers.delete(this);
      }
    },
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('seed-discrete-slider-thumb') ? 24 : 200;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(24);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 200,
    bottom: 24,
    width: 200,
    height: 24,
    toJSON() {},
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(value = 'off', items = options, active = true) {
  const change = vi.fn();
  function Harness({ active }: { active: boolean }) {
    const [selected, setSelected] = useState(value);
    return (
      <DiscreteSlider
        label="Level"
        value={selected}
        options={items}
        placeholder="Default"
        unselectedLabel="No selection"
        active={active}
        onChange={(next) => {
          setSelected(next);
          change(next);
        }}
      />
    );
  }
  const result = render(<Harness active={active} />);
  return {
    ...result,
    change,
    range: screen.getByRole('slider') as HTMLInputElement,
    setActive: (active: boolean) => result.rerender(<Harness active={active} />),
  };
}

describe('DiscreteSlider', () => {
  it('keeps the full MIT notice available in packaged renderer assets', () => {
    const config = readFileSync('vite.config.mts', 'utf8');
    expect(config).toContain("fileName: 'third-party-notices/liquid-gooey.txt'");
    expect(config).toContain('packages/seed-sdk/src/react/vendor/liquid-gooey/LICENSE');
    expect(readFileSync('packages/seed-sdk/src/react/vendor/liquid-gooey/LICENSE', 'utf8')).toContain('MIT License');
  });
  it('previews continuous dragging but commits the discrete level once on native change', () => {
    const h = mount();
    fireEvent.pointerDown(h.range, { clientX: 12 });
    fireEvent.pointerMove(window, { clientX: 100 });
    fireEvent.input(h.range, { target: { value: '2' } });
    expect(h.range.getAttribute('aria-valuetext')).toBe('HIGH');
    expect(h.container.querySelector('.seed-discrete-slider-thumb')?.getAttribute('style')).toContain(
      'translateX(88px)',
    );
    expect(h.range.classList.contains('is-dragging')).toBe(true);
    expect(h.change).not.toHaveBeenCalled();
    fireEvent.pointerUp(window);
    fireEvent.change(h.range, { target: { value: '2' } });
    expect(h.change).toHaveBeenCalledExactlyOnceWith('high');
    expect(h.range.classList.contains('is-dragging')).toBe(false);
    fireEvent.change(h.range, { target: { value: '2' } });
    expect(h.change).toHaveBeenCalledOnce();
  });

  it('rolls cancelled and interrupted drags back without committing', () => {
    const h = mount('low');
    for (const cancel of [() => fireEvent.pointerCancel(window), () => fireEvent.blur(window)]) {
      fireEvent.pointerDown(h.range, { clientX: 180 });
      fireEvent.input(h.range, { target: { value: '3' } });
      cancel();
      fireEvent.change(h.range, { target: { value: '3' } });
      expect(h.change).not.toHaveBeenCalled();
      expect(h.range.classList.contains('is-dragging')).toBe(false);
      expect(h.range.getAttribute('aria-valuetext')).toBe('LOW');
    }
    fireEvent.keyDown(h.range, { key: 'ArrowRight' });
    fireEvent.change(h.range, { target: { value: '2' } });
    expect(h.change).toHaveBeenCalledExactlyOnceWith('high');
  });

  it('distinguishes keyboard focus from pointer use and keeps native keyboard defaults', () => {
    const h = mount('low');
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(h.range.classList.contains('is-keyboard-focus')).toBe(true);
    act(() => h.range.focus());
    const event = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
    act(() => h.range.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    fireEvent.input(h.range, { target: { value: '3' } });
    fireEvent.change(h.range, { target: { value: '3' } });
    expect(h.change).toHaveBeenCalledExactlyOnceWith('max');
    fireEvent.pointerDown(h.range, { clientX: 12 });
    expect(h.range.classList.contains('is-keyboard-focus')).toBe(false);
  });

  it('preserves no selection, permits off, and derives ticks and the upper label from actual options', () => {
    const h = mount('');
    expect(h.range.getAttribute('aria-valuetext')).toBe('No selection');
    expect(h.container.querySelector('.seed-discrete-slider-summary')?.textContent).toBe('DefaultMAX');
    expect(h.container.querySelectorAll('.seed-discrete-slider-tick')).toHaveLength(4);
    expect(h.change).not.toHaveBeenCalled();
    fireEvent.click(h.range);
    expect(h.change).toHaveBeenCalledExactlyOnceWith('off');
    expect(h.range.getAttribute('aria-valuetext')).toBe('OFF');
    h.unmount();
    const single = mount('', options.slice(0, 1));
    expect(single.container.querySelectorAll('.seed-discrete-slider-summary > span')).toHaveLength(1);
    expect(single.container.querySelectorAll('.seed-discrete-slider-tick')).toHaveLength(1);
    fireEvent.click(single.range);
    expect(single.change).toHaveBeenCalledExactlyOnceWith('off');
  });

  it('covers the rail beneath the thumb at both endpoints without changing its range', () => {
    const css = readFileSync('packages/seed-sdk/src/components.css', 'utf8');
    const first = mount('off');
    const firstTrack = first.container.querySelector<HTMLElement>('.seed-discrete-slider-track')!;
    expect(firstTrack.style.getPropertyValue('--seed-slider-progress')).toBe('0');
    expect(first.container.querySelectorAll('.seed-discrete-slider-thumb-underlay')).toHaveLength(1);
    expect(css).toContain('left: calc((100% - var(--seed-slider-thumb-size)) * var(--seed-slider-progress));');
    expect(css).toContain('background: var(--card);');
    expect(first.range.min).toBe('0');
    expect(first.range.max).toBe('3');
    first.unmount();

    const last = mount('max');
    expect(
      last.container
        .querySelector<HTMLElement>('.seed-discrete-slider-track')!
        .style.getPropertyValue('--seed-slider-progress'),
    ).toBe('1');
    expect(last.container.querySelectorAll('.seed-discrete-slider-thumb-underlay')).toHaveLength(1);
    expect(last.range.min).toBe('0');
    expect(last.range.max).toBe('3');
  });

  it('keeps endpoint labels above the overflowing liquid thumb layer', () => {
    reduced = false;
    const h = mount('off');
    const css = readFileSync('packages/seed-sdk/src/components.css', 'utf8');
    expect(h.container.querySelector('.seed-discrete-slider-summary')?.textContent).toBe('OFFMAX');
    expect(h.container.querySelector('[data-gooey-svg]')).not.toBeNull();
    expect(css).toMatch(/\.seed-discrete-slider\s*\{[^}]*position:\s*relative;[^}]*isolation:\s*isolate;/s);
    expect(css).toMatch(/\.seed-discrete-slider-summary\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*4;/s);
    expect(css).toMatch(/\.seed-discrete-slider-motion\s*\{[^}]*z-index:\s*3;/s);
  });

  it('uses the original liquid engine, starts at the saved position and removes it for reduced motion', () => {
    reduced = false;
    const h = mount('max');
    expect(h.container.querySelector('[data-gooey-svg]')).not.toBeNull();
    expect(h.container.querySelector('.seed-discrete-slider-thumb')?.getAttribute('style')).toContain(
      'translateX(176px)',
    );
    expect(frames.size).toBeGreaterThan(0);
    act(() => {
      reduced = true;
      for (const listener of [...mediaListeners]) listener();
    });
    expect(h.container.querySelector('[data-gooey-svg]')).toBeNull();
    expect(h.container.querySelector('.seed-discrete-slider-thumb.is-static')).not.toBeNull();
    expect(frames.size).toBe(0);
    act(() => {
      reduced = false;
      for (const listener of [...mediaListeners]) listener();
    });
    expect(h.container.querySelector('[data-gooey-svg]')).not.toBeNull();
    h.unmount();
    expect(frames.size).toBe(0);
    expect(observers.size).toBe(0);
    expect(mediaListeners.size).toBe(0);
  });

  it('cleans up during close and can reopen without retaining a pressed thumb', () => {
    reduced = false;
    const h = mount('high');
    fireEvent.pointerDown(h.range, { clientX: 100 });
    h.setActive(false);
    expect(h.container.querySelector('[data-gooey-svg]')).toBeNull();
    expect(h.range.disabled).toBe(true);
    expect(h.range.classList.contains('is-dragging')).toBe(false);
    expect(frames.size).toBe(0);
    h.setActive(true);
    expect(h.range.disabled).toBe(false);
    expect(h.container.querySelector('[data-gooey-svg]')).not.toBeNull();
    expect(h.change).not.toHaveBeenCalled();
  });
});
