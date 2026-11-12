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
  const download = vi.fn(async () => {});
  vi.stubGlobal('motusSeed', {
    downloadExperienceTipImage: download,
    snapshot: async () => ({ languagePreference: 'en-US', locale: 'en-US' }),
    subscribe: () => () => {},
  });

  const showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  const close = vi.fn(function (this: HTMLDialogElement) { this.open = false; });
  Object.assign(HTMLDialogElement.prototype, { showModal, close });
  try {
    const src = 'https://cloud.example.test/fixture.png?ticket=test';
    const article: ExperienceTipArticle = {
      id: 'article',
      tip_id: 'tip',
      title: 'Fixture',
      author: 'Author',
      state: 'published',
      submitted_at: null,
      published_at: null,
      body: '![Approved](experience-image:fixture)\n\n![External](https://other.example.test/image.png)',
      images: [{ id: 'fixture', url: src }],
    };
    const { container, unmount } = render(
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
    expect(root?.querySelectorAll('img')).toHaveLength(1);
    expect(image.alt).toBe('Approved');
    Object.defineProperty(image, 'naturalWidth', { value: 800 });
    image.focus();
    fireEvent.keyDown(image, { key: 'Enter' });
    const dialog = screen.getByRole('dialog', { name: 'Approved' });
    expect(showModal).toHaveBeenCalledOnce();
    expect(dialog.querySelector('img')?.src).toBe(src);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download original' }));
    expect(download).toHaveBeenCalledWith(src);
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(root?.activeElement).toBe(image);
    unmount();
    expect(close).toHaveBeenCalledOnce();
  } finally {
    cleanup();
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  }
});
