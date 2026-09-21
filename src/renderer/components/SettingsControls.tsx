import type { ReactNode } from 'react'

export function SettingsRow({ title, description, action }: { title: string; description: ReactNode; action?: ReactNode }) {
  return <div className="grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto] items-center gap-5 border-b border-border py-3.5 last:border-b-0">
    <div className="min-w-0">
      <strong className="block text-[13px] font-medium text-foreground">{title}</strong>
      <p className="mt-1 truncate text-[12px] text-muted-foreground">{description}</p>
    </div>
    {action}
  </div>
}
