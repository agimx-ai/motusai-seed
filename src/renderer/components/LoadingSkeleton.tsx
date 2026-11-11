import type { ReactNode } from 'react';

export function LoadingSkeleton({ label, contentClassName, children }: {
  label: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-label={label} className="animate-pulse seed-reduced-motion:animate-none">
      <div className={contentClassName} aria-hidden="true">{children}</div>
    </div>
  );
}
