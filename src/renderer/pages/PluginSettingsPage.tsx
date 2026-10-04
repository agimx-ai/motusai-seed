import type { SeedCatalogPlugin } from '../../shared/contracts'
import { PluginDataResetSetting } from '../features/plugins/PluginDataResetSetting'

export function PluginSettingsPage({ catalog, busy, onListOrphanedPluginData, onResetOrphanedPluginData }: {
  catalog: SeedCatalogPlugin[]
  busy: boolean
  onListOrphanedPluginData: () => Promise<string[] | undefined>
  onResetOrphanedPluginData: (ids: string[]) => Promise<boolean>
}) {
  return <section className="mx-auto w-full max-w-[730px] pt-7 animate-[rise_.25s_ease_both]">
    <div className="rounded-[14px] border border-border bg-card px-5">
      <PluginDataResetSetting catalog={catalog} disabled={busy} onList={onListOrphanedPluginData} onReset={onResetOrphanedPluginData} />
    </div>
  </section>
}
