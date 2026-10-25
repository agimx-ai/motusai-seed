import { useTranslation } from 'react-i18next';
import { Tooltip } from '@motus-ai/seed-sdk/react';

export function CreditUsageButton({
  available,
  total,
  onClick,
}: {
  available: number | null;
  total: number | null;
  onClick: () => void;
}) {
  const { t, i18n } = useTranslation();
  const known = available !== null && total !== null && total >= 0 && total >= available;
  const remainingRatio = known ? (total > 0 ? Math.max(0, available / total) : 0) : null;
  const number = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
  const percentage = new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 2 });
  const remaining =
    remainingRatio === null
      ? t('nav.creditUsageUnavailable')
      : t('nav.creditRemainingPercent', { percent: percentage.format(remainingRatio) });
  const creditTotal = t('nav.creditTotal', { count: total === null ? '—' : number.format(total) });
  const label = `${t('nav.creditUsage')} · ${remaining} · ${creditTotal}`;
  const progress = remainingRatio === null ? null : Math.max(0, Math.min(1, remainingRatio)) * 100;
  const color =
    progress === null
      ? 'text-muted-foreground'
      : progress > 50
        ? 'text-emerald-500'
        : progress > 20
          ? 'text-amber-500'
          : 'text-red-500';

  return (
    <Tooltip
      content={
        <div className="grid gap-1">
          <span>{remaining}</span>
          <span>{creditTotal}</span>
        </div>
      }
    >
      <button
        className="grid h-8 w-8 place-items-center rounded-[10px] text-muted-foreground transition-colors hover:bg-[var(--sidebar-item-active)] hover:text-foreground focus-visible:bg-[var(--sidebar-item-active)] focus-visible:text-foreground focus-visible:outline-none"
        type="button"
        onClick={onClick}
        aria-label={label}
      >
        <span
          className={`grid size-5 place-items-center ${color}`}
          role={progress === null ? undefined : 'meter'}
          aria-label={progress === null ? undefined : t('nav.creditUsage')}
          aria-valuemin={progress === null ? undefined : 0}
          aria-valuemax={progress === null ? undefined : 100}
          aria-valuenow={progress === null ? undefined : progress}
          aria-valuetext={progress === null ? undefined : remaining}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle
              className="text-muted-foreground"
              cx="12"
              cy="12"
              r="11"
              stroke="currentColor"
              strokeWidth="2"
              opacity="0.3"
            />
            {progress !== null && progress > 0 && (
              <circle
                cx="12"
                cy="12"
                r="11"
                pathLength="100"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="100"
                strokeDashoffset={100 - progress}
                transform="rotate(-90 12 12)"
              />
            )}
            <path
              className="text-muted-foreground"
              d="M12 6.5 17.5 12 12 17.5 6.5 12Z"
              fill="currentColor"
              opacity="0.55"
            />
          </svg>
        </span>
      </button>
    </Tooltip>
  );
}
