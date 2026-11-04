import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from '../lib/display';

export const HeaderActionButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function HeaderActionButton({ className, type = 'button', ...props }, ref) {
    const isWindows = window.motusWindow.platform === 'win32';
    return <button ref={ref} type={type} className={cx(
      'grid place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground [-webkit-app-region:no-drag]',
      isWindows ? 'h-8 w-8' : 'h-9 w-9', className,
    )} {...props} />;
  },
);
