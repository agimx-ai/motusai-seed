// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCurrentColorIcon, ThemedIcon } from '@motus-ai/seed-sdk/react';
import { useTheme, type ThemePreference } from '../hooks/use-theme';

const svgUrl = (body: string) =>
  `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`)}`;
const monochrome = svgUrl('<path fill="currentColor" d="M0 0h24v24H0z"/>');
const colored = svgUrl('<path fill="#4D6BFE" d="M0 0h24v24H0z"/>');
let style: HTMLStyleElement;

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  style = document.createElement('style');
  style.textContent = readFileSync('packages/seed-sdk/src/react/components/ThemedIcon.css', 'utf8');
  document.head.append(style);
});
afterEach(() => {
  cleanup();
  style.remove();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = '';
  vi.unstubAllGlobals();
});

function Fixture({
  theme,
  light = monochrome,
  dark,
  label = false,
}: {
  theme: ThemePreference;
  light?: string;
  dark?: string;
  label?: boolean;
}) {
  useTheme(theme);
  return label ? (
    <span>
      <ThemedIcon iconDataUrl={light} iconDarkDataUrl={dark} />
      Option
    </span>
  ) : (
    <ThemedIcon iconDataUrl={light} iconDarkDataUrl={dark} />
  );
}

describe('generic themed icons', () => {
  it.each([false, true])(
    'switches explicit images light → dark → light without remounting (configuration label: %s)',
    (label) => {
      const dark = svgUrl('<path fill="#fff" d="M0 0h24v24H0z"/>');
      const h = render(<Fixture theme="light" dark={dark} label={label} />);
      const icon = h.container.querySelector('.seed-themed-icon')!;
      const images = Array.from(icon.querySelectorAll('img'));
      const visible = () =>
        images.filter((image) => getComputedStyle(image).display !== 'none').map((image) => image.getAttribute('src'));
      expect(visible()).toEqual([monochrome]);
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      h.rerender(<Fixture theme="dark" dark={dark} label={label} />);
      expect(visible()).toEqual([dark]);
      expect(h.container.querySelector('.seed-themed-icon')).toBe(icon);
      h.rerender(<Fixture theme="light" dark={dark} label={label} />);
      expect(visible()).toEqual([monochrome]);
      expect(icon.getAttribute('style')).toBeNull();
    },
  );

  it('lets currentColor SVGs inherit foreground in both themes, without inversion', () => {
    const h = render(<Fixture theme="light" />);
    const icon = h.container.querySelector<HTMLElement>('.seed-themed-icon')!;
    for (const theme of ['light', 'dark', 'light'] as const) {
      h.rerender(<Fixture theme={theme} />);
      expect(document.documentElement.dataset.theme).toBe(theme);
      expect(icon.style.backgroundColor).toBe('currentcolor');
      expect(icon.style.maskImage).toContain(monochrome);
      expect(icon.style.maskSize).toBe('contain');
      expect(icon.style.filter).toBe('');
      expect(icon.querySelector('img')).toBeNull();
    }
  });

  it.each([colored, 'data:image/png;base64,iVBORw0KGgo='])(
    'preserves original single-image colors across theme switches (%s)',
    (light) => {
      const h = render(<Fixture theme="light" light={light} />);
      const image = h.container.querySelector('img')!;
      for (const theme of ['dark', 'light'] as const) {
        h.rerender(<Fixture theme={theme} light={light} />);
        expect(h.container.querySelector('img')).toBe(image);
        expect(image.getAttribute('src')).toBe(light);
        expect(getComputedStyle(image).display).not.toBe('none');
        expect(image.style.filter).toBe('');
        expect(h.container.querySelector<HTMLElement>('.seed-themed-icon')!.style.maskImage).toBe('');
      }
    },
  );

  it('updates icon mode when catalog images change without retaining a stale mask', () => {
    const h = render(<Fixture theme="dark" />);
    expect(h.container.querySelector('img')).toBeNull();
    h.rerender(<Fixture theme="dark" light={colored} />);
    expect(h.container.querySelector('img')?.getAttribute('src')).toBe(colored);
    expect(h.container.querySelector<HTMLElement>('.seed-themed-icon')!.style.maskImage).toBe('');
  });

  it('follows system theme changes for an explicit pair', () => {
    let listener!: () => void;
    const media = {
      matches: false,
      addEventListener: vi.fn((_: string, callback: () => void) => {
        listener = callback;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', () => media);
    const h = render(<Fixture theme="system" dark={colored} />);
    const image = h.container.querySelector('.seed-themed-icon-dark')!;
    expect(getComputedStyle(image).display).toBe('none');
    media.matches = true;
    act(() => listener());
    expect(getComputedStyle(image).display).toBe('block');
    media.matches = false;
    act(() => listener());
    expect(getComputedStyle(image).display).toBe('none');
    h.unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
  });
});

describe('currentColor SVG classification', () => {
  it.each([
    '<path fill="currentColor"/>',
    '<path fill="none" stroke="currentColor"/>',
    '<g fill="CURRENTCOLOR"><path/></g>',
  ])('accepts explicit inheriting paint: %s', (body) => {
    expect(isCurrentColorIcon(svgUrl(body))).toBe(true);
  });
  it.each([
    '<path fill="#4D6BFE"/>',
    '<path fill="#000"/>',
    '<path/>',
    '<path fill="currentColor"/><path fill="#ff0000"/>',
    '<g color="blue"><path fill="currentColor"/></g>',
    '<path fill="currentColor" style="fill:red"/>',
    '<style>path{fill:red}</style><path fill="currentColor"/>',
    '<linearGradient id="brand"/><path fill="currentColor"/>',
    '<image href="brand.png"/><path fill="currentColor"/>',
    '<use href="#brand"/><path fill="currentColor"/>',
  ])('does not recolor fixed, mixed or complex paint: %s', (body) => {
    expect(isCurrentColorIcon(svgUrl(body))).toBe(false);
  });
  it.each(['file:///tmp/icon.svg', 'data:image/svg+xml;base64,!', `data:image/svg+xml;base64,${'A'.repeat(350_000)}`])(
    'ignores invalid or oversized sources',
    (source) => {
      expect(isCurrentColorIcon(source)).toBe(false);
    },
  );
});
