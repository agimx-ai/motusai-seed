import { useEffect, useMemo, useState } from 'react'
import type { PluginConfigurationOption, PluginConfigurationProfileStatus, PluginConfigurationState, QueryPluginConfigurationOptionsInput, QueryPluginConfigurationProfileStatusesInput, ReconnectPluginConfigurationProfileInput, UpdatePluginConfigurationInput } from '../../../shared/contracts'
import { resolveSeedLocalizedText, type SeedPluginConfiguration } from '../../../shared/plugin-manifest'
import { SegmentedControl } from '../../components/SegmentedControl'
import { useSeedI18n } from '../../i18n'
import { PluginConfigurationPanel } from './PluginConfigurationPanel'
import { PluginConfigurationCatalogList, PluginConfigurationOptionList } from './PluginConfigurationOptionList'
import { PluginRoutePresentation } from './PluginRoutePresentation'

type Source = {
  configuration: SeedPluginConfiguration
  state: PluginConfigurationState
}

type Props = {
  pluginId: string
  sources: Source[]
  pluginNames: ReadonlyMap<string, string>
  busy: boolean
  onSave(input: UpdatePluginConfigurationInput): Promise<void>
  onQueryOptions(input: QueryPluginConfigurationOptionsInput): Promise<PluginConfigurationOption[]>
  onQueryProfileStatuses(input: QueryPluginConfigurationProfileStatusesInput): Promise<PluginConfigurationProfileStatus[]>
  onReconnectProfile(input: ReconnectPluginConfigurationProfileInput): Promise<void>
}

function profileIds(state: PluginConfigurationState) {
  try {
    const profiles = JSON.parse(state.values.profiles || '[]') as unknown
    if (!Array.isArray(profiles)) return []
    return profiles.flatMap((profile) => profile && typeof profile === 'object' && !Array.isArray(profile) && 'id' in profile
      ? [String((profile as { id?: unknown }).id || '')].filter(Boolean)
      : [])
  } catch {
    return []
  }
}

function SourceRoute({ source }: { source: Source }) {
  const { locale } = useSeedI18n()
  const presentation = source.configuration.sourcePresentation!
  const direct = presentation.mode !== 'relay'
  return <PluginRoutePresentation
    className="mt-4"
    nodes={[
      { icon: 'device', title: resolveSeedLocalizedText(presentation.origin.title, locale), description: resolveSeedLocalizedText(presentation.origin.description, locale) },
      { icon: 'cloud', muted: direct, title: resolveSeedLocalizedText(presentation.relay.title, locale), description: resolveSeedLocalizedText(presentation.relay.description, locale) },
      { icon: 'server', title: resolveSeedLocalizedText(presentation.destination.title, locale), description: resolveSeedLocalizedText(presentation.destination.description, locale) },
    ]}
    summary={resolveSeedLocalizedText(presentation.summary, locale)}
  />
}

export function PluginConfigurationSourceGroup({ pluginId, sources, pluginNames, busy, onSave, onQueryOptions, onQueryProfileStatuses, onReconnectProfile }: Props) {
  const { locale } = useSeedI18n()
  const displayOnly = sources.some(({ configuration }) => configuration.renderer === 'seed.catalog-list')
  const defaultSourceId = (displayOnly ? undefined : sources.find(({ state }) => Boolean(state.values.default_profile_id))?.configuration.id)
    || sources[0]?.configuration.id || ''
  const [activeSourceId, setActiveSourceId] = useState(defaultSourceId)
  useEffect(() => { setActiveSourceId(defaultSourceId) }, [defaultSourceId])
  const activeSource = sources.find(({ configuration }) => configuration.id === activeSourceId) || sources[0]
  const options = useMemo(() => sources.map(({ configuration }) => ({
    value: configuration.id,
    label: resolveSeedLocalizedText(configuration.title, locale),
  })), [locale, sources])

  if (!activeSource) return null
  const selectSource = (configurationId: string) => {
    setActiveSourceId(configurationId)
    if (displayOnly) return
    const source = sources.find(({ configuration }) => configuration.id === configurationId)
    if (!source || busy) return
    const ids = profileIds(source.state)
    const defaultId = ids.includes(source.state.values.default_profile_id)
      ? source.state.values.default_profile_id
      : ids[0] || ''
    if (!defaultId) return
    void onSave({
      pluginId,
      configurationId,
      values: { ...source.state.values, default_profile_id: defaultId },
    })
  }

  return <section className="mt-3">
    <SegmentedControl
      value={activeSource.configuration.id}
      options={options}
      onValueChange={selectSource}
      label={resolveSeedLocalizedText(activeSource.configuration.title, locale)}
    />
    <SourceRoute source={activeSource} />
    <div className="mt-4">
      {activeSource.configuration.renderer === 'seed.option-list' ? <PluginConfigurationOptionList
        embedded
        pluginId={pluginId}
        configuration={activeSource.configuration}
        state={activeSource.state}
        busy={busy}
        onSave={onSave}
        onQueryOptions={onQueryOptions}
      /> : activeSource.configuration.renderer === 'seed.catalog-list' ? <PluginConfigurationCatalogList
        embedded
        pluginId={pluginId}
        configuration={activeSource.configuration}
        state={activeSource.state}
        busy={busy}
        onSave={onSave}
        onQueryOptions={onQueryOptions}
      /> : <PluginConfigurationPanel
        embedded
        hideDefaultControls
        preferDefaultOnSave={!displayOnly}
        pluginId={pluginId}
        configuration={activeSource.configuration}
        state={activeSource.state}
        pluginNames={pluginNames}
        busy={busy}
        onSave={onSave}
        onQueryOptions={onQueryOptions}
        onQueryProfileStatuses={onQueryProfileStatuses}
        onReconnectProfile={onReconnectProfile}
      />}
    </div>
  </section>
}
