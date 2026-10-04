import { ResourceCard, resourceCardGridClass } from '../../components/ResourceCard'

export function PluginListSkeleton({ installed = false, label }: { installed?: boolean; label: string }) {
  return <div role="status" aria-label={label} className="animate-pulse motion-reduce:animate-none">
    {installed ? <div className="flex min-h-[52px] flex-wrap items-center gap-3 px-2 py-2" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => <span className="block h-9 w-9 rounded-[10px] bg-border" key={index} />)}
    </div> : <div className={resourceCardGridClass()} aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => <ResourceCard
        key={index}
        icon={<span className="block h-9 w-9 rounded-[10px] bg-border" />}
        title={<span className={`my-0.5 block h-3.5 max-w-full rounded bg-border ${index % 2 ? 'w-24' : 'w-28'}`} />}
        description={<span className="my-1 block h-2.5 w-4/5 rounded bg-border/70" />}
        trailing={<span className="block h-7 w-16 rounded-full bg-border/70" />}
      />)}
    </div>}
  </div>
}
