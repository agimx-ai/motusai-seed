// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AuditEntry } from '../../shared/contracts';
import { SeedI18nProvider } from '../i18n';
import { ActivityPage } from './ActivityPage';

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
