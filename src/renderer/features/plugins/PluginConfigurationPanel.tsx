import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LoaderCircle, Plus, Save, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PluginConfigurationOption, PluginConfigurationProfileStatus, PluginConfigurationState, QueryPluginConfigurationOptionsInput, QueryPluginConfigurationProfileStatusesInput, ReconnectPluginConfigurationProfileInput, UpdatePluginConfigurationInput } from '../../../shared/contracts'
import { resolveSeedLocalizedText, type SeedPluginConfiguration } from '../../../shared/plugin-manifest'
import { ActionButton } from '../../components/ActionButton'
import { AsyncCombobox } from '../../components/AsyncCombobox'
import { ConfigurationOptionLabel } from '../../components/ConfigurationOptionLabel'
import { DefaultProfileControl } from '../../components/DefaultProfileControl'
import { DisclosureControl } from '../../components/DisclosureControl'
import { FieldLabel } from '../../components/FieldLabel'
import { SelectControl } from '../../components/SelectControl'
import { TextAreaControl } from '../../components/TextAreaControl'
import { useSeedI18n } from '../../i18n'
import { configurationOptionDisplayLabel } from '../../lib/configuration-options'

type Props = {
  pluginId: string
  configuration: SeedPluginConfiguration
  state: PluginConfigurationState
  pluginNames: ReadonlyMap<string, string>
  busy: boolean
  embedded?: boolean
  hideDefaultControls?: boolean
  preferDefaultOnSave?: boolean
  onSave(input: UpdatePluginConfigurationInput): Promise<void>
  onQueryOptions(input: QueryPluginConfigurationOptionsInput): Promise<PluginConfigurationOption[]>
  onQueryProfileStatuses(input: QueryPluginConfigurationProfileStatusesInput): Promise<PluginConfigurationProfileStatus[]>
  onReconnectProfile(input: ReconnectPluginConfigurationProfileInput): Promise<void>
}
type Field = SeedPluginConfiguration['fields'][number]
type Profile = Record<string, string> & { id: string }

const configuredSecretMask = '••••••••••••••••••••••••'
const inputClass = 'h-9 rounded-[10px] border border-input bg-card px-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/35'
const fieldSpanClass: Record<Field['span'], string> = {
  small: 'flex-[0_1_calc(33.333%-0.5rem)] max-[760px]:flex-[1_1_100%]',
  default: 'flex-[1_1_calc(50%-0.375rem)] max-[760px]:flex-[1_1_100%]',
  full: 'flex-[1_1_100%]',
}

function defaultValue(field: Field) {
  return field.default ?? field.options?.[0]?.value ?? ''
}

function profileDefaults(configuration: SeedPluginConfiguration, source: Record<string, string> = {}) {
  const defaults = Object.fromEntries(configuration.profiles.fields.map((field) => [field.key, defaultValue(field)]))
  for (const field of configuration.profiles.fields) {
    if (field.type !== 'select') continue
    const selected = source[field.key] || defaults[field.key]
    Object.assign(defaults, field.options?.find((option) => option.value === selected)?.defaults || {})
  }
  return defaults
}

function profileValues(configuration: SeedPluginConfiguration, source: Profile) {
  const defaults = profileDefaults(configuration, source)
  const values = { ...defaults, ...source }
  for (const field of configuration.profiles.fields) {
    if (field.type === 'hidden') values[field.key] = defaults[field.key]
  }
  return values
}

function matches(values: Record<string, string>, condition?: Field['visibleWhen']) {
  if (!condition) return true
  return (Array.isArray(condition.equals) ? condition.equals : [condition.equals]).includes(values[condition.field] || '')
}

function updateFieldValue(fields: Field[], values: Record<string, string>, key: string, value: string, defaults: Record<string, string> = {}) {
  const next = { ...values, ...defaults, [key]: value }
  for (const field of fields) {
    if (field.key === key || !field.resetWhenChanged?.includes(key) || field.key in defaults) continue
    next[field.key] = field.type === 'secret' ? '' : defaultValue(field)
  }
  return next
}

function newProfile(configuration: SeedPluginConfiguration): Profile {
  return {
    ...profileDefaults(configuration),
    id: `${configuration.profiles.idPrefix}-${crypto.randomUUID()}`,
  }
}

function parseProfiles(configuration: SeedPluginConfiguration, state: PluginConfigurationState): Profile[] {
  try {
    const parsed = JSON.parse(state.values.profiles || '[]') as unknown
    if (Array.isArray(parsed)) return parsed
      .filter((value): value is Profile => Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'id' in value))
      .map((profile) => profileValues(configuration, profile))
  } catch { /* Invalid state is replaced with schema defaults. */ }
  return Array.from({ length: configuration.profiles.minItems }, () => newProfile(configuration))
}

function ConfiguredSecretInput({ configured, field, required, value, onChange }: { configured: boolean; field: Field; required: boolean; value: string; onChange(value: string): void }) {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (configured && !value) setEditing(false) }, [configured, value])
  return <input
    className={inputClass}
    type="text"
    required={required && !configured}
    maxLength={field.maxLength}
    value={configured && !editing && !value ? configuredSecretMask : value}
    placeholder={field.placeholder ? resolveSeedLocalizedText(field.placeholder, locale) : t('plugins.inputPlaceholder')}
    autoComplete="off"
    autoCapitalize="none"
    autoCorrect="off"
    spellCheck={false}
    onFocus={() => setEditing(true)}
    onBlur={() => { if (!value) setEditing(false) }}
    onChange={(event) => onChange(event.target.value)}
  />
}

function DynamicOptionsInput({ pluginId, configurationId, field, fields, values, required, dependencyConfigured, optionValueLabels, optionValueOptions, onChange, onQueryOptions }: {
  pluginId: string
  configurationId: string
  field: Field
  fields: Field[]
  values: Record<string, string>
  required: boolean
  dependencyConfigured(key: string): boolean
  optionValueLabels: ReadonlyMap<string, string>
  optionValueOptions?: ReadonlyMap<string, PluginConfigurationOption>
  onChange(value: string): void
  onQueryOptions(input: QueryPluginConfigurationOptionsInput): Promise<PluginConfigurationOption[]>
}) {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  const [requestState, setRequestState] = useState<{
    revision: string
    options: PluginConfigurationOption[]
    loading: boolean
    loaded: boolean
    error: string
  }>({ revision: '', options: [], loading: false, loaded: false, error: '' })
  const [refreshRevision, setRefreshRevision] = useState(0)
  const requestRevision = useRef(0)
  const dependencies = field.dynamicOptions?.dependsOn || []
  const requiredFields = field.dynamicOptions?.requiredFields || []
  const dependencyRevision = dependencies.map((key) => values[key] || '').join('\0')
  const currentRequest = requestState.revision === dependencyRevision
    ? requestState
    : { revision: dependencyRevision, options: [], loading: false, loaded: false, error: '' }
  const missingRequiredFields = requiredFields.filter((key) => !values[key] && !dependencyConfigured(key))
  const ready = missingRequiredFields.length === 0
  const dependencyMessage = t('plugins.dynamicOptionsDependenciesRequired', {
    fields: missingRequiredFields
      .map((key) => fields.find((candidate) => candidate.key === key))
      .filter((candidate): candidate is Field => Boolean(candidate))
      .map((candidate) => resolveSeedLocalizedText(candidate.label, locale))
      .join(locale.toLowerCase().startsWith('en') ? ', ' : '、'),
    target: resolveSeedLocalizedText(field.label, locale),
  })

  useEffect(() => {
    const revision = requestRevision.current + 1
    requestRevision.current = revision
    setRequestState({ revision: dependencyRevision, options: [], loading: false, loaded: false, error: '' })
    if (!ready) {
      return
    }
    const timer = window.setTimeout(() => {
      setRequestState({ revision: dependencyRevision, options: [], loading: true, loaded: false, error: '' })
      void onQueryOptions({ pluginId, configurationId, fieldKey: field.key, values })
        .then((nextOptions) => {
          if (requestRevision.current === revision) {
            setRequestState({ revision: dependencyRevision, options: nextOptions, loading: false, loaded: true, error: '' })
          }
        })
        .catch((reason) => {
          if (requestRevision.current === revision) setRequestState({
            revision: dependencyRevision,
            options: [],
            loading: false,
            loaded: true,
            error: reason instanceof Error ? reason.message : String(reason),
          })
        })
        .finally(() => {
          if (requestRevision.current === revision) setRequestState((current) => ({ ...current, loading: false }))
        })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [configurationId, dependencyRevision, field.key, onQueryOptions, pluginId, ready, refreshRevision])

  return <AsyncCombobox
    value={values[field.key] || ''}
    valueLabel={optionValueLabels.get(values[field.key] || '')}
    valueOption={optionValueOptions?.get(values[field.key] || '')}
    options={currentRequest.options}
    placeholder={field.placeholder ? resolveSeedLocalizedText(field.placeholder, locale) : t('plugins.inputPlaceholder')}
    label={resolveSeedLocalizedText(field.label, locale)}
    loading={currentRequest.loading}
    emptyMessage={t('plugins.dynamicOptionsEmpty')}
    unavailableMessage={ready ? t('plugins.dynamicOptionsUnavailable') : dependencyMessage}
    refreshLabel={t('plugins.refreshDynamicOptions')}
    error={currentRequest.error}
    unavailable={!ready}
    resolvingValueLabel={ready && Boolean(values[field.key]) && !optionValueLabels.has(values[field.key] || '') && !optionValueOptions?.has(values[field.key] || '') && !currentRequest.loaded}
    maxLength={field.maxLength}
    required={required}
    onChange={onChange}
    onRefresh={() => setRefreshRevision((revision) => revision + 1)}
  />
}

function FieldControl({ pluginId, configurationId, field, fields, values, configured, dependencyConfigured, optionValueLabels, optionValueOptions, onChange, onQueryOptions, bleedControl = false }: {
  pluginId: string
  configurationId: string
  field: Field
  fields: Field[]
  values: Record<string, string>
  configured: boolean
  dependencyConfigured(key: string): boolean
  optionValueLabels: ReadonlyMap<string, string>
  optionValueOptions?: ReadonlyMap<string, PluginConfigurationOption>
  onChange(values: Record<string, string>): void
  onQueryOptions(input: QueryPluginConfigurationOptionsInput): Promise<PluginConfigurationOption[]>
  bleedControl?: boolean
}) {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  if (field.type === 'hidden' || !matches(values, field.visibleWhen)) return null
  const required = field.required || Boolean(field.requiredWhen && matches(values, field.requiredWhen))
  const update = (value: string) => onChange(updateFieldValue(fields, values, field.key, value))
  const control = field.type === 'secret'
    ? <ConfiguredSecretInput configured={configured} field={field} required={required} value={values[field.key] || ''} onChange={update} />
    : field.dynamicOptions
      ? <DynamicOptionsInput
          pluginId={pluginId}
          configurationId={configurationId}
          field={field}
          fields={fields}
          values={values}
          required={required}
          dependencyConfigured={dependencyConfigured}
          optionValueLabels={optionValueLabels}
          optionValueOptions={optionValueOptions}
          onChange={update}
          onQueryOptions={onQueryOptions}
        />
      : field.type === 'select'
      ? <SelectControl
          className="w-full [&>button]:h-9 [&>button]:w-full [&>button]:border-input [&>button]:px-3 [&>button]:focus-visible:border-foreground/35"
          label={resolveSeedLocalizedText(field.label, locale)}
          value={values[field.key] || ''}
          options={(field.options || []).map((option) => ({ value: option.value, label: resolveSeedLocalizedText(option.label, locale) }))}
          onValueChange={(value) => {
            const defaults = field.options?.find((option) => option.value === value)?.defaults || {}
            onChange(updateFieldValue(fields, values, field.key, value, defaults))
          }}
        />
      : field.type === 'textarea'
        ? <TextAreaControl required={required} maxLength={field.maxLength} value={values[field.key] || ''} placeholder={field.placeholder ? resolveSeedLocalizedText(field.placeholder, locale) : t('plugins.inputPlaceholder')} onChange={(event) => update(event.target.value)} />
        : <input className={inputClass} type={field.type === 'url' ? 'url' : 'text'} required={required} maxLength={field.maxLength} value={values[field.key] || ''} placeholder={field.placeholder ? resolveSeedLocalizedText(field.placeholder, locale) : t('plugins.inputPlaceholder')} autoComplete="off" onChange={(event) => update(event.target.value)} />
  const renderedControl = bleedControl
    ? <div className="-mx-4 w-[calc(100%+2rem)] [&_button]:px-4 [&_input]:px-4 [&_textarea]:px-4">{control}</div>
    : control
  return <label className={`grid min-w-0 gap-1.5 text-[12px] text-muted-foreground ${fieldSpanClass[field.span]}`}>
    <FieldLabel description={resolveSeedLocalizedText(field.description, locale)} helpUrl={field.helpUrl} className="text-foreground">
      {resolveSeedLocalizedText(field.label, locale)}
    </FieldLabel>
    {renderedControl}
  </label>
}

const profileStatusTone = {
  idle: 'bg-muted-foreground/45',
  connecting: 'bg-accent',
  connected: 'bg-[var(--seed-success)]',
  reconnecting: 'bg-accent',
  disconnecting: 'bg-warning',
  disconnected: 'bg-muted-foreground/55',
  failed: 'bg-danger',
} satisfies Record<PluginConfigurationProfileStatus['state'], string>

function ProfileStatusDot({ status, onReconnect }: { status: PluginConfigurationProfileStatus; onReconnect?: () => void }) {
  const { t } = useTranslation()
  const label = t(`plugins.profileConnectionStatus.${status.state}`)
  const dot = <span className={`block h-2.5 w-2.5 rounded-full ${profileStatusTone[status.state]}`} />
  if (onReconnect) return <button
    type="button"
    className="grid h-7 w-7 shrink-0 place-items-center rounded-full outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
    aria-label={t('plugins.reconnectProfile')}
    title={status.error ? `${status.error}\n${t('plugins.reconnectProfile')}` : t('plugins.reconnectProfile')}
    onClick={onReconnect}
  >{dot}</button>
  return <span
    className="grid h-7 w-7 shrink-0 place-items-center"
    role="img"
    aria-label={label}
    title={status.error || label}
  >{dot}</span>
}

export function PluginConfigurationPanel({ pluginId, configuration, state, pluginNames, busy, embedded = false, hideDefaultControls = false, preferDefaultOnSave = false, onSave, onQueryOptions, onQueryProfileStatuses, onReconnectProfile }: Props) {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  const [profiles, setProfiles] = useState(() => parseProfiles(configuration, state))
  const [defaultId, setDefaultId] = useState(state.values.default_profile_id || '')
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(configuration.fields.map((field) => [field.key, field.type === 'secret' ? '' : state.values[field.key] ?? defaultValue(field)])))
  const [expandedId, setExpandedId] = useState('')
  const [pendingDefaultId, setPendingDefaultId] = useState('')
  const [reconnectingProfileId, setReconnectingProfileId] = useState('')
  const [profileStatuses, setProfileStatuses] = useState<PluginConfigurationProfileStatus[]>([])
  const [dynamicSummaryOptions, setDynamicSummaryOptions] = useState<Record<string, PluginConfigurationOption>>({})
  const sourceRevision = JSON.stringify({ configuration, state })
  const appliedSourceRevision = useRef(sourceRevision)

  useLayoutEffect(() => {
    if (sourceRevision === appliedSourceRevision.current) return
    appliedSourceRevision.current = sourceRevision
    const nextProfiles = parseProfiles(configuration, state)
    setProfiles(nextProfiles)
    setDefaultId(state.values.default_profile_id || '')
    setValues(Object.fromEntries(configuration.fields.map((field) => [field.key, field.type === 'secret' ? '' : state.values[field.key] ?? defaultValue(field)])))
    setExpandedId((current) => current && nextProfiles.some((profile) => profile.id === current) ? current : '')
    setPendingDefaultId('')
  }, [sourceRevision])

  useEffect(() => {
    if (!configuration.profiles.status) {
      setProfileStatuses([])
      return
    }
    let active = true
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const statuses = await onQueryProfileStatuses({ pluginId, configurationId: configuration.id })
        if (active) setProfileStatuses(statuses)
      } catch {
        if (active) setProfileStatuses([])
      } finally {
        pending = false
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), configuration.profiles.status.refreshIntervalMs)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [configuration.id, configuration.profiles.status, onQueryProfileStatuses, pluginId])

  const dynamicSummaryRevision = JSON.stringify(profiles.map((profile) => configuration.profiles.summaryFields.map((key) => [
    profile.id,
    key,
    profile[key] || '',
    ...(configuration.profiles.fields.find((field) => field.key === key)?.dynamicOptions?.dependsOn.map((dependency) => profile[dependency] || '') || []),
  ])))

  useEffect(() => {
    let active = true
    const requests = profiles.flatMap((profile) => configuration.profiles.summaryFields.flatMap((key) => {
      const field = configuration.profiles.fields.find((candidate) => candidate.key === key)
      const value = profile[key] || ''
      if (!field?.dynamicOptions || !value) return []
      const required = field.dynamicOptions.requiredFields || []
      if (required.some((requiredKey) => !profile[requiredKey])) return []
      return [onQueryOptions({ pluginId, configurationId: configuration.id, fieldKey: key, values: profile })
        .then((options) => {
          const selected = options.find((option) => option.value === value)
          return [profile.id, key, value, selected || { value, label: value }] as const
        })
        .catch(() => [profile.id, key, value, { value, label: value }] as const)]
    }))
    if (!requests.length) {
      setDynamicSummaryOptions({})
      return () => { active = false }
    }
    void Promise.all(requests).then((entries) => {
      if (!active) return
      setDynamicSummaryOptions(Object.fromEntries(entries.map(([profileId, key, value, option]) => [`${profileId}\0${key}\0${value}`, option])))
    })
    return () => { active = false }
  }, [configuration.id, configuration.profiles.fields, configuration.profiles.summaryFields, dynamicSummaryRevision, onQueryOptions, pluginId])

  const mutateProfiles = (next: Profile[]) => setProfiles(next)
  const updateProfile = (id: string, next: Profile) => mutateProfiles(profiles.map((profile) => profile.id === id ? next : profile))
  const secretConfigured = (profileId: string | null, key: string) => state.configuredSecrets.includes(profileId ? `profiles.${profileId}.${key}` : `values.${key}`)
  const summary = (profile: Profile) => {
    let loading = false
    const parts = configuration.profiles.summaryFields.map((key) => {
      const value = profile[key]
      if (!value) return undefined
      const field = configuration.profiles.fields.find((candidate) => candidate.key === key)
      const staticLabel = field?.options?.find((option) => option.value === value)?.label
      if (staticLabel) return { key, label: resolveSeedLocalizedText(staticLabel, locale) }
      const knownLabel = pluginNames.get(value)
      if (knownLabel) return { key, label: knownLabel }
      if (field?.dynamicOptions) {
        const summaryKey = `${profile.id}\0${key}\0${value}`
        const option = dynamicSummaryOptions[summaryKey]
        if (option) return { key, label: configurationOptionDisplayLabel(option), option }
        const required = field.dynamicOptions.requiredFields || []
        if (required.every((requiredKey) => Boolean(profile[requiredKey]))) {
          loading = true
          return undefined
        }
      }
      return { key, label: value }
    }).filter((part): part is { key: string; label: string; option?: PluginConfigurationOption } => Boolean(part))
    const label = parts.length
      ? parts.map((part) => [part.label, ...(part.option?.badges?.map((badge) => badge.label) || [])].join(' ')).join(' · ')
      : loading ? t('plugins.profileSummaryLoading') : profile.id
    return { label, parts, loading }
  }
  const savedProfiles = state.persisted ? parseProfiles(configuration, state) : []
  const savedDefaultId = state.persisted ? state.values.default_profile_id || '' : state.values.default_profile_id || ''
  const savedValues = Object.fromEntries(configuration.fields.map((field) => [field.key, field.type === 'secret' ? '' : state.values[field.key] ?? defaultValue(field)]))
  const profileChanged = (profile: Profile) => {
    const saved = savedProfiles.find((candidate) => candidate.id === profile.id)
    return !saved
      || configuration.profiles.fields.some((field) => field.type === 'secret' ? Boolean(profile[field.key]) : profile[field.key] !== saved[field.key])
  }
  const valuesChanged = configuration.fields.some((field) => field.type === 'secret' ? Boolean(values[field.key]) : values[field.key] !== savedValues[field.key])
  const submitConfiguration = (nextProfiles: Profile[], nextDefaultId: string, nextValues: Record<string, string>) => onSave({
    pluginId,
    configurationId: configuration.id,
    values: {
      ...nextValues,
      profiles: JSON.stringify(nextProfiles),
      default_profile_id: nextProfiles.some((profile) => profile.id === nextDefaultId)
        ? nextDefaultId
        : configuration.profiles.defaultRequired ? nextProfiles[0]?.id || '' : '',
    },
  })
  const saveProfile = (profile: Profile) => {
    if (busy) return
    const persisted = savedProfiles.some((candidate) => candidate.id === profile.id)
    void submitConfiguration(
      persisted ? savedProfiles.map((candidate) => candidate.id === profile.id ? profile : candidate) : [...savedProfiles, profile],
      defaultId || (preferDefaultOnSave ? profile.id : ''),
      savedValues,
    )
  }
  const selectDefaultProfile = (profileId: string) => {
    if (busy || profileId === savedDefaultId) return
    setPendingDefaultId(profileId)
    void submitConfiguration(savedProfiles, profileId, savedValues).finally(() => setPendingDefaultId(''))
  }
  const reconnectProfile = (profileId: string) => {
    if (reconnectingProfileId) return
    setReconnectingProfileId(profileId)
    setProfileStatuses((current) => current.map((status) => status.profileId === profileId
      ? { ...status, state: 'reconnecting', error: undefined }
      : status))
    void onReconnectProfile({ pluginId, configurationId: configuration.id, profileId })
      .catch((reason) => {
        setProfileStatuses((current) => current.map((status) => status.profileId === profileId
          ? { ...status, state: 'failed', error: reason instanceof Error ? reason.message : String(reason) }
          : status))
      })
      .finally(() => setReconnectingProfileId(''))
  }
  const statusesByProfileId = new Map(profileStatuses.map((status) => [status.profileId, status]))

  return <section className={embedded ? undefined : 'mt-8'}>
    {!embedded && <div className="sticky top-[96px] z-[8] bg-background">
      <h3 className="m-0 text-[17px] font-medium">{resolveSeedLocalizedText(configuration.title, locale)}</h3>
      <p className="mb-0 mt-1 text-[12px] leading-5 text-muted-foreground">{resolveSeedLocalizedText(configuration.description, locale)}</p>
    </div>}
    <div>
      {profiles.length > 0 && <div className="grid gap-2 pt-2">
        {profiles.map((profile) => {
          const persisted = savedProfiles.some((candidate) => candidate.id === profile.id)
          const changed = profileChanged(profile)
          const profileSummary = summary(profile)
          const profileStatus = configuration.profiles.status
            ? statusesByProfileId.get(profile.id) || { profileId: profile.id, state: 'idle' as const, reconnectable: false }
            : undefined
          const defaultControlVisible = profile.id === defaultId || profile.id === pendingDefaultId
          const defaultControl = !hideDefaultControls && configuration.profiles.actions.setDefault && persisted ? <span className={defaultControlVisible
            ? undefined
            : 'pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'}>
            <DefaultProfileControl
              selected={profile.id === defaultId}
              selectedLabel={resolveSeedLocalizedText(configuration.profiles.actions.setDefault.selectedLabel, locale)}
              actionLabel={resolveSeedLocalizedText(configuration.profiles.actions.setDefault.label, locale)}
              busy={pendingDefaultId === profile.id}
              disabled={busy}
              onSelect={() => selectDefaultProfile(profile.id)}
            />
          </span> : undefined
          return <div className="rounded-[14px] border border-border bg-card/60" key={profile.id}>
          <DisclosureControl
            open={expandedId === profile.id}
            label={profileSummary.label}
            onToggle={() => setExpandedId(expandedId === profile.id ? '' : profile.id)}
            actions={profileStatus || defaultControl ? <span className="flex items-center gap-2">
              {profileStatus && <ProfileStatusDot
                status={profileStatus}
                onReconnect={profileStatus.reconnectable
                  && (profileStatus.state === 'disconnected' || profileStatus.state === 'failed')
                  && reconnectingProfileId !== profile.id
                    ? () => reconnectProfile(profile.id)
                    : undefined}
              />}
              {defaultControl}
            </span> : undefined}
            actionsVisible={Boolean(profileStatus || defaultControlVisible)}
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-foreground">
              {profileSummary.parts.length ? profileSummary.parts.map((part, index) => <span className="contents" key={part.key}>
                {index > 0 && <span className="shrink-0 text-muted-foreground">·</span>}
                {part.option ? <ConfigurationOptionLabel option={part.option} /> : <span className="truncate">{part.label}</span>}
              </span>) : <span className="truncate">{profileSummary.label}</span>}
              {profileSummary.loading && <LoaderCircle className="shrink-0 animate-spin text-muted-foreground" size={13} aria-hidden="true" />}
            </span>
          </DisclosureControl>
          {expandedId === profile.id && <form className="border-t border-border p-4" noValidate onSubmit={(event) => { event.preventDefault(); saveProfile(profile) }}>
            <div className="flex flex-wrap gap-3">
              {configuration.profiles.fields.map((field) => {
                const saved = savedProfiles.find((candidate) => candidate.id === profile.id)
                const reset = field.resetWhenChanged?.some((key) => profile[key] !== saved?.[key]) || false
                const value = profile[field.key] || ''
                const dynamicOption = dynamicSummaryOptions[`${profile.id}\0${field.key}\0${value}`]
                const optionValueOptions = dynamicOption ? new Map([[value, dynamicOption]]) : undefined
                return <FieldControl
                  key={field.key}
                  pluginId={pluginId}
                  configurationId={configuration.id}
                  field={field}
                  fields={configuration.profiles.fields}
                  values={profile}
                  configured={!reset && secretConfigured(profile.id, field.key)}
                  dependencyConfigured={(key) => {
                    const dependency = configuration.profiles.fields.find((candidate) => candidate.key === key)
                    const reset = dependency?.resetWhenChanged?.some((dependencyKey) => profile[dependencyKey] !== saved?.[dependencyKey]) || false
                    return !reset && secretConfigured(profile.id, key)
                  }}
                  optionValueLabels={pluginNames}
                  optionValueOptions={optionValueOptions}
                  onChange={(next) => updateProfile(profile.id, next as Profile)}
                  onQueryOptions={onQueryOptions}
                />
              })}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              {changed && <ActionButton type="submit" icon={<Save size={14} />} busy={busy}>{busy ? t('plugins.savingConfiguration') : resolveSeedLocalizedText(configuration.profiles.actions.save.label, locale)}</ActionButton>}
              {(!persisted || configuration.profiles.actions.remove) && (persisted ? savedProfiles.length : profiles.length) > configuration.profiles.minItems && <ActionButton type="button" tone={persisted ? 'danger' : 'neutral'} icon={persisted ? <Trash2 size={14} /> : <X size={14} />} busy={busy} onClick={() => {
                if (persisted) {
                  const remaining = savedProfiles.filter((candidate) => candidate.id !== profile.id)
                  void submitConfiguration(remaining, savedDefaultId === profile.id
                    ? configuration.profiles.defaultRequired ? remaining[0]?.id || '' : ''
                    : savedDefaultId, savedValues)
                  return
                }
                const remaining = profiles.filter((candidate) => candidate.id !== profile.id)
                mutateProfiles(remaining)
                if (defaultId === profile.id) setDefaultId(savedDefaultId || remaining[0]?.id || '')
                setExpandedId('')
              }}>{persisted ? resolveSeedLocalizedText(configuration.profiles.actions.remove!.label, locale) : t('common.cancel')}</ActionButton>}
            </div>
          </form>}
        </div>})}
      </div>}
      {configuration.profiles.actions.add && profiles.length < configuration.profiles.maxItems && <ActionButton className="mt-3" type="button" icon={<Plus size={14} />} onClick={() => {
        const profile = newProfile(configuration)
        mutateProfiles([...profiles, profile])
        setExpandedId(profile.id)
        if (configuration.profiles.defaultRequired && !defaultId) setDefaultId(profile.id)
      }}>{resolveSeedLocalizedText(configuration.profiles.actions.add.label, locale)}</ActionButton>}
      {configuration.fields.length > 0 && configuration.actions?.save && <form className="mt-4 px-4" noValidate onSubmit={(event) => { event.preventDefault(); if (!busy) void submitConfiguration(savedProfiles, savedDefaultId, values) }}>
        <div className="flex flex-wrap gap-x-3 gap-y-4">
          {configuration.fields.map((field) => {
            const reset = field.resetWhenChanged?.some((key) => values[key] !== state.values[key]) || false
            return <FieldControl
              key={field.key}
              pluginId={pluginId}
              configurationId={configuration.id}
              field={field}
              fields={configuration.fields}
              values={values}
              configured={!reset && secretConfigured(null, field.key)}
              dependencyConfigured={(key) => {
                const dependency = configuration.fields.find((candidate) => candidate.key === key)
                const reset = dependency?.resetWhenChanged?.some((dependencyKey) => values[dependencyKey] !== state.values[dependencyKey]) || false
                return !reset && secretConfigured(null, key)
              }}
              optionValueLabels={pluginNames}
              onChange={setValues}
              onQueryOptions={onQueryOptions}
              bleedControl={field.span === 'full'}
            />
          })}
        </div>
        {valuesChanged && <div className="mt-3 flex justify-end"><ActionButton type="submit" icon={<Save size={14} />} busy={busy}>{busy ? t('plugins.savingConfiguration') : resolveSeedLocalizedText(configuration.actions.save.label, locale)}</ActionButton></div>}
      </form>}
    </div>
  </section>
}
