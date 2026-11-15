import { Tooltip } from '@motus-ai/seed-sdk/react';
import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { notificationCountColors } from '../components/NavigationCount';
import { cx } from '../lib/display';

export function SidebarNotificationBell({
  pluginUpdateCount,
  experienceTipCount = 0,
  onShowPluginUpdates,
  onShowExperienceTips,
}: {
  pluginUpdateCount: number;
  experienceTipCount?: number;
  onShowPluginUpdates: () => void;
  onShowExperienceTips: () => void;
}) {
  const { t } = useTranslation();
  const count = pluginUpdateCount + experienceTipCount;
  const label = count > 0 ? t('nav.notificationsCount', { count }) : t('nav.notifications');

  return (
    <Tooltip content={label}>
      <button
        className={cx(
          'relative grid h-6 w-6 shrink-0 place-items-center rounded-lg transition-colors focus-visible:outline-none',
          count > 0
            ? 'bg-info-soft text-info hover:bg-info-hover'
            : 'text-muted-foreground hover:bg-[var(--sidebar-item-active)] hover:text-foreground',
        )}
        type="button"
        onClick={pluginUpdateCount > 0 || experienceTipCount === 0 ? onShowPluginUpdates : onShowExperienceTips}
        aria-label={label}
      >
        <Bell size={14} strokeWidth={1.8} aria-hidden="true" />
        {count > 0 && (
          <span
            className={`absolute -right-0.5 -top-0.5 grid h-[10px] min-w-[10px] place-items-center rounded-full px-[2px] text-[7px] font-semibold leading-none ${notificationCountColors}`}
            aria-hidden="true"
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
    </Tooltip>
  );
}
