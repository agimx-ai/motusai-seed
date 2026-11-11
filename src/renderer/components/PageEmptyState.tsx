import type { ReactNode } from 'react';

export function PageEmptyState({ title, description, role, action }: {
  title: string;
  description?: string;
  role?: 'alert';
  action?: ReactNode;
}) {
  return (
    <div role={role} className="grid min-h-[240px] flex-1 place-items-center px-6 py-10 text-center">
      <div className="max-w-[420px]">
        <strong className="block text-[14px] font-medium text-foreground">{title}</strong>
        {description && <p className="mb-0 mt-1.5 text-[12px] leading-5 text-muted-foreground">{description}</p>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}
