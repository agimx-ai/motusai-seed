import { Check, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PluginConfigurationOption, PluginConfigurationState, QueryPluginConfigurationOptionsInput, UpdatePluginConfigurationInput } from '../../../shared/contracts'
import { resolveSeedLocalizedText, type SeedPluginConfiguration } from '../../../shared/plugin-manifest'
import { ActionButton } from '../../components/ActionButton'
import { ConfigurationOptionLabel } from '../../components/ConfigurationOptionLabel'
import { useSeedI18n } from '../../i18n'
import { cx } from '../../lib/display'

type Profile = Record<string, string> & { id: string }

type Props = {
  pluginId: string
  configuration: SeedPluginConfiguration
  state: PluginConfigurationState
  busy: boolean
  embedded?: boolean
  onSave(input: UpdatePluginConfigurationInput): Promise<void>
  onQueryOptions(input: QueryPluginConfigurationOptionsInput): Promise<PluginConfigurationOption[]>
}

type OptionListProps = Props & { selectable?: boolean }

function savedProfile(state: PluginConfigurationState): Profile | undefined {
  try {
    const profiles = JSON.parse(state.values.profiles || '[]') as unknown
    if (!Array.isArray(profiles)) return undefined
    return profiles.find((profile): profile is Profile => Boolean(
      profile && typeof profile === 'object' && !Array.isArray(profile) && 'id' in profile,
    ))
  } catch {
    return undefined
  }
}

function PluginConfigurationDynamicList({ pluginId, configuration, state, busy, embedded = false, onSave, onQueryOptions, selectable = true }: OptionListProps) {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  const field = configuration.profiles.fields[0]!
  const profile = useMemo(() => savedProfile(state), [state.values.profiles])
  const selectedValue = selectable ? profile?.[field.key] || '' : ''
  const queryValues = useMemo(() => selectable ? profile || {} : {}, [profile, selectable])
  const [pendingValue, setPendingValue] = useState('')
  const [refreshRevision, setRefreshRevision] = useState(0)
  const [request, setRequest] = useState<{ options: PluginConfigurationOption[]; loading: boolean; error: string }>({
    options: [], loading: true, error: '',
  })
  const requestRevision = useRef(0)

  useEffect(() => {
    const revision = requestRevision.current + 1
    requestRevision.current = revision
    setRequest({ options: [], loading: true, error: '' })
    void onQueryOptions({
      pluginId,
      configurationId: configuration.id,
      fieldKey: field.key,
      values: queryValues,
    }).then((options) => {
      if (requestRevision.current === revision) setRequest({ options, loading: false, error: '' })
    }).catch((reason) => {
      if (requestRevision.current === revision) setRequest({
        options: [],
        loading: false,
        error: reason instanceof Error ? reason.message : String(reason),
      })
    })
  }, [configuration.id, field.key, onQueryOptions, pluginId, queryValues, refreshRevision])

  useEffect(() => {
    if (pendingValue && pendingValue === selectedValue) setPendingValue('')
  }, [pendingValue, selectedValue])

  const select = async (option: PluginConfigurationOption) => {
    if (busy || pendingValue || option.value === selectedValue) return
    const profileId = profile?.id || `${configuration.profiles.idPrefix}-default`
    setPendingValue(option.value)
    try {
      await onSave({
        pluginId,
        configurationId: configuration.id,
        values: {
          ...state.values,
          profiles: JSON.stringify([{ ...(profile || {}), id: profileId, [field.key]: option.value }]),
          default_profile_id: profileId,
        },
      })
    } catch {
      setPendingValue('')
    }
  }

  const activeValue = pendingValue || selectedValue
  const selectedLabel = configuration.profiles.actions.setDefault
    ? resolveSeedLocalizedText(configuration.profiles.actions.setDefault.selectedLabel, locale)
    : ''

  return <section className={embedded ? undefined : 'mt-8'}>
    {!embedded && <div className="sticky top-[96px] z-[8] bg-background">
      <h3 className="m-0 text-[17px] font-medium">{resolveSeedLocalizedText(configuration.title, locale)}</h3>
      <p className="mb-0 mt-1 text-[12px] leading-5 text-muted-foreground">{resolveSeedLocalizedText(configuration.description, locale)}</p>
    </div>}
    {request.loading ? <div className="flex min-h-16 items-center justify-center gap-2 text-[12px] text-muted-foreground">
      <LoaderCircle className="animate-spin" size={14} aria-hidden="true" />
      <span>{t('plugins.optionListLoading')}</span>
    </div> : request.error ? <div className="flex min-h-16 items-center justify-between gap-3 rounded-[14px] border border-border px-4 py-3">
      <span className="min-w-0 text-[12px] text-danger">{request.error || t('plugins.optionListUnavailable')}</span>
      <ActionButton type="button" icon={<RefreshCw size={14} />} onClick={() => setRefreshRevision((value) => value + 1)}>{t('plugins.optionListRefresh')}</ActionButton>
    </div> : request.options.length === 0 ? <div className="rounded-[14px] border border-border px-4 py-5 text-center text-[12px] text-muted-foreground">
      {t('plugins.optionListEmpty')}
    </div> : <div className="overflow-hidden rounded-[14px] border border-border bg-card/60" role={selectable ? 'radiogroup' : 'list'} aria-label={resolveSeedLocalizedText(configuration.title, locale)}>
      {request.options.map((option, index) => {
        const selected = option.value === activeValue
        const pending = option.value === pendingValue
        const rowClassName = cx(
          'flex min-h-12 w-full items-center gap-3 px-4 text-left',
          index > 0 && 'border-t border-border/70',
          selectable && 'outline-none transition-colors hover:bg-muted focus-visible:bg-muted',
          selected && 'bg-muted/70',
        )
        const content = <>
          <ConfigurationOptionLabel option={option} className="min-w-0 flex-1 text-[13px] text-foreground" />
          {pending ? <LoaderCircle className="shrink-0 animate-spin text-muted-foreground" size={14} aria-hidden="true" />
            : selected ? <span className="flex shrink-0 items-center gap-1 rounded-[8px] bg-card px-2 py-1 text-[11px] text-muted-foreground">
              <Check size={12} aria-hidden="true" />
              {selectedLabel}
            </span> : null}
        </>
        if (!selectable) return <div className={rowClassName} key={option.value} role="listitem">{content}</div>
        return <button
          type="button"
          className={rowClassName}
          role="radio"
          aria-checked={selected}
          disabled={busy || Boolean(pendingValue)}
          key={option.value}
          onClick={() => void select(option)}
        >{content}</button>
      })}
    </div>}
  </section>
}

export function PluginConfigurationOptionList(props: Props) {
  return <PluginConfigurationDynamicList {...props} />
}

export function PluginConfigurationCatalogList(props: Props) {
  return <PluginConfigurationDynamicList {...props} selectable={false} />
}
