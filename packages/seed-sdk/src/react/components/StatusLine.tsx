import type { ReactNode } from 'react';
import { cx } from '../utils';

/** A passive status row. State meaning, actions and labels belong to the caller. */
export function StatusLine({
  children,
  actions,
  tone = 'neutral',
  pending = false,
}: {
  children: ReactNode;
  actions?: ReactNode;
  tone?: 'neutral' | 'success' | 'info' | 'danger';
  pending?: boolean;
}) {
  return (
    <div role="status" className="flex min-h-6 items-center gap-3 py-2 first:pt-0 last:pb-0">
      <span
        aria-hidden="true"
        className={cx(
          'h-2.5 w-2.5 shrink-0 rounded-full',
          {
            neutral: 'bg-muted-foreground/55',
            success: 'bg-[var(--seed-success)]',
            info: 'bg-info',
            danger: 'bg-danger',
          }[tone],
          pending && 'animate-pulse',
        )}
      />
      <span className="text-[13px]">{children}</span>
      {actions && <span className="ml-auto">{actions}</span>}
    </div>
  );
}
