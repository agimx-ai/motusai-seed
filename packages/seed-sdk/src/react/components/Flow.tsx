import type { ReactNode } from 'react';

/** Pure layout components. Plugins compose JSX and can supply any icon or step content. */
export function Flow({
  children,
  summary,
  className = 'mt-3',
}: {
  children: ReactNode;
  summary: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${className} rounded-[16px] border border-border bg-muted/15 px-5 py-5`}>
      <div className="relative flex items-stretch justify-between gap-8 max-[700px]:flex-col">
        <div
          className="absolute left-[15%] right-[15%] top-1/2 hidden border-t-2 border-dashed border-border min-[701px]:block"
          aria-hidden="true"
        />
        {children}
      </div>
      <p className="mb-0 mt-4 text-[12px] leading-5 text-muted-foreground">{summary}</p>
    </section>
  );
}

export function FlowStep({
  icon,
  title,
  children,
  muted = false,
}: {
  icon: ReactNode;
  title: ReactNode;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      className={`relative z-[1] flex min-h-[74px] w-[170px] min-w-0 flex-none flex-col items-center justify-center rounded-[14px] border bg-card px-3 py-2.5 text-center transition-opacity max-[700px]:w-full ${muted ? 'border-dashed border-border/70 opacity-45' : 'border-border'}`}
    >
      <span className="mb-1.5 text-muted-foreground" aria-hidden="true">
        {icon}
      </span>
      <strong className="text-[13px] font-medium text-foreground">{title}</strong>
      <span className="mt-1 text-[11px] leading-4 text-muted-foreground">{children}</span>
    </div>
  );
}
