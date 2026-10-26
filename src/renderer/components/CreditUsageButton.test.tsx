// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SeedI18nProvider } from '../i18n';
import { CreditUsageButton } from './CreditUsageButton';

afterEach(cleanup);

async function fixture(available: number | null, total: number | null, locale = 'zh-CN') {
  window.motusSeed = {
    snapshot: async () => ({ locale, languagePreference: locale }),
    subscribe: () => () => {},
  } as any;
  const onClick = vi.fn();
  render(
    <SeedI18nProvider>
      <CreditUsageButton available={available} total={total} onClick={onClick} />
    </SeedI18nProvider>,
  );
  await screen.findByRole('button', { name: locale === 'en-US' ? /Credit usage/ : /积分用量/ });
  return onClick;
}

describe('credit usage shortcut', () => {
  it('shows only the remaining percentage and opens existing usage details', async () => {
    const onClick = await fixture(75, 100);
    const button = screen.getByRole('button', { name: '积分用量 · 剩余：75%' });
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('75');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('keeps two decimal places for the remaining percentage', async () => {
    await fixture(93.29, 100);
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('积分用量 · 剩余：93.29%');
  });

  it.each([
    [100, 100, 100],
    [0, 100, 0],
    [0, 0, 0],
  ])('handles available=%s and total=%s without inventing consumption', async (available, total, percent) => {
    await fixture(available, total);
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe(String(percent));
  });

  it('does not fabricate a percentage when totals are unavailable', async () => {
    await fixture(23.45, null);
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('积分用量 · 剩余比例暂不可用');
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it.each([100, 0])('shows an empty ring for an overdrawn wallet with allowance %s', async (total) => {
    await fixture(-10, total, 'en-US');
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('Remaining: 0%');
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('0');
  });

  it.each([
    [100, 'text-emerald-500'],
    [50, 'text-amber-500'],
    [20, 'text-red-500'],
    [0, 'text-red-500'],
  ])('uses a battery color for %s percent remaining', async (available, color) => {
    await fixture(available, 100);
    expect(screen.getByRole('meter').classList.contains(color)).toBe(true);
  });
});
