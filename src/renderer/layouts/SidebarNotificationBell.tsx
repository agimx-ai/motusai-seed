import { Tooltip } from '@motus-ai/seed-sdk/react';
import { Bell } from 'lucide-react';
import { animate, AnimatePresence, motion, useMotionValue } from 'motion/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { notificationCountColors } from '../components/NavigationCount';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import { cx } from '../lib/display';

const digitRoll = {
  enter: (direction: number) => ({ y: `${direction * 100}%` }),
  visible: { y: '0%' },
  exit: (direction: number) => ({ y: `${direction * -100}%` }),
};

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
  const reducedMotion = useReducedMotion();
  const swing = useMotionValue(0);
  const [badge, setBadge] = useState({ count, direction: 0 });

  useEffect(() => {
    if (count === badge.count) return;
    const direction = count > badge.count ? 1 : -1;
    setBadge({ count, direction });
    if (direction > 0 && !reducedMotion) {
      animate(swing, 0, { type: 'spring', stiffness: 250, damping: 13, velocity: -420 });
    }
  }, [badge.count, count, reducedMotion, swing]);

  useEffect(() => {
    if (reducedMotion) swing.jump(0);
    return () => swing.stop();
  }, [reducedMotion, swing]);

  const badgeCount = reducedMotion ? count : badge.count;
  const badgeText = badgeCount > 9 ? '9+' : String(badgeCount);
  const showNotifications = pluginUpdateCount > 0 || experienceTipCount === 0 ? onShowPluginUpdates : onShowExperienceTips;

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
        onClick={() => {
          if (!reducedMotion) {
            animate(swing, [swing.get(), -7, 0], { duration: 0.22, ease: 'easeInOut' });
          }
          showNotifications();
        }}
        aria-label={label}
      >
        <motion.span className="inline-flex" style={{ rotate: swing, transformOrigin: '50% 15%' }} aria-hidden="true">
          <Bell size={14} strokeWidth={1.8} />
        </motion.span>
        {badgeCount > 0 && (
          <span
            className={`absolute -right-0.5 -top-0.5 grid h-[10px] min-w-[10px] place-items-center rounded-full px-[2px] text-[7px] font-semibold leading-none ${notificationCountColors}`}
            aria-hidden="true"
          >
            {reducedMotion ? badgeText : (
              <span className="grid overflow-hidden text-center tabular-nums">
                <AnimatePresence custom={badge.direction} initial={badge.direction !== 0}>
                  <motion.span
                    key={badgeText}
                    className="col-start-1 row-start-1"
                    variants={digitRoll}
                    custom={badge.direction}
                    initial="enter"
                    animate="visible"
                    exit="exit"
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                  >
                    {badgeText}
                  </motion.span>
                </AnimatePresence>
              </span>
            )}
          </span>
        )}
      </button>
    </Tooltip>
  );
}
