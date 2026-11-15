export type View = 'overview' | 'plugins' | 'activity' | 'experience-tips' | 'settings' | 'usage' | 'plugin-settings' | 'plugin-view';

export type SettingsView = Extract<View, 'settings' | 'usage' | 'plugin-settings'>;

export function isSettingsView(view: View): view is SettingsView {
  return view === 'settings' || view === 'usage' || view === 'plugin-settings';
}

export { cx } from '@motus-ai/seed-sdk/react';

export function timeAgo(value: string | undefined, locale: string, emptyLabel = '') {
  if (!value) return emptyLabel;
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds < 60) return formatter.format(0, 'second');
  if (seconds < 3600) return formatter.format(-Math.floor(seconds / 60), 'minute');
  if (seconds < 86400) return formatter.format(-Math.floor(seconds / 3600), 'hour');
  return new Date(value).toLocaleDateString(locale);
}

export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return Array.from(words[0] || 'S')
    .slice(0, 1)
    .join('')
    .toUpperCase();
}

export function formatPublicationDate(value: string, locale: string) {
  const date = new Date(value);
  const now = new Date(Date.now());
  const elapsed = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  const minute = 60;
  const hour = 60 * minute;
  const day = 24 * hour;
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });

  if (elapsed < minute) return relative.format(-Math.max(1, elapsed), 'second');
  if (elapsed < hour) return relative.format(-Math.floor(elapsed / minute), 'minute');
  if (elapsed < day) return relative.format(-Math.floor(elapsed / hour), 'hour');
  if (elapsed < 7 * day) return relative.format(-Math.floor(elapsed / day), 'day');
  if (elapsed < 30 * day) return relative.format(-Math.floor(elapsed / (7 * day)), 'week');
  if (elapsed < 90 * day) return relative.format(-Math.floor(elapsed / (30 * day)), 'month');

  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: now.getFullYear() === date.getFullYear() ? undefined : 'numeric',
  }).format(date);
}
