import { Check, CircleDot, Copy, FileUp, FolderOpen, MoreHorizontal, Pause, Play, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { SeedPluginManagementView, SeedLocalizedText } from '../../../shared/plugin-manifest'
import { resolveSeedLocalizedText } from '../../../shared/plugin-manifest'
import { invalidManagementInput, managementFormArguments, resolveManagementInitialValues, resolveManagementInputFields, resolveManagementModelValues, type ManagementFormValues, type ManagementInputField } from '../../../shared/plugin-management-form'
import { ActionButton } from '../../components/ActionButton'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { DateInputControl } from '../../components/DateInputControl'
import { FileInputControl, selectLocalFiles } from '../../components/FileInputControl'
import { IconButton } from '../../components/IconButton'
import { AdaptiveIcon, ResourceCard, resourceCardGridClass } from '../../components/ResourceCard'
import { TextAreaControl } from '../../components/TextAreaControl'
import { FieldLabel } from '../../components/FieldLabel'
import { MarkdownContent } from '../../components/MarkdownContent'
import { ModelSelectControl } from '../../components/ModelSelectControl'
import { SelectControl } from '../../components/SelectControl'
import { TextInputControl } from '../../components/TextInputControl'
import { ToggleSwitch } from '../../components/ToggleSwitch'
import { useSeedI18n } from '../../i18n'

type View = SeedPluginManagementView
type ManagementAction = View['actions'][number]
type CollectionProps = {
  items_path?: string
  id_field?: string
  title_field?: string
  description_field?: string
  empty_title?: SeedLocalizedText
  empty_description?: SeedLocalizedText
  presentation?: {
    layout: 'list' | 'cards'
    columns?: number
    item_icon?: {
      type: 'static'
      src: string
      darkSrc?: string
    } | {
      type: 'field'
      srcField: string
      darkSrcField?: string
    }
  }
  preview?: {
    mode: 'modal'
    renderer: 'markdown'
    frontmatter: 'show' | 'hide'
    source: string
    argumentBindings: Record<string, string>
    titleField: string
    descriptionField?: string
    contentField: string
    visibleWhen?: { path: string; in: Array<string | number | boolean | null> }
  }
  status?: {
    state_path: string
    title_path?: string
    description_path?: string
    error_path?: string
    elapsed_ms_path?: string
    visible_states?: Array<string | number | boolean | null>
    states?: Record<string, { title: SeedLocalizedText }>
  }
  document?: {
    value_path: string
    label: SeedLocalizedText
    state_path: string
    visible_states: Array<string | number | boolean | null>
  }
}
type PanelProps = {
  blocks: Array<
    | { type: 'text'; value_path: string; label?: SeedLocalizedText }
    | { type: 'markdown'; value_path: string; stream_id_path?: string; streaming_when?: { path: string; in: Array<string | number | boolean | null> }; label?: SeedLocalizedText }
    | { type: 'status'; state_path: string; label_path?: string; states: Record<string, SeedLocalizedText> }
    | { type: 'image' | 'qr'; data_url_path: string; alt?: SeedLocalizedText }
    | { type: 'progress'; value_path: string; max: number; label?: SeedLocalizedText }
  >
}

function valueAt(value: unknown, path: string) {
  return path.split('.').filter(Boolean).reduce<unknown>((current, key) => (
    current && typeof current === 'object' && !Array.isArray(current) ? (current as Record<string, unknown>)[key] : undefined
  ), value)
}

function withValueAt(value: unknown, path: string, text: string): unknown {
  const [head, ...tail] = path.split('.').filter(Boolean)
  if (!head || !value || typeof value !== 'object' || Array.isArray(value)) return value
  return { ...value, [head]: tail.length ? withValueAt((value as Record<string, unknown>)[head], tail.join('.'), text) : text }
}

function conditionMatches(condition: { path: string; in: Array<string | number | boolean | null> } | undefined, value: unknown) {
  if (!condition) return true
  return condition.in.some((candidate) => Object.is(candidate, valueAt(value, condition.path)))
}

function visible(action: ManagementAction, value: unknown) {
  return conditionMatches(action.visibleWhen, value)
}

function formatDuration(value: unknown) {
  const totalSeconds = Math.max(0, Math.floor(Number(value || 0) / 1_000))
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
}

const actionIcons = {
  record: CircleDot,
  pause: Pause,
  play: Play,
  check: Check,
  save: Save,
  x: X,
  trash: Trash2,
  folder: FolderOpen,
} as const

function withoutFrontmatter(content: string) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, '').replace(/^\s+/, '')
}

function safeImageDataUrl(value: string) {
  return /^data:image\/(?:svg\+xml|png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : undefined
}

export function PluginManagementSkeleton({ view, label }: { view: View; label: string }) {
  const panelBlocks = view.renderer === 'seed.panel' ? (view.props as PanelProps).blocks : []
  const hasMarkdown = panelBlocks.some((block) => block.type === 'markdown')
  const collectionPresentation = view.renderer === 'seed.collection' ? (view.props as CollectionProps).presentation : undefined
  const toolbarItem = (item: View['toolbar'][number], index: number) => <span key={index} className={`block h-[30px] shrink-0 rounded-lg bg-border/70 ${item.type === 'refresh' ? 'w-[30px]' : item.type === 'select_field' ? 'w-[170px] max-w-[35vw]' : item.type === 'file_input' ? 'w-[104px]' : 'w-[96px]'}`} />
  return <div aria-label={label} role="status" className="animate-pulse motion-reduce:animate-none">
    {view.toolbar.length > 0 && <div className="flex min-h-[30px] items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">{view.toolbar.filter((item) => item.type === 'select_field' && item.align === 'start').map(toolbarItem)}</div>
      <div className="flex items-center gap-2">{view.toolbar.filter((item) => item.type !== 'select_field' || item.align !== 'start').map(toolbarItem)}</div>
    </div>}
    {view.renderer === 'seed.panel' ? <div className="mt-3 divide-y divide-border/70 rounded-[12px] bg-muted/55 px-4 pb-3 pt-2" aria-hidden="true">
      {panelBlocks.map((block, index) => <div className={`${block.type === 'status' ? 'py-2' : 'py-3'} first:pt-0 last:pb-0`} key={index}>
        {block.type === 'status' ? <div className="flex h-[30px] items-center gap-3"><span className="h-2.5 w-2.5 rounded-full bg-border" /><span className="h-3 w-24 rounded bg-border/70" />{hasMarkdown && <span className="ml-auto h-3.5 w-3.5 rounded bg-border/70" />}</div>
          : block.type === 'markdown' ? <div className="space-y-3 py-1"><div className="h-3 w-5/6 rounded bg-border/70" /><div className="h-3 w-2/3 rounded bg-border/70" /><div className="h-3 w-3/4 rounded bg-border/70" /></div>
            : block.type === 'text' ? <div className="space-y-2"><div className="h-2.5 w-20 rounded bg-border/70" /><div className="h-3 w-3/5 rounded bg-border/70" /></div>
              : block.type === 'progress' ? <div className="h-2 w-full rounded-full bg-border/70" />
                : <div className="mx-auto h-32 w-32 rounded-lg bg-border/70" />}
      </div>)}
    </div> : <div className={collectionPresentation?.layout === 'cards' ? resourceCardGridClass((collectionPresentation.columns as 1 | 2 | 3 | 4 | undefined) || 2) : 'mt-3'} aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => <div className="flex items-center gap-3 border-b border-border/70 py-3 last:border-b-0" key={index}><span className="h-11 w-11 shrink-0 rounded-lg bg-border/70" /><div className="flex-1 space-y-2"><div className="h-3 w-2/5 rounded bg-border/70" /><div className="h-2.5 w-3/5 rounded bg-border/70" /></div></div>)}
    </div>}
  </div>
}

export function PluginManagementView({ pluginId, view, query, invoke }: {
  pluginId: string
  view: View
  query(input: { pluginId: string; viewId: string; sourceId?: string; arguments?: Record<string, unknown> }): Promise<unknown>
  invoke(input: { pluginId: string; viewId: string; actionId: string; arguments: Record<string, unknown> }): Promise<unknown>
}) {
  const { locale } = useSeedI18n()
  const { t } = useTranslation()
  const [value, setValue] = useState<unknown>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [settledView, setSettledView] = useState<{ pluginId: string; viewId: string } | null>(null)
  const [busyAction, setBusyAction] = useState('')
  const [dialogAction, setDialogAction] = useState<ManagementAction>()
  const [dialogValues, setDialogValues] = useState<ManagementFormValues>({})
  const [inlineValues, setInlineValues] = useState<ManagementFormValues>({})
  const [inlineFileError, setInlineFileError] = useState('')
  const [viewDragging, setViewDragging] = useState(false)
  const [dialogArguments, setDialogArguments] = useState<Record<string, unknown>>({})
  const [previewItem, setPreviewItem] = useState<Record<string, unknown>>()
  const [previewValue, setPreviewValue] = useState<unknown>()
  const [previewError, setPreviewError] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewMenuOpen, setPreviewMenuOpen] = useState(false)
  const [actionResult, setActionResult] = useState<{ action: ManagementAction; value: unknown }>()
  const [copiedBlock, setCopiedBlock] = useState<number | null>(null)
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewPanelRef = useRef<HTMLDivElement>(null)
  const loadRevisionRef = useRef(0)
  const viewRef = useRef(view)
  viewRef.current = view
  const dragDepthRef = useRef(0)
  const chooseInlineFileRef = useRef<(() => void) | null>(null)
  const fieldChangeQueueRef = useRef<Promise<void>>(Promise.resolve())
  const previewMenuOpenRef = useRef(false)
  const dialogOpenRef = useRef(false)
  previewMenuOpenRef.current = previewMenuOpen
  dialogOpenRef.current = Boolean(dialogAction)
  const load = useCallback(async (quiet = false) => {
    const revision = ++loadRevisionRef.current
    if (!quiet) setLoading(true)
    setError('')
    try {
      const next = await query({ pluginId, viewId: view.id })
      if (revision !== loadRevisionRef.current) return
      setValue((previous: unknown) => {
        const currentView = viewRef.current
        if (currentView.renderer !== 'seed.panel') return next
        let merged = next
        for (const block of (currentView.props as PanelProps).blocks) {
          if (block.type !== 'markdown' || !block.stream_id_path || !conditionMatches(block.streaming_when, next)) continue
          if (valueAt(previous, block.stream_id_path) !== valueAt(next, block.stream_id_path)) continue
          const current = valueAt(previous, block.value_path)
          const snapshot = valueAt(next, block.value_path)
          if (typeof current === 'string' && typeof snapshot === 'string' && current.startsWith(snapshot)) {
            merged = withValueAt(merged, block.value_path, current)
          }
        }
        return merged
      })
    }
    catch (cause) { if (revision === loadRevisionRef.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (revision === loadRevisionRef.current) { setLoading(false); setSettledView({ pluginId, viewId: view.id }) } }
  }, [pluginId, query, view.id])
  useEffect(() => { setValue(undefined); void load() }, [load])
  useEffect(() => window.motusSeed.subscribe((event) => {
    const currentView = viewRef.current
    if (event.type !== 'plugin.management.text' || event.pluginId !== pluginId || event.viewId !== currentView.id || currentView.renderer !== 'seed.panel') return
    const block = (currentView.props as PanelProps).blocks.find((candidate) => candidate.type === 'markdown' && candidate.value_path === event.valuePath)
    if (!block || block.type !== 'markdown' || !block.stream_id_path) return
    setValue((previous: unknown) => {
      if (valueAt(previous, block.stream_id_path!) !== event.streamId) return previous
      const current = valueAt(previous, event.valuePath)
      if (typeof current !== 'string') return previous
      if (event.operation === 'replace') return withValueAt(previous, event.valuePath, event.text)
      const offset = event.offset
      if (offset === undefined || offset > current.length) return previous
      if (offset < current.length) return previous
      return withValueAt(previous, event.valuePath, current + event.text)
    })
  }), [pluginId, view.id])
  useEffect(() => { setInlineValues({}); setInlineFileError(''); setViewDragging(false); setCopiedBlock(null); dragDepthRef.current = 0 }, [pluginId, view.id])
  useEffect(() => () => { if (copyResetRef.current) clearTimeout(copyResetRef.current) }, [])
  useEffect(() => {
    if (!view.refreshIntervalMs) return
    const timer = window.setInterval(() => void load(true), view.refreshIntervalMs)
    return () => window.clearInterval(timer)
  }, [load, view.refreshIntervalMs])
  useEffect(() => {
    if (!previewItem) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = requestAnimationFrame(() => previewPanelRef.current?.focus())
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (dialogOpenRef.current) return
      event.preventDefault()
      if (previewMenuOpenRef.current) setPreviewMenuOpen(false)
      else setPreviewItem(undefined)
    }
    document.addEventListener('keydown', close)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', close)
      previousFocus?.focus()
    }
  }, [previewItem])

  const props = view.props as CollectionProps
  const panelProps = view.props as PanelProps
  const source = valueAt(value, props.items_path || 'items')
  const items = Array.isArray(source) ? source.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : []
  const displayValue = (input: unknown) => {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const localized = input as Partial<SeedLocalizedText>
      if (typeof localized.en_US === 'string' && typeof localized.zh_Hans === 'string') return resolveSeedLocalizedText(localized as SeedLocalizedText, locale)
    }
    return String(input ?? '')
  }
  const field = (item: Record<string, unknown>, name: string | undefined, fallback: string) => displayValue(valueAt(item, name || fallback))
  const itemIcon = (item: Record<string, unknown>) => {
    const icon = props.presentation?.item_icon
    if (!icon) return <AdaptiveIcon />
    return icon.type === 'static'
      ? <AdaptiveIcon iconUrl={icon.src} iconDarkUrl={icon.darkSrc} />
      : <AdaptiveIcon iconUrl={safeImageDataUrl(field(item, icon.srcField, ''))} iconDarkUrl={icon.darkSrcField ? safeImageDataUrl(field(item, icon.darkSrcField, '')) : undefined} />
  }
  const footerActions = view.actions.filter((action) => action.placement === 'footer' && visible(action, value))
  const itemMenuActions = previewItem ? view.actions.filter((action) => action.placement === 'item_menu' && visible(action, previewItem)) : []
  const itemFooterActions = previewItem ? view.actions.filter((action) => action.placement === 'item_footer' && visible(action, previewItem)) : []
  const statusState = props.status ? valueAt(value, props.status.state_path) : undefined
  const statusVisible = Boolean(props.status && (!props.status.visible_states || props.status.visible_states.some((candidate) => Object.is(candidate, statusState))))
  const statusPresentation = props.status?.states?.[String(statusState ?? '')]
  const documentVisible = Boolean(props.document && props.document.visible_states.some((candidate) => Object.is(candidate, valueAt(value, props.document!.state_path))))
  const dialogFields = resolveManagementInputFields(dialogAction?.input?.fields || [], value)
  const dialogValid = !dialogAction?.input || !invalidManagementInput(dialogFields, managementFormArguments(dialogFields, dialogValues))
  const inlineAction = view.renderer === 'seed.panel' ? view.actions.find((action) => action.input?.mode === 'inline') : undefined
  const inlineFields = resolveManagementInputFields(inlineAction?.input?.fields || [], value)
  const effectiveInlineValues = resolveManagementModelValues(view.toolbar, inlineFields, resolveManagementInitialValues(inlineFields, value, inlineValues))
  const toolbarSelectKeys = new Set(view.toolbar.flatMap((item) => item.type === 'select_field'
    ? [item.fieldKey, ...(item.thinkingFieldKey ? [item.thinkingFieldKey] : [])] : []))
  const inlineBodyFields = inlineFields.filter((field) => !toolbarSelectKeys.has(field.key))
  const inlineValid = !inlineAction?.input || !invalidManagementInput(inlineFields, managementFormArguments(inlineFields, effectiveInlineValues))
  const dropField = inlineAction?.input?.fields.find((field) => field.key === inlineAction.input?.dropTarget)
  const fileChangeActionId = view.toolbar.find((item) => item.type === 'file_input')?.onChangeActionId
  const viewTitle = resolveSeedLocalizedText(view.title, locale)

  const copyPanelContent = async (content: string, blockIndex: number) => {
    try {
      await window.motusWindow.copyText(content)
      setCopiedBlock(blockIndex)
      if (copyResetRef.current) clearTimeout(copyResetRef.current)
      copyResetRef.current = setTimeout(() => setCopiedBlock(null), 2_000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('plugins.managementCopyFailed'))
    }
  }

  const run = async (action: ManagementAction, argumentsValue: Record<string, unknown> = {}) => {
    setBusyAction(action.id)
    setError('')
    try {
      const result = await invoke({ pluginId, viewId: view.id, actionId: action.id, arguments: argumentsValue })
      if (action.result) setActionResult({ action, value: result })
      setDialogAction(undefined)
      if (action.placement === 'item_footer') setPreviewItem(undefined)
      await load(true)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (action.placement === 'item_menu' || action.placement === 'item_footer') setPreviewError(message)
      else setError(message)
    } finally {
      setBusyAction('')
    }
  }
  const itemArguments = (action: ManagementAction, item?: Record<string, unknown>) => item
    ? Object.fromEntries(Object.entries(action.argumentBindings).map(([key, path]) => [key, valueAt(item, path)]))
    : {}
  const selectAction = (action: ManagementAction, item?: Record<string, unknown>) => {
    const argumentsValue = itemArguments(action, item)
    if (action.input?.mode === 'inline') {
      if (!inlineValid) return
      return void run(action, { ...argumentsValue, ...managementFormArguments(inlineFields, effectiveInlineValues) })
    }
    if (!action.input && !action.confirmation) return void run(action, argumentsValue)
    setDialogArguments(argumentsValue)
    setDialogValues(Object.fromEntries((action.input?.fields || []).map((field) => {
      const initial = field.initialValuePath ? valueAt(item || value, field.initialValuePath) : undefined
      return [field.key, field.type === 'checkbox' ? initial === true
        : field.type === 'files' ? (Array.isArray(initial) ? initial.filter((value): value is string => typeof value === 'string') : [])
          : String(initial ?? '')]
    })))
    setDialogAction(action)
  }
  const openPreview = async (item: Record<string, unknown>) => {
    if (!props.preview) return
    setPreviewItem(item)
    setPreviewMenuOpen(false)
    setPreviewValue(undefined)
    setPreviewError('')
    setPreviewLoading(true)
    const argumentsValue = Object.fromEntries(Object.entries(props.preview.argumentBindings).map(([key, path]) => [key, valueAt(item, path)]))
    try { setPreviewValue(await query({ pluginId, viewId: view.id, sourceId: props.preview.source, arguments: argumentsValue })) }
    catch (cause) { setPreviewError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setPreviewLoading(false) }
  }
  const actionControl = (action: ManagementAction, key: string, item?: Record<string, unknown>) => {
    const Icon = action.icon ? actionIcons[action.icon] : undefined
    const label = resolveSeedLocalizedText(action.label, locale)
    const disabled = action.input?.mode === 'inline' && !inlineValid
    if (action.display === 'icon') return <IconButton key={key} label={label} tone={action.tone} icon={Icon ? <Icon size={16} /> : null} busy={busyAction === action.id} disabled={disabled} onClick={() => selectAction(action, item)} />
    return <ActionButton key={key} aria-label={label} tone={action.tone} icon={Icon ? <Icon size={14} /> : undefined} busy={busyAction === action.id} disabled={disabled} onClick={() => selectAction(action, item)}>{label}</ActionButton>
  }
  const actions = (entries: ManagementAction[]) => entries.map((action) => actionControl(action, action.id))
  const saveFieldChange = (actionId: string | undefined, next: ManagementFormValues) => {
    if (!actionId) return
    const action = view.actions.find((candidate) => candidate.id === actionId && candidate.placement === 'field_change')
    if (!action?.input) return
    const argumentsValue = managementFormArguments(action.input.fields, next)
    fieldChangeQueueRef.current = fieldChangeQueueRef.current.catch(() => undefined).then(async () => {
      await invoke({ pluginId, viewId: view.id, actionId, arguments: argumentsValue })
      await load(true)
    }).catch((cause) => { setError(cause instanceof Error ? cause.message : String(cause)) })
  }
  const toolbar = view.toolbar.map((item, index) => {
    if (item.type === 'refresh') return <IconButton key="refresh" label={t('plugins.refreshManagementView', { title: viewTitle })} icon={<RefreshCw size={16} />} busy={loading} onClick={() => void load()} />
    if (item.type === 'select_field') {
      const field = inlineFields.find((candidate) => candidate.key === item.fieldKey && candidate.type === 'select')
      if (!field) return null
      const label = resolveSeedLocalizedText(field.label, locale)
      const raw = effectiveInlineValues[field.key]
      const options = item.control === 'model_select'
        ? (field.options || []).map((option) => ({ value: option.value, label: resolveSeedLocalizedText(option.label, locale), group: option.group, iconDataUrl: option.icon_data_url ? safeImageDataUrl(option.icon_data_url) : undefined }))
        : [{ value: '', label: resolveSeedLocalizedText(field.placeholder, locale) || t('plugins.managementSelect') }, ...(field.options || []).map((option) => ({ value: option.value, label: resolveSeedLocalizedText(option.label, locale) }))]
      const controlProps = { key: `select_field:${field.key}`, className: item.control === 'model_select' ? 'max-w-[calc(100vw-16px)]' : 'w-[190px] max-w-[30vw]', label, value: typeof raw === 'string' ? raw : '', options, disabled: item.control === 'model_select' && options.length === 0,
        onValueChange: (next: string) => {
          const levels: readonly string[] = (next ? field.options?.find((option) => option.value === next) : field.options?.find((option) => option.is_default))?.thinking_levels || []
          const thinking = item.thinkingFieldKey
          const updated = { ...effectiveInlineValues, [field.key]: next, ...(thinking && effectiveInlineValues[thinking] && !levels.includes(String(effectiveInlineValues[thinking])) ? { [thinking]: '' } : {}) }
          setInlineValues(updated)
          saveFieldChange(item.onChangeActionId, updated)
        } }
      const selectedModel = field.options?.find((option) => option.value === raw)
      return item.control === 'model_select'
        ? <ModelSelectControl {...controlProps}
            thinkingValue={item.thinkingFieldKey ? String(effectiveInlineValues[item.thinkingFieldKey] || '') : ''}
            thinkingLevels={selectedModel?.thinking_levels}
            onThinkingChange={item.thinkingFieldKey ? (next) => {
              const updated = { ...effectiveInlineValues, [item.thinkingFieldKey!]: next }
              setInlineValues(updated)
              saveFieldChange(item.onChangeActionId, updated)
            } : undefined} />
        : <SelectControl portal variant="form" {...controlProps} />
    }
    if (item.type === 'file_input') {
      const label = dropField?.chooseLabel ? resolveSeedLocalizedText(dropField.chooseLabel, locale) : t('plugins.managementFilesChoose')
      return <ActionButton key="file_input" aria-label={label} icon={<FileUp size={14} />} onClick={() => chooseInlineFileRef.current?.()}>{label}</ActionButton>
    }
    const action = view.actions.find((candidate) => candidate.id === item.actionId)
    if (!action || !visible(action, value)) return null
    return actionControl(action, `${item.actionId}-${index}`)
  })
  const inputFields = (fields: ManagementInputField[], values: ManagementFormValues, setValues: Dispatch<SetStateAction<ManagementFormValues>>, inline = false) => {
    const onlyField = fields.length === 1 ? fields[0] : undefined
    const onlyValue = onlyField ? values[onlyField.key] : undefined
    const emptyToolbarOnlyField = inline && Boolean(onlyField) && onlyField?.key === dropField?.key && view.toolbar.some((item) => item.type === 'file_input')
      && (Array.isArray(onlyValue) ? onlyValue.length === 0 : !onlyValue)
    return <div className={emptyToolbarOnlyField ? 'contents' : 'grid gap-4'}>{fields.map((field) => {
    const label = resolveSeedLocalizedText(field.label, locale)
    const raw = values[field.key]
    const current = typeof raw === 'string' ? raw : ''
    const update = (next: string | string[] | boolean) => {
      const updated = { ...(inline ? effectiveInlineValues : values), [field.key]: next }
      setValues(updated)
      if (inline && field.key === dropField?.key) saveFieldChange(fileChangeActionId, updated)
    }
    const toolbarFileField = inline && field.key === dropField?.key && view.toolbar.some((item) => item.type === 'file_input')
    const emptyToolbarFileField = toolbarFileField && (Array.isArray(raw) ? raw.length === 0 : !current)
    return <div className={emptyToolbarFileField ? 'contents' : 'grid min-w-0 gap-1.5'} key={field.key}>
      {field.type !== 'checkbox' && !emptyToolbarFileField && <FieldLabel description={resolveSeedLocalizedText(field.description, locale)} helpUrl={field.helpUrl} className="text-[12px] font-medium">{label}</FieldLabel>}
      {field.type === 'textarea'
        ? <TextAreaControl aria-label={label} rows={field.maxLength > 4_096 ? 14 : 4} maxLength={field.maxLength} placeholder={resolveSeedLocalizedText(field.placeholder, locale)} value={current} onChange={(event) => update(event.target.value)} />
        : field.type === 'select'
          ? <SelectControl portal variant="form" className="w-full" label={label} value={current}
              options={[{ value: '', label: resolveSeedLocalizedText(field.placeholder, locale) || t('plugins.managementSelect') }, ...(field.options || []).map((option) => ({ value: option.value, label: resolveSeedLocalizedText(option.label, locale) }))]}
              onValueChange={update} />
          : field.type === 'checkbox'
            ? <div className="flex items-start gap-2"><ToggleSwitch checked={raw === true} label={label} onClick={() => update(raw !== true)} />
                <span className="text-[12px] text-foreground"><span className="font-medium">{label}</span>{field.description && <span className="mt-0.5 block text-muted-foreground">{resolveSeedLocalizedText(field.description, locale)}</span>}</span></div>
            : field.type === 'date'
              ? <DateInputControl label={label} locale={locale} value={current} onChange={update}
                  placeholder={resolveSeedLocalizedText(field.placeholder, locale) || t('plugins.managementDatePlaceholder')}
                  previousMonthLabel={t('plugins.managementDatePreviousMonth')} nextMonthLabel={t('plugins.managementDateNextMonth')}
                  todayLabel={t('plugins.managementDateToday')} clearLabel={t('plugins.managementDateClear')} />
            : field.type === 'file' || field.type === 'files'
              ? <FileInputControl label={label} value={field.type === 'files' ? (Array.isArray(raw) ? raw : []) : current} multiple={field.type === 'files'} accept={field.accept} onChange={update} getPathForFile={window.motusWindow.getPathForFile}
                  chooseRef={toolbarFileField ? chooseInlineFileRef : undefined}
                  chooseLabel={field.chooseLabel ? resolveSeedLocalizedText(field.chooseLabel, locale) : t(field.type === 'files' ? 'plugins.managementFilesChoose' : 'plugins.managementFileChoose')}
                  dropLabel={t(field.type === 'files' ? 'plugins.managementFilesDrop' : 'plugins.managementFileDrop')}
                  clearLabel={t('plugins.managementFileClear')}
                  singleFileError={t('plugins.managementFileSingle')} tooManyFilesError={t('plugins.managementFilesMax')}
                  localFileError={t('plugins.managementFileLocal')} fileTypeError={t('plugins.managementFileType')} />
              : <TextInputControl className="w-full" type={field.type} aria-label={label} min={field.type === 'number' ? field.minValue : undefined} max={field.type === 'number' ? field.maxValue : undefined}
                  maxLength={field.type === 'number' ? undefined : field.maxLength} placeholder={resolveSeedLocalizedText(field.placeholder, locale)} value={current} autoComplete="off" onChange={(event) => update(event.target.value)} />}
    </div>
    })}</div>
  }
  const markdownBlocks = view.renderer === 'seed.panel' ? panelProps.blocks.filter((block) => block.type === 'markdown') : []
  const copyContent = markdownBlocks.map((block) => valueAt(value, block.value_path)).filter((content): content is string => typeof content === 'string' && Boolean(content.trim())).join('\n\n')
  const panelBlocks = view.renderer === 'seed.panel' ? panelProps.blocks.map((block, index) => {
    if (block.type === 'text') {
      const content = String(valueAt(value, block.value_path) ?? '')
      if (!content.trim()) return null
      return <div className="py-3 first:pt-0 last:pb-0" key={index}>
        {block.label && <span className="block text-[11px] text-muted-foreground">{resolveSeedLocalizedText(block.label, locale)}</span>}
        <span className="mt-0.5 block whitespace-pre-wrap break-words text-[13px] text-foreground">{content}</span>
      </div>
    }
    if (block.type === 'markdown') {
      const content = String(valueAt(value, block.value_path) ?? '')
      if (!content.trim()) return null
      return <div className="py-3 first:pt-0 last:pb-0" key={index}>
        {block.label && <span className="block text-[11px] text-muted-foreground">{resolveSeedLocalizedText(block.label, locale)}</span>}
        <MarkdownContent streaming={Boolean(block.streaming_when && conditionMatches(block.streaming_when, value))}>{content}</MarkdownContent>
      </div>
    }
    if (block.type === 'status') {
      const state = String(valueAt(value, block.state_path) ?? '')
      const label = block.states[state] ? resolveSeedLocalizedText(block.states[state]!, locale) : String(valueAt(value, block.label_path || '') ?? state)
      return <div className="flex min-h-6 items-center gap-3 py-2 first:pt-0 last:pb-0" key={index}>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${state === 'connected' || state === 'ready' ? 'bg-[var(--seed-success)]' : state === 'connecting' || state === 'pending' ? 'animate-pulse bg-info' : state === 'error' ? 'bg-danger' : 'bg-muted-foreground/55'}`} />
        <span className="text-[13px]">{label}</span>
        {markdownBlocks.length > 0 && <IconButton className="ml-auto" label={t(copiedBlock === index ? 'plugins.managementCopied' : 'plugins.managementCopy')} icon={copiedBlock === index ? <Check size={14} /> : <Copy size={14} />} disabled={!copyContent} onClick={() => void copyPanelContent(copyContent, index)} />}
      </div>
    }
    if (block.type === 'image' || block.type === 'qr') {
      const source = safeImageDataUrl(String(valueAt(value, block.data_url_path) ?? ''))
      return source ? <div className="grid place-items-center py-3 first:pt-0 last:pb-0" key={index}><img className={block.type === 'qr' ? 'h-56 w-56 rounded-lg bg-white p-2 [image-rendering:pixelated]' : 'max-h-[360px] max-w-full rounded-lg'} src={source} alt={resolveSeedLocalizedText(block.alt, locale)} /></div> : null
    }
    if (block.type !== 'progress') return null
    const maximum = Math.max(1, Number(block.max || 100))
    const current = Math.min(maximum, Math.max(0, Number(valueAt(value, block.value_path) || 0)))
    return <div className="py-3 first:pt-0 last:pb-0" key={index}>{block.label && <span className="mb-2 block text-[11px] text-muted-foreground">{resolveSeedLocalizedText(block.label, locale)}</span>}<div className="h-2 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${current / maximum * 100}%` }} /></div></div>
  }).filter((block) => block !== null) : []
  const panel = view.renderer === 'seed.panel' ? <div className="mt-3 grid gap-3">
    {inlineAction?.input && inlineBodyFields.length > 0 && inputFields(inlineBodyFields, effectiveInlineValues, setInlineValues, true)}
    {panelBlocks.length > 0 && <div className="divide-y divide-border/70 rounded-[12px] bg-muted/55 px-4 pb-3 pt-2">{panelBlocks}</div>}
  </div> : null

  const acceptViewDrop = (files: FileList) => {
    if (!dropField) return
    const current = effectiveInlineValues[dropField.key]
    const selected = selectLocalFiles(files, typeof current === 'string' || Array.isArray(current) ? current : dropField.type === 'files' ? [] : '', {
      multiple: dropField.type === 'files', accept: dropField.accept,
      getPathForFile: window.motusWindow.getPathForFile,
      singleFileError: t('plugins.managementFileSingle'), tooManyFilesError: t('plugins.managementFilesMax'),
      localFileError: t('plugins.managementFileLocal'), fileTypeError: t('plugins.managementFileType'),
    })
    if (selected.error) setInlineFileError(selected.error)
    else if (selected.value !== undefined) {
      setInlineFileError('')
      const updated = { ...effectiveInlineValues, [dropField.key]: selected.value }
      setInlineValues(updated)
      saveFieldChange(fileChangeActionId, updated)
    }
  }

  if (settledView?.pluginId !== pluginId || settledView.viewId !== view.id) return <section className="mt-8 rounded-[12px]" aria-busy="true">
    {view.show_header && <div className="mb-4"><h3 className="m-0 text-[17px] font-medium">{viewTitle}</h3><p className="mb-0 mt-1 text-[12px] leading-5 text-muted-foreground">{resolveSeedLocalizedText(view.description, locale)}</p></div>}
    <PluginManagementSkeleton view={view} label={t('plugins.loadingManagementView')} />
  </section>

  return <section className="mt-8 rounded-[12px]"
    onDragEnterCapture={(event) => { if (dropField && event.dataTransfer.types.includes('Files')) { dragDepthRef.current += 1; setViewDragging(true) } }}
    onDragOverCapture={(event) => { if (dropField && event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
    onDragLeaveCapture={() => { if (dragDepthRef.current > 0) dragDepthRef.current -= 1; if (dragDepthRef.current === 0) setViewDragging(false) }}
    onDragEndCapture={() => { dragDepthRef.current = 0; setViewDragging(false) }}
    onDropCapture={(event) => { if (dropField && event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); dragDepthRef.current = 0; setViewDragging(false); acceptViewDrop(event.dataTransfer.files) } }}>
    {viewDragging && createPortal(<div className="pointer-events-none fixed inset-0 z-[80] grid place-items-center bg-card/90 backdrop-blur-[2px]" aria-hidden="true">
      <div className="flex flex-col items-center gap-2 text-foreground"><FileUp size={24} className="text-info" /><span className="text-[14px] font-medium">{t('plugins.managementFileRelease')}</span></div>
    </div>, document.body)}
    <div className="flex items-center justify-between gap-4">
      {view.show_header && <div>
        <h3 className="m-0 text-[17px] font-medium">{viewTitle}</h3>
        <p className="mb-0 mt-1 text-[12px] leading-5 text-muted-foreground">{resolveSeedLocalizedText(view.description, locale)}</p>
      </div>}
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">{toolbar.filter((_, index) => view.toolbar[index]?.type === 'select_field' && view.toolbar[index].align === 'start')}</div>
        <div className="flex items-center gap-2">{toolbar.filter((_, index) => view.toolbar[index]?.type !== 'select_field' || view.toolbar[index].align !== 'start')}</div>
      </div>
    </div>
    {error && <p className="my-4 text-[12px] text-danger">{error}</p>}
    {inlineFileError && <p className="my-4 text-[12px] text-danger" role="alert">{inlineFileError}</p>}
    {panel}
    {statusVisible && props.status && <div className="my-4 flex items-center gap-3 rounded-[12px] bg-muted/70 px-4 py-3">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusState === 'recording' ? 'animate-pulse bg-danger' : statusState === 'processing' ? 'animate-pulse bg-accent' : 'bg-muted-foreground/55'}`} />
      <div className="min-w-0 flex-1">
        <strong className="block truncate text-[13px] font-medium">{statusPresentation ? resolveSeedLocalizedText(statusPresentation.title, locale) : String(valueAt(value, props.status.title_path || '') || statusState || '')}</strong>
        {props.status.error_path && valueAt(value, props.status.error_path) != null
          ? <span className="mt-0.5 block text-[12px] text-danger">{String(valueAt(value, props.status.error_path))}</span>
          : props.status.description_path && valueAt(value, props.status.description_path) != null && <span className="mt-0.5 block text-[12px] text-muted-foreground">{String(valueAt(value, props.status.description_path))}</span>}
      </div>
      {props.status.elapsed_ms_path && <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{formatDuration(valueAt(value, props.status.elapsed_ms_path))}</span>}
    </div>}
    {documentVisible && props.document && <div className="my-4">
      <span className="mb-2 block text-[12px] font-medium">{resolveSeedLocalizedText(props.document.label, locale)}</span>
      <pre className="m-0 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-[12px] bg-muted/55 p-4 font-mono text-[11px] leading-5 text-foreground">{String(valueAt(value, props.document.value_path) || '')}</pre>
    </div>}
    {view.renderer === 'seed.collection' && (items.length ? <div className={props.presentation?.layout === 'cards' ? resourceCardGridClass((props.presentation.columns as 1 | 2 | 3 | 4 | undefined) || 2) : ''}>
      {items.map((item, index) => {
        const id = field(item, props.id_field, 'id') || String(index)
        const title = field(item, props.title_field, 'name') || id
        const description = field(item, props.description_field, 'description')
        const previewable = Boolean(props.preview && conditionMatches(props.preview.visibleWhen, item))
        if (props.presentation?.layout === 'cards') return <ResourceCard
          key={id}
          icon={itemIcon(item)}
          title={<span className="truncate">{title}</span>}
          description={description}
          onOpen={previewable ? () => void openPreview(item) : undefined}
        />
        const content = <>
          {itemIcon(item)}
          <span className="min-w-0 flex-1 text-left">
            <strong className="block text-[14px] font-medium text-foreground">{title}</strong>
            {description && <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{description}</span>}
          </span>
        </>
        return previewable
          ? <button className="flex w-full cursor-pointer items-center gap-3 border-0 border-b border-border/70 bg-transparent py-3 font-inherit transition hover:bg-muted/50 last:border-b-0" key={id} type="button" onClick={() => void openPreview(item)}>{content}</button>
          : <div className="flex items-center gap-3 border-b border-border/70 py-3 last:border-b-0" key={id}>{content}</div>
      })}
    </div> : (!loading || value !== undefined) && !statusVisible && !documentVisible && <div className="grid min-h-[160px] place-items-center px-6 py-10 text-center">
      <div>
        <strong className="block text-[14px] font-medium">{resolveSeedLocalizedText(props.empty_title, locale)}</strong>
        <p className="mb-0 mt-1 text-[12px] text-muted-foreground">{resolveSeedLocalizedText(props.empty_description, locale)}</p>
      </div>
    </div>)}
    {footerActions.length > 0 && <div className="mt-4 flex justify-end gap-2">{actions(footerActions)}</div>}
    {previewItem && props.preview && createPortal(<div className="fixed inset-0 z-[90] grid place-items-center bg-black/20 px-6 py-8 backdrop-blur-[2px] animate-[fade_.15s_ease_both]" onPointerDown={(event) => { if (event.target === event.currentTarget && !busyAction) setPreviewItem(undefined) }}>
      <div ref={previewPanelRef} className="flex max-h-[min(760px,calc(100vh-64px))] w-full max-w-[760px] flex-col rounded-[18px] border border-border bg-card p-5 text-foreground shadow-[0_18px_55px_rgba(0,0,0,.18)] outline-none animate-[rise_.18s_ease_both]" role="dialog" aria-modal="true" tabIndex={-1}>
        <div className="flex shrink-0 items-start gap-4">
          {itemIcon(previewItem)}
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="m-0 text-[18px] font-medium">{displayValue(valueAt(previewValue, props.preview.titleField) ?? valueAt(previewItem, props.title_field || 'name'))}</h2>
            {(() => {
              const description = props.preview.descriptionField ? valueAt(previewValue, props.preview.descriptionField) : field(previewItem, props.description_field, 'description')
              return description == null || description === '' ? null : <p className="mb-0 mt-1 text-[12px] leading-5 text-muted-foreground">{displayValue(description)}</p>
            })()}
          </div>
          {itemMenuActions.length > 0 && <div className="relative">
            <IconButton label={t('plugins.moreActions')} icon={<MoreHorizontal size={17} />} onClick={() => setPreviewMenuOpen((open) => !open)} />
            {previewMenuOpen && <div className="absolute right-0 top-11 z-10 min-w-[160px] overflow-hidden rounded-[12px] border border-border bg-card p-1 shadow-[0_12px_32px_rgba(0,0,0,.14)]" role="menu">
              {itemMenuActions.map((action) => <button className="flex w-full items-center gap-2 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-[12px] text-foreground hover:bg-muted" key={action.id} role="menuitem" type="button" onClick={() => { setPreviewMenuOpen(false); selectAction(action, previewItem) }}>
                {action.icon && (() => { const Icon = actionIcons[action.icon]; return <Icon size={14} /> })()}
                {resolveSeedLocalizedText(action.label, locale)}
              </button>)}
            </div>}
          </div>}
          <IconButton label={t('window.close')} icon={<X size={17} />} onClick={() => setPreviewItem(undefined)} />
        </div>
        <div className="mt-5 min-h-[280px] flex-1 overflow-auto rounded-[12px] bg-muted/45 p-5">
          {previewError ? <p className="m-0 text-[12px] text-danger">{previewError}</p>
            : previewLoading ? <div className="grid h-full min-h-[280px] place-items-center text-[12px] text-muted-foreground">{t('plugins.loadingPreview')}</div>
              : <MarkdownContent>{props.preview.frontmatter === 'hide'
                ? withoutFrontmatter(String(valueAt(previewValue, props.preview.contentField) ?? ''))
                : String(valueAt(previewValue, props.preview.contentField) ?? '')}</MarkdownContent>}
        </div>
        {itemFooterActions.length > 0 && <div className="mt-4 flex shrink-0 justify-end gap-2">{itemFooterActions.map((action) => actionControl(action, action.id, previewItem))}</div>}
      </div>
    </div>, document.body)}
    {actionResult?.action.result && createPortal(<div className="fixed inset-0 z-[95] grid place-items-center bg-black/20 px-6 py-8 backdrop-blur-[2px]" onPointerDown={(event) => { if (event.target === event.currentTarget) setActionResult(undefined) }}>
      <div className="max-h-[min(720px,calc(100vh-64px))] w-full max-w-[680px] overflow-auto rounded-[18px] border border-border bg-card p-5 shadow-[0_18px_55px_rgba(0,0,0,.18)]" role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-4"><h2 className="m-0 text-[18px] font-medium">{String(valueAt(actionResult.value, actionResult.action.result.title_path || '') || resolveSeedLocalizedText(actionResult.action.label, locale))}</h2><IconButton label={t('window.close')} icon={<X size={17} />} onClick={() => setActionResult(undefined)} /></div>
        <div className="mt-4 rounded-[12px] bg-muted/45 p-5">{(() => {
          const result = actionResult.action.result!
          const content = String(valueAt(actionResult.value, result.content_path) ?? '')
          if (result.renderer === 'markdown') return <MarkdownContent>{content}</MarkdownContent>
          if (result.renderer === 'image' || result.renderer === 'qr') {
            const source = safeImageDataUrl(content)
            return source ? <img className={result.renderer === 'qr' ? 'mx-auto h-56 w-56 rounded-lg bg-white p-2 [image-rendering:pixelated]' : 'mx-auto max-h-[520px] max-w-full rounded-lg'} src={source} alt="" /> : <p className="m-0 text-[12px] text-danger">Invalid image result.</p>
          }
          return <p className="m-0 whitespace-pre-wrap text-[13px] leading-6">{content}</p>
        })()}</div>
      </div>
    </div>, document.body)}
    {dialogAction && (dialogAction.input || dialogAction.confirmation) && <ConfirmDialog
      open
      title={resolveSeedLocalizedText(dialogAction.input?.title || dialogAction.confirmation!.title, locale)}
      description={resolveSeedLocalizedText(dialogAction.input?.description || dialogAction.confirmation?.description, locale)}
      confirmLabel={resolveSeedLocalizedText(dialogAction.input?.confirmLabel || dialogAction.confirmation!.confirmLabel, locale)}
      cancelLabel={t('common.cancel')}
      tone={dialogAction.tone === 'danger' ? 'danger' : 'primary'}
      busy={busyAction === dialogAction.id}
      confirmDisabled={!dialogValid}
      onCancel={() => setDialogAction(undefined)}
      onConfirm={() => void run(dialogAction, { ...dialogArguments, ...managementFormArguments(dialogFields, dialogValues) })}
    >
      {dialogAction.input && <div className="max-h-[min(55vh,480px)] overflow-y-auto">{inputFields(dialogFields, dialogValues, setDialogValues)}</div>}
    </ConfirmDialog>}
  </section>
}
