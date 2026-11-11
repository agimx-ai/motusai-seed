import { RotateCw } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from '../lib/display';

export const HeaderActionButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { compact?: boolean }>(
  function HeaderActionButton({ className, type = 'button', compact = false, ...props }, ref) {
    const isWindows = window.motusWindow.platform === 'win32';
    return <button ref={ref} type={type} className={cx(
      'grid place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground [-webkit-app-region:no-drag]',
      compact ? 'h-7 w-7' : isWindows ? 'h-8 w-8' : 'h-9 w-9', className,
    )} {...props} />;
  },
);

export function HeaderRefreshButton({ label, refreshing, onClick }: {
  label: string;
  refreshing: boolean;
  onClick: () => void;
}) {
  return (
    <HeaderActionButton aria-label={label} disabled={refreshing} onClick={onClick}>
      <RotateCw size={18} className={refreshing ? 'seed-full-motion:animate-spin' : undefined} aria-hidden="true" />
    </HeaderActionButton>
  );
}
