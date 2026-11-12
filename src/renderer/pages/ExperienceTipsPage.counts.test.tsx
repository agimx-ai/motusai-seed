// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SeedEvent } from '../../shared/contracts';
import type { ExperienceTipRead, ExperienceTipSummary } from '../../shared/experience-tips';
import { useExperienceTipCounts } from '../hooks/use-experience-tip-counts';
import { SeedI18nProvider } from '../i18n';
import { SidebarNavigation } from '../layouts/SidebarNavigation';
import { ExperienceTipsPage } from './ExperienceTipsPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows unread activity, clears each tab independently, and keeps checkpoints per account', async () => {
  const listeners = new Set<(event: SeedEvent) => void>();
  const emit = (event: SeedEvent) => act(() => listeners.forEach((listener) => listener(event)));
  const time = (second: number) => new Date(second * 1000).toISOString();
  let now = time(3);
  let publication = time(1);
  let review = time(2);
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  storage.set('seed.experienceTipActivitySeen:author', JSON.stringify({
    articlesSince: time(0), submissionsSince: time(0),
  }));
  const submittedAt = '2026-11-12T01:00:00.000Z';
  const publishedAt = '2026-11-12T02:00:00.000Z';
  const unlistedAt = '2026-11-12T03:00:00.000Z';
  const submissionDates = { author: 'Author', submitted_at: submittedAt, published_at: publishedAt };
  const submissions: ExperienceTipSummary[] = [
    {
      ...submissionDates,
      id: '1',
      tip_id: 'a',
      title: 'Stopped tip',
      state: 'published',
      unlisted: { at: unlistedAt, reason: 'Example feedback' },
    },
    { ...submissionDates, id: '2', tip_id: 'b', title: 'Published tip', state: 'published' },
    { ...submissionDates, id: '3', tip_id: 'c', title: 'Pending tip', state: 'pending' },
  ];
  const readExperienceTips = vi.fn(async (request: ExperienceTipRead) => {
    if (request.kind === 'my-submissions') return { items: submissions, next_cursor: null };
    if (request.kind !== 'activity-counts') return { items: [], next_cursor: null };
    return {
      articles: request.articlesSince && request.articlesSince < publication ? 2 : 0,
      my_submissions: request.submissionsSince && request.submissionsSince < review ? 1 : 0,
      as_of: now,
    };
  });
  vi.stubGlobal('motusSeed', {
    readExperienceTips,
    snapshot: async () => ({ languagePreference: 'en-US', locale: 'en-US' }),
    subscribe(listener: (event: SeedEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  function Fixture({ userId, showPage }: { userId: string; showPage?: boolean }) {
    const { counts, refreshCounts, markSeen } = useExperienceTipCounts(userId);
    return (
      <SeedI18nProvider>
        <SidebarNavigation
          view="experience-tips"
          experienceTipCount={counts && counts.articles + counts.my_submissions}
          onNavigate={vi.fn()}
          onOpenPlugin={vi.fn()}
        />
        {showPage && (
          <ExperienceTipsPage key={userId} dark={false} actionsContainer={null} counts={counts}
            onRefreshCounts={refreshCounts} onViewActivity={markSeen} onArticleChange={vi.fn()} />
        )}
      </SeedI18nProvider>
    );
  }
  const { rerender } = render(<Fixture userId="author" />);
  const total = await screen.findByRole('button', { name: 'Experience tips, 3' });
  expect(total.querySelector('.bg-info.text-white')?.textContent).toBe('3');
  rerender(<Fixture userId="author" showPage />);
  expect(screen.getByRole('radio', { name: 'Browse tips 2' }).querySelector('.bg-info.text-white')?.textContent).toBe('2');
  expect(screen.getByRole('radio', { name: 'My submissions 1' }).querySelector('.bg-info.text-white')?.textContent).toBe('1');
  expect(await screen.findByRole('button', { name: 'Experience tips, 1' })).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Browse tips' })).toBeTruthy();
  fireEvent.click(screen.getByRole('radio', { name: 'My submissions 1' }));
  expect(await screen.findByRole('radio', { name: 'My submissions' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Experience tips' })).toBeTruthy();
  for (const [title, date, label] of [
    ['Stopped tip', unlistedAt, 'Stopped displaying'],
    ['Published tip', publishedAt, 'Published'],
    ['Pending tip', submittedAt, 'Submitted'],
  ]) {
    const row = (await screen.findByText(title)).closest('li')!;
    expect(row.querySelectorAll('time')).toHaveLength(1);
    expect(row.querySelector('time')?.dateTime).toBe(date);
    expect(row.querySelector('small')?.textContent).toContain(label);
    if (title === 'Stopped tip') expect(within(row).getByText('Reason: Example feedback')).toBeTruthy();
  }

  rerender(<Fixture userId="author" />);
  now = time(5);
  review = time(4);
  emit({ type: 'experience.review.changed' });
  expect(await screen.findByRole('button', { name: 'Experience tips, 1' })).toBeTruthy();
  publication = time(5);
  emit({ type: 'experience.articles.changed' });
  expect(await screen.findByRole('button', { name: 'Experience tips, 3' })).toBeTruthy();
  rerender(<Fixture userId="reader" />);
  expect(screen.getByRole('button', { name: 'Experience tips' })).toBeTruthy();
  await waitFor(() => expect(storage.get('seed.experienceTipActivitySeen:reader')).toContain(now));
  rerender(<Fixture userId="author" />);
  expect(await screen.findByRole('button', { name: 'Experience tips, 3' })).toBeTruthy();
});
