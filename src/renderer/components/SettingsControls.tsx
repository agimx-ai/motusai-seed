import type { ReactNode } from 'react'

export function SettingsRow({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  const hasDescription = description != null
  return <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-5 border-b border-border last:border-b-0 ${hasDescription ? 'min-h-[72px] py-3.5' : 'min-h-[52px] py-2.5'}`}>
    <div className="min-w-0">
      <strong className="block text-[13px] font-medium text-foreground">{title}</strong>
      {hasDescription && <p className="mt-1 truncate text-[12px] text-muted-foreground">{description}</p>}
    </div>
    {action}
  </div>
}
