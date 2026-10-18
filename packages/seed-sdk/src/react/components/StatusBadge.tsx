import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils';

const tones = {
  neutral: 'border-border bg-muted/40 text-muted-foreground',
  info: 'border-info/25 bg-info-soft text-info',
  success: 'border-success/30 bg-success-soft text-success',
  warning: 'border-warning/25 bg-warning-soft text-warning',
  danger: 'border-danger/25 bg-danger-soft text-danger',
};

/** Presentation only: the caller owns the state labels and optional action. */
export function StatusBadge({
  tone = 'neutral',
  children,
  className,
  onClick,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> & {
  tone?: keyof typeof tones;
  children: ReactNode;
}) {
  const classes = cx(
    'inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-[11px] font-medium leading-none',
    tones[tone],
    onClick &&
      'cursor-pointer outline-none transition-[filter] hover:brightness-[0.97] focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50',
    className,
  );
  return onClick ? (
    <button type="button" className={classes} onClick={onClick} {...props}>
      {children}
    </button>
  ) : (
    <span className={classes} title={props.title} aria-label={props['aria-label']}>
      {children}
    </span>
  );
}
