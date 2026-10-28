// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AuditEntry } from '../../shared/contracts';
import { SeedI18nProvider } from '../i18n';
import { ActivityPage } from './ActivityPage';

vi.mock('../components/InfiniteScrollTrigger', () => ({
  InfiniteScrollTrigger: ({
    hasMore,
    loading,
    onLoadMore,
  }: {
    hasMore: boolean;
    loading: boolean;
    onLoadMore: () => void;
  }) => (
    <button disabled={!hasMore || loading} onClick={onLoadMore}>
      加载下一页
    </button>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('combines type and status filters without filtering by operation impact', async () => {
  const entries: AuditEntry[] = [
    {
      id: 'a',
      timestamp: '2026-10-28T00:00:00Z',
      source: 'agent',
      operation: 'files.read_file',
      outcome: 'allowed',
      summary: '读取文件',
    },
  ];
  const queryAudit = vi.fn().mockResolvedValue({ items: entries, total: 1 });
  vi.stubGlobal('motusSeed', {
    snapshot: async () => ({ locale: 'zh-CN', languagePreference: 'zh-CN' }),
    subscribe: () => () => {},
    queryAudit,
  });
  render(
    <SeedI18nProvider>
      <ActivityPage appName="Seed" entries={entries} />
    </SeedI18nProvider>,
  );
  expect(screen.queryByRole('button', { name: '操作影响' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '类型' }));
  expect(screen.queryByRole('option', { name: '全部影响' })).toBeNull();
  fireEvent.click(screen.getByRole('option', { name: '能力调用' }));
  fireEvent.click(screen.getByRole('radio', { name: '异常' }));
  await waitFor(() =>
    expect(queryAudit).toHaveBeenLastCalledWith({
      category: 'capabilities',
      status: 'attention',
      query: '',
      limit: 50,
    }),
  );
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '文件' } });
  await waitFor(() =>
    expect(queryAudit).toHaveBeenLastCalledWith({
      category: 'capabilities',
      status: 'attention',
      query: '文件',
      limit: 50,
    }),
  );
});

it('shows full day totals across pages and ignores a page returned after changing filters', async () => {
  const entry: AuditEntry = {
    id: 'first',
    timestamp: '2026-10-28T12:00:00Z',
    source: 'agent',
    operation: 'files.read_file',
    outcome: 'allowed',
    summary: '第一页记录',
  };
  let resolveOldPage!: (page: unknown) => void;
  const queryAudit = vi
    .fn()
    .mockResolvedValueOnce({ items: [entry], total: 123, dayCounts: { '2026-10-28': 123 }, nextCursor: 'page2' })
    .mockResolvedValueOnce({
      items: [entry, { ...entry, id: 'second', summary: '第二页记录' }],
      total: 123,
      dayCounts: { '2026-10-28': 123 },
      nextCursor: 'page3',
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOldPage = resolve;
        }),
    )
    .mockResolvedValueOnce({
      items: [{ ...entry, id: 'filtered', outcome: 'failed', summary: '异常记录' }],
      total: 7,
      dayCounts: { '2026-10-28': 7 },
    });
  vi.stubGlobal('motusSeed', {
    snapshot: async () => ({ locale: 'zh-CN', languagePreference: 'zh-CN' }),
    subscribe: () => () => {},
    queryAudit,
  });
  render(
    <SeedI18nProvider>
      <ActivityPage entries={[entry]} appName="Seed" />
    </SeedI18nProvider>,
  );
  await screen.findByText('123');
  fireEvent.click(screen.getByRole('button', { name: '加载下一页' }));
  await screen.findByText('第二页记录');
  expect(screen.getAllByText('第一页记录')).toHaveLength(1);
  expect(screen.getByText('123')).toBeTruthy();
  expect(queryAudit).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: 'page2' }));
  fireEvent.click(screen.getByRole('button', { name: '加载下一页' }));
  expect(queryAudit).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByRole('radio', { name: '异常' }));
  await screen.findByText('异常记录');
  await act(async () =>
    resolveOldPage({
      items: [{ ...entry, id: 'stale', summary: '过期记录' }],
      total: 123,
      dayCounts: { '2026-10-28': 123 },
      nextCursor: 'staleCursor',
    }),
  );
  expect(screen.queryByText('过期记录')).toBeNull();
  expect(screen.queryByText('123')).toBeNull();
  expect(screen.getByText('7')).toBeTruthy();
  expect((screen.getByRole('button', { name: '加载下一页' }) as HTMLButtonElement).disabled).toBe(true);
});

it('shows the original summary for failed historical records without a structured error', () => {
  vi.stubGlobal('motusSeed', {
    snapshot: async () => ({ locale: 'zh-CN', languagePreference: 'zh-CN' }),
    subscribe: () => () => {},
    queryAudit: vi.fn().mockResolvedValue({ items: [], total: 0, dayCounts: {} }),
  });
  const entry: AuditEntry = {
    id: 'legacy-failure',
    timestamp: '2026-10-28T12:00:00Z',
    source: 'system',
    operation: 'plugin.runtime.start',
    outcome: 'failed',
    summary: '工作搭子启动失败：Cannot find module workmate-service',
  };
  render(
    <SeedI18nProvider>
      <ActivityPage entries={[entry]} appName="Seed" />
    </SeedI18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '展开活动' }));
  expect(screen.getByText('原始摘要')).toBeTruthy();
  expect(screen.getByText(entry.summary)).toBeTruthy();
});
