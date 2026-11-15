// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from '@motus-ai/seed-sdk';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ExperienceTipArticle, ExperienceTipRead } from '../../shared/experience-tips';
import { SeedI18nProvider } from '../i18n';
import { ExperienceTipsPage } from './ExperienceTipsPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  ['https://share.example.test/tips/tip'],
  [undefined],
])('shows the share action and handles the article share URL %s', async (shareUrl) => {
  const article: ExperienceTipArticle = {
    id: 'version',
    tip_id: 'tip',
    title: 'Example tip',
    author: 'Author',
    state: 'published',
    submitted_at: null,
    published_at: '2020-11-12T12:00:00Z',
    view_count: 25,
    like_count: 0,
    liked: false,
    body: 'Example text.',
    images: [],
    ...(shareUrl ? {
      share_url: shareUrl,
      share_count: 3,
      author_avatar_url: 'https://example.test/author.webp',
      recent_readers: [{ name: 'Recent Reader', avatar_url: 'https://example.test/avatar.webp' }],
    } : {}),
  };
  const copyText = vi.fn(async () => {});
  const recordExperienceTipShare = vi.fn(async () => ({ share_count: 4 }));
  const unavailable = vi.spyOn(toast, 'info');
  vi.stubGlobal('motusWindow', { platform: 'darwin', copyText });
  vi.stubGlobal('motusSeed', {
    recordExperienceTipShare,
    readExperienceTips: async (request: ExperienceTipRead) =>
      request.kind === 'article' ? article : { items: [], next_cursor: null },
    snapshot: async () => ({ languagePreference: 'en-US', locale: 'en-US' }),
    subscribe: () => () => {},
  });

  render(
    <SeedI18nProvider>
      <ExperienceTipsPage dark={false} actionsContainer={null} articleId={article.tip_id}
        onRefreshCounts={vi.fn()} onViewActivity={vi.fn()} onArticleChange={vi.fn()} onArticleNavigate={vi.fn()} />
    </SeedI18nProvider>,
  );
  const readingTime = await screen.findByText('1 min read');
  const label = shareUrl ? 'Share 3' : 'Share';
  const share = screen.getByRole('button', { name: label });
  const author = screen.getByText('Author').parentElement;
  expect(author?.querySelector('img')?.getAttribute('src')).toBe(article.author_avatar_url);
  const publishedDate = screen.getByText('Nov 12, 2020');
  const views = screen.getByRole('group', { name: 'Recent readers' });
  expect(screen.queryByText('25 views')).toBeNull();
  const like = screen.getByRole('button', { name: /^Like\s*0 likes$/ });
  expect(Array.from(readingTime.parentElement!.children)).toEqual([
    author, publishedDate, readingTime, views, like, share,
  ]);
  expect(share.textContent).toBe(shareUrl ? '3' : '');
  if (shareUrl) {
    expect(screen.getByText('+24')).toBeTruthy();
    const reader = screen.getByRole('img', { name: 'Recent Reader' });
    fireEvent.focus(reader);
    expect(screen.getByText('Recent Reader')).toBeTruthy();
    fireEvent.keyDown(reader, { key: 'Escape' });
  } else {
    expect(screen.getByText('+25')).toBeTruthy();
  }
  fireEvent.click(share);
  if (shareUrl) {
    expect(copyText).toHaveBeenCalledExactlyOnceWith(shareUrl);
    await screen.findByRole('button', { name: 'Share 4' });
    expect(recordExperienceTipShare).toHaveBeenCalledExactlyOnceWith(article.tip_id);
    expect(unavailable).not.toHaveBeenCalled();
  } else {
    expect(copyText).not.toHaveBeenCalled();
    expect(recordExperienceTipShare).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledExactlyOnceWith('This tip can’t be shared right now.');
  }
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
  function Fixture() {
    const [articleId, setArticleId] = useState<string>();
    return <ExperienceTipsPage dark={false} actionsContainer={null} onRefreshCounts={() => {}}
      onViewActivity={() => {}} onArticleChange={onArticleChange} articleId={articleId} onArticleNavigate={setArticleId} />;
  }
  render(
    <SeedI18nProvider>
      <Fixture />
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
