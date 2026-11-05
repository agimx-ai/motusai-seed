import type { PluginSettingsTarget, PluginSidebarRoute } from '../features/plugins/plugin-sidebar';
import type { View } from './display';

export type AppPage = (
  | { view: 'plugin-view'; pluginRoute: PluginSidebarRoute }
  | { view: 'plugins'; pluginId?: string; settingsTarget?: PluginSettingsTarget }
  | { view: Exclude<View, 'plugin-view' | 'plugins'> }
) & { query?: string };

type History = { pages: AppPage[]; index: number };

export const initialHistory: History = { pages: [{ view: 'overview' }], index: 0 };

type HistoryAction =
  | { type: 'open'; page: AppPage }
  | { type: 'step'; direction: -1 | 1; available: (page: AppPage) => boolean }
  | { type: 'search'; query: string }
  | { type: 'remove'; matches: (page: AppPage) => boolean }
  | { type: 'reset' };

export function historyNeighbor({ pages, index }: History, direction: -1 | 1, available: (page: AppPage) => boolean) {
  const current = pages[index]!;
  for (let i = index + direction; i >= 0 && i < pages.length; i += direction) {
    const candidate = pages[i]!;
    if (available(candidate) && !samePage(current, candidate)) return i;
  }
  return index;
}

function samePage(current: AppPage, next: AppPage) {
  if (current.view !== next.view || (current.query ?? '') !== (next.query ?? '')) return false;
  if (current.view === 'plugins' && next.view === 'plugins') {
    return current.pluginId === next.pluginId && current.settingsTarget === next.settingsTarget;
  }
  if (current.view === 'plugin-view' && next.view === 'plugin-view') {
    return current.pluginRoute.key === next.pluginRoute.key && current.pluginRoute.view === next.pluginRoute.view
      && current.pluginRoute.params === next.pluginRoute.params;
  }
  return true;
}

export function navigationHistory(history: History, action: HistoryAction): History {
  const { pages, index } = history;
  const current = pages[index]!;
  switch (action.type) {
    case 'open': {
      const next = { ...action.page, query: action.page.query ?? current.query };
      if (samePage(current, next)) return history;
      const nextPages = [...pages.slice(Math.max(0, index - 98), index + 1), next];
      return { pages: nextPages, index: nextPages.length - 1 };
    }
    case 'step': {
      const next = historyNeighbor(history, action.direction, action.available);
      return next === index ? history : { pages, index: next };
    }
    case 'search':
      if (current.view !== 'plugins' || current.query === action.query) return history;
      return { index, pages: pages.map((page, i) => i === index ? { ...page, query: action.query } : page) };
    case 'remove': {
      if (!pages.some(action.matches)) return history;
      const before = pages.slice(0, index).filter((page) => !action.matches(page));
      const active = action.matches(current) ? { view: 'overview' as const, query: current.query } : current;
      return { pages: [...before, active, ...pages.slice(index + 1).filter((page) => !action.matches(page))], index: before.length };
    }
    case 'reset':
      return initialHistory;
  }
}
