// @vitest-environment jsdom
import { fireEvent, render, cleanup, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MarkdownContent } from '../src/react/components/MarkdownContent';

afterEach(cleanup);

it('resolves explicitly allowed links without enabling the protocol for images, HTML or code', async () => {
  const activate = vi.fn(),
    resolved = vi.fn(({ href, children }) =>
      href.startsWith('example-file:') ? <button onClick={() => activate(href)}>{children}</button> : undefined,
    );
  const view = render(
    <MarkdownContent renderLink={resolved} linkProtocols={['example-file']}>
      {
        '[交付文件][file]\n\n[file]: example-file:123 "文件"\n\n![图片](example-file:123)\n\n`[代码](example-file:123)`\n\n<a href="example-file:123">HTML</a>\n\n[危险](javascript:alert)\n\n[未授权](another-file:123)'
      }
    </MarkdownContent>,
  );
  await waitFor(() => expect(view.getByRole('button', { name: '交付文件' })).not.toBeNull());
  fireEvent.click(view.getByRole('button', { name: '交付文件' }));
  expect(activate).toHaveBeenCalledExactlyOnceWith('example-file:123');
  expect(resolved.mock.calls.every(([link]) => link.href === 'example-file:123')).toBe(true);
  expect(view.container.querySelectorAll('button')).toHaveLength(1);
  expect(view.container.querySelector('a, img')).toBeNull();
  expect(view.container.querySelector('code')?.textContent).toContain('[代码]');
});

it('keeps existing inert links by default and calls the current resolver after a rerender', async () => {
  const initial = render(
    <MarkdownContent>{'[file](example-file:123) [website](https://example.com)'}</MarkdownContent>,
  );
  await waitFor(() => expect(initial.container.textContent).toContain('website'));
  expect(initial.container.querySelector('a, button')).toBeNull();
  initial.unmount();
  const first = vi.fn(),
    second = vi.fn();
  const renderLink =
    (onClick: () => void) =>
    ({ children }: any) => <button onClick={onClick}>{children}</button>;
  const view = render(
    <MarkdownContent renderLink={renderLink(first)} linkProtocols={['example-file']}>
      {'[file](example-file:123)'}
    </MarkdownContent>,
  );
  await waitFor(() => expect(view.getByRole('button')).not.toBeNull());
  view.rerender(
    <MarkdownContent renderLink={renderLink(second)} linkProtocols={['example-file']}>
      {'[file](example-file:123)'}
    </MarkdownContent>,
  );
  fireEvent.click(view.getByRole('button'));
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
});
