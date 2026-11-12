export const notificationCountColors = 'bg-info text-white';

export function NavigationCount({ children, notification = false }: { children: number | string; notification?: boolean }) {
  return (
    <span className={`shrink-0 rounded-full px-1.5 text-[11px] tabular-nums ${notification ? notificationCountColors : 'bg-muted'}`}>
      {children}
    </span>
  );
}
