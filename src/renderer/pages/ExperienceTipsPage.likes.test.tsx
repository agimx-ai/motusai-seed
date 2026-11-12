// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ExperienceTipArticle, ExperienceTipRead } from '../../shared/experience-tips';
import { SeedI18nProvider } from '../i18n';
import { ExperienceTipsPage } from './ExperienceTipsPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows the viewer’s like in the list and updates it when returning from the article', async () => {
  const article: ExperienceTipArticle = {
    id: 'version',
    tip_id: 'tip',
    title: 'Example tip',
    author: 'Author',
    state: 'published',
    submitted_at: null,
    published_at: null,
    view_count: 2,
    like_count: 2,
    liked: true,
    body: 'Example text.',
    images: [],
  };
  const { body, images, ...summary } = article;
  const readExperienceTips = vi.fn(async (request: ExperienceTipRead) =>
    request.kind === 'article' ? { ...summary, body, images } : { items: [summary], next_cursor: null },
  );
  const setExperienceTipLike = vi.fn(async () => ({ view_count: 2, like_count: 1, liked: false }));
  vi.stubGlobal('motusSeed', {
    readExperienceTips,
    setExperienceTipLike,
    snapshot: async () => ({ languagePreference: 'en-US', locale: 'en-US' }),
    subscribe: () => () => {},
  });

  const onArticleChange = vi.fn<(article: { onBack: () => void } | undefined) => void>();
  render(
    <SeedI18nProvider>
      <ExperienceTipsPage dark={false} actionsContainer={null} onRefreshCounts={() => {}}
        onViewActivity={() => {}} onArticleChange={onArticleChange} />
    </SeedI18nProvider>,
  );

  const row = await screen.findByRole('button', { name: /Example tip.*Liked 2 likes/ });
  expect(row.querySelector('[data-liked="true"]')).toBeTruthy();
  fireEvent.click(row);
  fireEvent.click(await screen.findByRole('button', { name: /^Like\s*2 likes$/, pressed: true }));
  await waitFor(() => expect(screen.getByRole('button', { name: /^Like\s*1 like$/, pressed: false })).toBeTruthy());
  expect(setExperienceTipLike).toHaveBeenCalledWith({ tipId: 'tip', liked: false });
  act(() => onArticleChange.mock.lastCall![0]!.onBack());

  const updatedRow = await screen.findByRole('button', { name: /Example tip.*1 like/ });
  expect(updatedRow.querySelector('[data-liked="true"]')).toBeNull();
  expect(updatedRow.textContent).not.toContain('Liked');
  expect(readExperienceTips).toHaveBeenCalledTimes(2);
});
