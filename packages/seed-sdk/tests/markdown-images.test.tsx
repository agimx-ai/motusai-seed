// @vitest-environment jsdom
import { createElement, useEffect } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownContent, type MarkdownImage } from '../src/react/components/MarkdownContent';

afterEach(cleanup);
describe('scoped Markdown image extension', () => {
  it('preserves image references for the caller without enabling ordinary links, HTML, or code', async () => {
    const uri = 'example-image:call%2Fid/1', images: MarkdownImage[] = [];
    const view = render(<MarkdownContent imageProtocols={['example-image']} renderImage={(image) => {
      images.push(image); return <span data-image={image.src}>{image.alt}</span>;
    }}>{`![Selected](${uri})\n\n[Link](${uri})\n\n\`![Code](${uri})\`\n\n<img src="${uri}">\n\n![Bad](javascript:alert)`}</MarkdownContent>);
    await waitFor(() => expect(view.container.querySelector('[data-image]')?.textContent).toBe('Selected'));
    expect(images.some((image) => image.src === uri && image.alt === 'Selected')).toBe(true);
    expect(images.every((image) => image.src === uri)).toBe(true);
    expect(view.container.querySelectorAll('[data-image]')).toHaveLength(1);
    expect(view.container.querySelector('img, a')).toBeNull();
    expect(view.container.querySelector('code')?.textContent).toContain('![Code]');
  });
  it('supports reference-style Markdown and preserves Chinese, spaces and encoded characters', async () => {
    const src = 'example-image:%E5%B7%A5%E5%85%B7%2F%E5%9B%BE%E7%89%87/0';
    const view = render(<MarkdownContent imageProtocols={['example-image']} renderImage={(image) => <span data-image={image.src}>{image.alt}</span>}>{`![案例图片][case]\n\n[case]: ${src} "本地原图"`}</MarkdownContent>);
    await waitFor(() => expect(view.container.querySelector('[data-image]')?.getAttribute('data-image')).toBe(src));
  });
  it('keeps default rendering inert for custom protocols and does not remount an image when callbacks change', async () => {
    const uri = 'example-image:call/0';
    const initial = render(<MarkdownContent imageProtocols={['example-image']}>{`![Unsupported](${uri})`}</MarkdownContent>);
    await waitFor(() => expect(initial.container.textContent).toContain('Unsupported'));
    expect(initial.container.querySelector('img[src^="example-image:"]')).toBeNull();
    initial.unmount();
    const mounted = vi.fn();
    function Image() { useEffect(() => { mounted(); }, []); return <span data-preview>Preview</span>; }
    const view = render(<MarkdownContent imageProtocols={['example-image']} renderImage={() => <Image />}>{`![Selected](${uri})`}</MarkdownContent>);
    await waitFor(() => expect(view.container.querySelector('[data-preview]')).not.toBeNull());
    view.rerender(<MarkdownContent imageProtocols={['example-image']} renderImage={() => <Image />}>{`![Selected](${uri})`}</MarkdownContent>);
    expect(mounted).toHaveBeenCalledTimes(1);
  });
});
