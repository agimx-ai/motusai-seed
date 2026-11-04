import { Plus } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { toast } from '@motus-ai/seed-sdk';
import { pluginSidebar } from '../features/plugins/plugin-sidebar';
import { cx } from '../lib/display';
import { userFacingErrorMessage } from '../lib/errors';
import { SidebarEntryIcon } from './SidebarNavigation';

export function SidebarQuickActions({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const entries = useSyncExternalStore(pluginSidebar.subscribe, pluginSidebar.snapshot);
  const actions = entries.filter((entry) => entry.parent && 'host' in entry.parent && entry.parent.host === 'quick-actions');
  const available = !collapsed && actions.length > 0;
  const [open, setOpen] = useState(false);
  const shown = available && open;
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<'first' | 'last'>('first');
  const contains = useCallback((target: Node | null) => trigger.current?.contains(target) || menu.current?.contains(target), []);

  useEffect(() => {
    if (!available) setOpen(false);
  }, [available]);

  useLayoutEffect(() => {
    const anchor = trigger.current;
    const popup = menu.current;
    if (!shown || !anchor || !popup) return;

    const position = () => {
      const { left, bottom, width } = anchor.getBoundingClientRect();
      const menuWidth = popup.getBoundingClientRect().width;
      const center = left + width / 2;
      const menuLeft = Math.max(8, Math.min(center - menuWidth / 2, window.innerWidth - menuWidth - 8));
      popup.style.left = `${menuLeft}px`;
      popup.style.top = `${bottom + 9}px`;
      popup.style.setProperty('--quick-action-anchor', `${center - menuLeft - popup.clientLeft}px`);
    };
    position();
    const resize = new ResizeObserver(position);
    resize.observe(popup);
    window.addEventListener('resize', position);
    return () => {
      resize.disconnect();
      window.removeEventListener('resize', position);
    };
  }, [shown]);

  useEffect(() => {
    if (!shown) return;
    menu.current?.querySelector<HTMLButtonElement>(
      initialFocus.current === 'first' ? '[role="menuitem"]:first-child' : '[role="menuitem"]:last-child',
    )?.focus();
    const outside = (event: PointerEvent) => {
      if (!contains(event.target as Node)) setOpen(false);
    };
    const blur = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('blur', blur);
    };
  }, [shown, contains]);

  useEffect(() => {
    if (shown && !contains(document.activeElement))
      menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [shown, entries, contains]);

  if (!actions.length) return null;
  const label = t('nav.quickActions');
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const handleKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab' && shown) {
      close();
      return;
    }
    if (event.key === 'Escape' && shown) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    const arrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';
    if (!arrow && !(shown && (event.key === 'Home' || event.key === 'End'))) return;
    event.preventDefault();
    if (!shown) {
      initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first';
      setOpen(true);
      return;
    }
    const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Home' || (current < 0 && event.key === 'ArrowDown')) buttons[0]?.focus();
    else if (event.key === 'End' || current < 0) buttons.at(-1)?.focus();
    else buttons[(current + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  };

  return (
    <div
      className="shrink-0"
      onKeyDown={handleKeys}
      onBlur={(event) => {
        if (event.relatedTarget && !contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={shown}
        aria-controls={shown ? menuId : undefined}
        className={cx(
          'grid h-6 w-6 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--sidebar-item-active)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          shown && 'bg-[var(--sidebar-item-active)] text-foreground',
        )}
        onClick={() => {
          initialFocus.current = 'first';
          setOpen(!shown);
        }}
      >
        <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {shown && createPortal(
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          className="seed-account-menu fixed z-[80] w-max min-w-32 max-w-44 rounded-[12px] border p-1"
        >
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute -top-2 -translate-x-1/2"
            style={{ left: 'var(--quick-action-anchor)' }}
            width="16"
            height="8"
            viewBox="0 0 16 8"
          >
            <path d="M0.5 8 8 0.5 15.5 8Z" fill="var(--sidebar-menu-surface)" />
            <path d="M1.25 7.25 8 0.5 14.75 7.25" fill="none" stroke="var(--overlay-border)" />
          </svg>
          <div role="presentation" className="max-h-60 overflow-y-auto">
            {actions.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="menuitem"
                tabIndex={-1}
                title={entry.title}
                className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-foreground hover:bg-[var(--sidebar-item-active)] focus:bg-[var(--sidebar-item-active)] focus:outline-none"
                onClick={() => {
                  close();
                  try {
                    pluginSidebar.open(entry.key);
                  } catch (error) {
                    toast.error(userFacingErrorMessage(error));
                  }
                }}
              >
                <SidebarEntryIcon name={entry.icon} />
                <span className="truncate">{entry.title}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
