import { Blocks, ChevronDown, ChevronRight, Circle, History, Sprout, icons } from 'lucide-react';
import { ThemedIcon } from '@motus-ai/seed-sdk/react';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx, type View } from '../lib/display';
import { pluginSidebar, type PluginSidebarEntry } from '../features/plugins/plugin-sidebar';

export function SidebarEntryIcon({ name, sources }: { name?: string; sources?: PluginSidebarEntry['iconSources'] }) {
  if (sources) return <ThemedIcon iconDataUrl={sources.light} iconDarkDataUrl={sources.dark} className="h-[17px] w-[17px]" />;
  const key = name?.replace(/(^|-)([a-z])/g, (_match, _dash: string, letter: string) => letter.toUpperCase());
  const Icon = key ? (icons[key as keyof typeof icons] ?? Circle) : Circle;
  return <Icon size={17} strokeWidth={1.8} aria-hidden="true" className="shrink-0" />;
}

export function SidebarNavigation({
  view,
  selectedKey,
  onNavigate,
  onOpenPlugin,
}: {
  view: View;
  selectedKey?: string;
  onNavigate(view: View): void;
  onOpenPlugin(entry: PluginSidebarEntry): void;
}) {
  const { t } = useTranslation();
  const entries = useSyncExternalStore(pluginSidebar.subscribe, pluginSidebar.snapshot);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (view !== 'plugin-view' || !selectedKey) return;
    const ancestors = new Set<string>();
    let entry = entries.find((candidate) => candidate.key === selectedKey);
    while (entry?.parent) {
      const key = 'host' in entry.parent ? 'host:' + entry.parent.host : entry.pluginId + ':' + entry.parent.item;
      ancestors.add(key);
      entry = entries.find((candidate) => candidate.key === key);
    }
    setCollapsed((current) => new Set([...current].filter((key) => !ancestors.has(key))));
  }, [view, selectedKey, entries]);
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const node = (
    key: string,
    title: string,
    icon: ReactNode,
    active: boolean,
    children: readonly PluginSidebarEntry[],
    open?: () => void,
    badge?: number,
    depth = 0,
  ): ReactNode => {
    const expanded = !collapsed.has(key);
    return (
      <li key={key} className="min-w-0 list-none">
        <div
          className={cx(
            'flex min-w-0 items-center rounded-[10px] text-[14px] transition-colors',
            active
              ? 'bg-[var(--sidebar-item-active)] text-foreground'
              : 'text-muted-foreground hover:bg-[var(--sidebar-item-active)] hover:text-foreground',
          )}
        >
          <button
            type="button"
            className="flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={depth ? { paddingInlineStart: 12 + depth * 12 } : undefined}
            onClick={open ?? (() => toggle(key))}
            aria-current={active ? 'page' : undefined}
            aria-label={badge ? `${title}, ${badge}` : undefined}
            {...(!open ? { 'aria-expanded': expanded } : {})}
          >
            {icon}
            <span className="min-w-0 flex-1 truncate">
              {title}
            </span>
            {!!badge && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] tabular-nums">
                {' '}
                {badge > 99 ? '99+' : badge}
              </span>
            )}
            {!open && children.length > 0 && (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
          </button>
          {open && children.length > 0 && (
            <button
              type="button"
              className="mr-1 grid h-7 w-6 shrink-0 place-items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={t(expanded ? 'nav.collapseSection' : 'nav.expandSection', { name: title })}
              aria-expanded={expanded}
              onClick={() => toggle(key)}
            >
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          )}
        </div>
        {children.length > 0 && expanded && (
          <ul className="m-0 grid gap-0.5 py-0.5 pl-0">{children.map((child) => pluginNode(child, depth + 1))}</ul>
        )}
      </li>
    );
  };
  const pluginNode = (entry: PluginSidebarEntry, depth: number): ReactNode =>
    node(
      entry.key,
      entry.title,
      <SidebarEntryIcon name={entry.icon} sources={entry.iconSources} />,
      view === 'plugin-view' && entry.key === selectedKey,
      entries.filter(
        (child) =>
          child.pluginId === entry.pluginId && child.parent && 'item' in child.parent && child.parent.item === entry.id,
      ),
      entry.onSelect
        ? () => { pluginSidebar.open(entry.key); }
        : entry.view
        ? () => {
            onOpenPlugin(entry);
          }
        : undefined,
      entry.badge,
      depth,
    );
  const builtin = (id: 'overview' | 'plugins' | 'activity', icon: ReactNode) =>
    node(
      'host:' + id,
      t('nav.' + id),
      icon,
      view === id,
      entries.filter((entry) => entry.parent && 'host' in entry.parent && entry.parent.host === id),
      () => onNavigate(id),
    );
  return (
    <nav
      className="-mx-2 min-h-0 overflow-y-auto overscroll-contain px-0.5 pb-2 [&_svg.lucide-message-circle]:scale-95"
      aria-label={t('nav.mainNavigation')}
    >
      <ul className="m-0 grid gap-0.5 p-0">
        {builtin('overview', <Sprout size={17} strokeWidth={1.8} aria-hidden="true" />)}
        {builtin('plugins', <Blocks size={17} strokeWidth={1.8} aria-hidden="true" />)}
        {builtin('activity', <History size={17} strokeWidth={1.8} aria-hidden="true" />)}
        {entries.filter((entry) => !entry.parent).map((entry) => pluginNode(entry, 0))}
      </ul>
    </nav>
  );
}
