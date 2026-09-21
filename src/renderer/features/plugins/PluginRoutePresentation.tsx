import { Bot, Cloud, File, FolderOpen, Laptop, Server, ShieldCheck, type LucideIcon } from 'lucide-react'
import type { SeedPluginDetailPresentation } from '../../../shared/plugin-manifest'

type RouteIcon = SeedPluginDetailPresentation['nodes'][number]['icon']

const icons: Record<RouteIcon, LucideIcon> = {
  agent: Bot,
  cloud: Cloud,
  device: Laptop,
  file: File,
  folder: FolderOpen,
  server: Server,
  shield: ShieldCheck,
}

export type PluginRouteNode = {
  icon: RouteIcon
  title: string
  description: string
  muted?: boolean
}

export function PluginRoutePresentation({ nodes, summary, className = 'mt-3' }: {
  nodes: PluginRouteNode[]
  summary: string
  className?: string
}) {
  return <section className={`${className} rounded-[16px] border border-border bg-muted/15 px-5 py-5`}>
    <div className="relative flex items-stretch justify-between gap-8 max-[700px]:flex-col">
      <div className="absolute left-[15%] right-[15%] top-1/2 hidden border-t-2 border-dashed border-border min-[701px]:block" aria-hidden="true" />
      {nodes.map((node, index) => {
        const Icon = icons[node.icon]
        return <div className={`relative z-[1] flex min-h-[74px] w-[170px] min-w-0 flex-none flex-col items-center justify-center rounded-[14px] border bg-card px-3 py-2.5 text-center transition-opacity max-[700px]:w-full ${node.muted ? 'border-dashed border-border/70 opacity-45' : 'border-border'}`} key={`${node.icon}:${index}`}>
          <Icon className="mb-1.5 text-muted-foreground" size={18} strokeWidth={1.7} aria-hidden="true" />
          <strong className="text-[13px] font-medium text-foreground">{node.title}</strong>
          <span className="mt-1 text-[11px] leading-4 text-muted-foreground">{node.description}</span>
        </div>
      })}
    </div>
    <p className="mb-0 mt-4 text-[12px] leading-5 text-muted-foreground">{summary}</p>
  </section>
}
