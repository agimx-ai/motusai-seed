// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ExperienceTipArticle } from '../../shared/experience-tips';
import { SeedI18nProvider } from '../i18n';
import { ExperienceMarkdown } from './ExperienceMarkdown';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('opens approved Markdown images from the shadow root and restores focus on close', async () => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('motusSeed', {
    snapshot: async () => ({ languagePreference: 'en-US', locale: 'en-US' }),
    subscribe: () => () => {},
  });

  const src = 'https://cloud.example.test/fixture.png?ticket=test';
  const secondSrc = 'https://cloud.example.test/second.png?ticket=test';
  const article: ExperienceTipArticle = {
    id: 'article',
    tip_id: 'tip',
    title: 'Fixture',
    author: 'Author',
    state: 'published',
    submitted_at: null,
    published_at: null,
    body: '![Approved](experience-image:fixture)\n\n![Second](experience-image:second)\n\n![External](https://other.example.test/image.png)',
    images: [{ id: 'fixture', url: src }, { id: 'second', url: secondSrc }],
  };
  const { container } = render(
    <SeedI18nProvider>
      <ExperienceMarkdown article={article} dark={false} onReadingMinutes={vi.fn()} onImageError={vi.fn()} />
    </SeedI18nProvider>,
  );
  const root = container.querySelector('.experience-article-body')?.shadowRoot;
  const image = await waitFor(() => {
    const candidate = root?.querySelector<HTMLImageElement>('img[aria-label="Preview Approved"]');
    expect(candidate).toBeTruthy();
    return candidate!;
  });
  expect(root?.querySelectorAll('img')).toHaveLength(2);
  expect(image.alt).toBe('Approved');
  Object.defineProperty(image, 'naturalWidth', { value: 800 });
  image.focus();
  fireEvent.keyDown(image, { key: 'Enter' });
  const dialog = screen.getByRole('dialog', { name: 'Image preview' });
  expect(dialog.querySelector('.yarl__slide_current img')?.getAttribute('src')).toBe(src);
  fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
  await waitFor(() => expect(dialog.querySelector('.yarl__slide_current img')?.getAttribute('src')).toBe(secondSrc));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Close preview' }), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(root?.activeElement).toBe(image);
});
