// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserAvatar } from './UserAvatar';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('UserAvatar', () => {
  it('shows initials on failure, retries a limited number of times, and restores the image on success', () => {
    vi.useFakeTimers();
    const view = render(<UserAvatar name="Yeuolir" imageUrl="https://example.test/avatar" className="avatar" />);
    const first = view.container.querySelector('img')!;
    fireEvent.error(first);
    expect(view.container.textContent).toBe('Y');
    expect(first.className).toBe('hidden');

    act(() => vi.advanceTimersByTime(2_000));
    const retry = view.container.querySelector('img')!;
    expect(retry).not.toBe(first);
    fireEvent.load(retry);
    expect(view.container.textContent).toBe('');
    expect(retry.className).not.toBe('hidden');

    fireEvent.error(retry);
    for (const delay of [2_000, 5_000, 10_000, 20_000, 40_000, 60_000]) {
      const previous = view.container.querySelector('img')!;
      act(() => vi.advanceTimersByTime(delay));
      const next = view.container.querySelector('img')!;
      expect(next).not.toBe(previous);
      fireEvent.error(next);
    }
    const last = view.container.querySelector('img')!;
    act(() => vi.advanceTimersByTime(120_000));
    expect(view.container.querySelector('img')).toBe(last);
    expect(view.container.textContent).toBe('Y');
    act(() => window.dispatchEvent(new Event('online')));
    const onlineRetry = view.container.querySelector('img')!;
    expect(onlineRetry).not.toBe(last);
    act(() => window.dispatchEvent(new Event('online')));
    expect(view.container.querySelector('img')).toBe(onlineRetry);
    fireEvent.error(onlineRetry);
    act(() => vi.advanceTimersByTime(120_000));
    expect(view.container.querySelector('img')).toBe(onlineRetry);
    act(() => window.dispatchEvent(new Event('online')));
    fireEvent.load(view.container.querySelector('img')!);
    expect(view.container.textContent).toBe('');
  });

  it('loads a changed image URL after failure and cancels the old retry', () => {
    vi.useFakeTimers();
    const view = render(<UserAvatar name="用户" imageUrl="https://example.test/old" className="avatar" />);
    fireEvent.error(view.container.querySelector('img')!);
    expect(view.container.textContent).toBe('用');
    view.rerender(<UserAvatar name="用户" imageUrl="https://example.test/new" className="avatar" />);
    const image = view.container.querySelector('img')!;
    expect(image.getAttribute('src')).toBe('https://example.test/new');
    act(() => vi.advanceTimersByTime(2_000));
    expect(view.container.querySelector('img')).toBe(image);
    expect(view.container.textContent).toBe('');
  });
});
