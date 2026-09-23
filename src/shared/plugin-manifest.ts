import { z } from 'zod'
import { seedNetworkPermissions } from '@motusai/seed-sdk'
import { seedVersionPattern } from './seed-version'

const identifier = z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/)
const pluginIdentifier = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/)
export const seedPluginRuntimeEntry = './dist/index.mjs'
export type SeedLocalizedText = { en_US: string; zh_Hans: string }

export function seedLocalizedTextSchema(max: number) {
  const text = z.string().min(1).max(max)
  return z.object({ en_US: text, zh_Hans: text }).strict()
}

export function resolveSeedLocalizedText(value: SeedLocalizedText | undefined, locale: string, fallback = '') {
  if (!value) return fallback
  return locale.toLowerCase().startsWith('en')
    ? value.en_US
    : value.zh_Hans
}
export const seedPluginLabels = [
  'agimx', 'search', 'image', 'videos', 'weather', 'finance', 'design', 'travel', 'social',
  'news', 'medical', 'productivity', 'education', 'business', 'entertainment', 'utilities', 'other',
] as const
const seedPluginLabelSchema = z.enum(seedPluginLabels)
const seedNetworkPermissionSet = new Set<string>(seedNetworkPermissions)
export const seedPluginLabelsSchema = z.array(seedPluginLabelSchema).min(1).max(3).superRefine((labels, context) => {
  const seen = new Set<string>()
  for (const [index, label] of labels.entries()) {
    if (seen.has(label)) context.addIssue({ code: 'custom', path: [index], message: `重复的插件标签：${label}` })
    seen.add(label)
  }
})
const relativeEntry = z.string().min(1).refine((value) => {
  if (!value.startsWith('./') || value.includes('\\') || value.includes('\0')) return false
  const segments = value.slice(2).split('/')
  return segments.length > 0 && segments.every((segment) => segment && segment !== '.' && segment !== '..')
}, {
  message: '插件入口必须是使用 / 的相对路径。',
})

const assetEntry = relativeEntry.refine((value) => /^\.\/assets\/.+\.(?:svg|png|webp|jpe?g)$/i.test(value), {
  message: '插件资源必须位于 ./assets/，并使用 SVG、PNG、WebP 或 JPEG 格式。',
})

const sidecarEntry = relativeEntry.refine((value) => /^\.\/sidecars\/[A-Za-z0-9._/-]+$/.test(value), {
  message: 'Sidecar 必须位于 ./sidecars/。',
})

const seedPluginSidecarSchema = z.object({
  id: identifier,
  path: sidecarEntry,
  executable: z.literal(true),
}).strict()

const jsonSchema = z.record(z.string(), z.unknown()).superRefine((value, context) => {
  const text = JSON.stringify(value)
  if (text.length > 65_536) context.addIssue({ code: 'custom', message: 'JSON Schema 不能超过 64 KiB。' })
  if (value.$async === true) context.addIssue({ code: 'custom', message: 'Seed 不允许异步 JSON Schema。' })
})

const seedConsumedCapabilityByIdSchema = z.object({
  capability: identifier,
  methods: z.array(identifier).min(1),
}).strict().superRefine((value, context) => {
  const methods = new Set<string>()
  for (const [index, method] of value.methods.entries()) {
    if (methods.has(method)) context.addIssue({ code: 'custom', path: ['methods', index], message: `重复的方法：${method}` })
    methods.add(method)
  }
})

const seedConsumedCapabilityByAnnotationSchema = z.object({
  match: z.object({
    method_annotation: identifier,
    equals: z.union([z.boolean(), z.number().finite(), z.string().min(1).max(256)]),
  }).strict(),
}).strict()

const seedConsumedCapabilitySchema = z.union([
  seedConsumedCapabilityByIdSchema,
  seedConsumedCapabilityByAnnotationSchema,
])

const seedPluginConfigurationConditionSchema = z.object({
  field: identifier,
  equals: z.union([z.string().max(2_048), z.array(z.string().max(2_048)).min(1).max(32)]),
}).strict()

const seedPluginConfigurationOptionSchema = z.object({
  value: z.string().min(1).max(200),
  label: seedLocalizedTextSchema(100),
  defaults: z.record(identifier, z.string().max(2_048)).optional(),
}).strict()

const seedPluginDynamicOptionsSchema = z.object({
  depends_on: z.array(identifier).max(8).default([]),
  required_fields: z.array(identifier).max(8).default([]),
}).strict().transform(({ depends_on, required_fields }) => ({ dependsOn: depends_on, requiredFields: required_fields }))

const seedPluginConfigurationActionSchema = z.object({
  label: seedLocalizedTextSchema(100),
}).strict()

const seedPluginSetDefaultActionSchema = z.object({
  label: seedLocalizedTextSchema(100),
  selected_label: seedLocalizedTextSchema(100),
}).strict().transform(({ selected_label, ...action }) => ({ ...action, selectedLabel: selected_label }))

const seedPluginProfileActionsSchema = z.object({
  add: seedPluginConfigurationActionSchema.optional(),
  save: seedPluginConfigurationActionSchema,
  remove: seedPluginConfigurationActionSchema.optional(),
  set_default: seedPluginSetDefaultActionSchema.optional(),
}).strict().transform(({ set_default, ...actions }) => ({ ...actions, setDefault: set_default }))

const seedPluginProfileStatusSchema = z.object({
  source: z.literal('connections'),
  refresh_interval_ms: z.number().int().min(500).max(60_000).default(1_000),
}).strict().transform(({ refresh_interval_ms, ...status }) => ({ ...status, refreshIntervalMs: refresh_interval_ms }))

const seedPluginConfigurationFieldSchema = z.object({
  key: identifier,
  type: z.enum(['hidden', 'text', 'secret', 'url', 'textarea', 'select']),
  label: seedLocalizedTextSchema(100).optional(),
  description: seedLocalizedTextSchema(300).optional(),
  placeholder: seedLocalizedTextSchema(200).optional(),
  help_url: z.string().url().max(2_048).regex(/^https:\/\//, '帮助链接必须使用 HTTPS。').optional(),
  required: z.boolean().default(false),
  default: z.string().max(2_048).optional(),
  max_length: z.number().int().min(1).max(20_000).default(2_048),
  span: z.enum(['small', 'default', 'full']).default('default'),
  schemes: z.array(z.enum(['http', 'https'])).min(1).max(2).optional(),
  options: z.array(seedPluginConfigurationOptionSchema).min(1).max(32).optional(),
  dynamic_options: seedPluginDynamicOptionsSchema.optional(),
  visible_when: seedPluginConfigurationConditionSchema.optional(),
  required_when: seedPluginConfigurationConditionSchema.optional(),
  reset_when_changed: z.array(identifier).min(1).max(8).optional(),
}).strict().superRefine((field, context) => {
  if (field.help_url && !field.description) context.addIssue({ code: 'custom', path: ['help_url'], message: '帮助链接必须同时声明字段说明。' })
  if (field.placeholder && (field.type === 'hidden' || field.type === 'select')) context.addIssue({ code: 'custom', path: ['placeholder'], message: '隐藏字段和选择字段不能声明输入提示。' })
  if (field.type === 'select' && !field.options?.length) context.addIssue({ code: 'custom', path: ['options'], message: '选择字段必须声明选项。' })
  if (field.type !== 'select' && field.options !== undefined) context.addIssue({ code: 'custom', path: ['options'], message: '只有选择字段可以声明选项。' })
  if (field.type !== 'url' && field.schemes !== undefined) context.addIssue({ code: 'custom', path: ['schemes'], message: '只有 URL 字段可以声明协议。' })
  if (field.dynamic_options && field.type !== 'text') context.addIssue({ code: 'custom', path: ['dynamic_options'], message: '只有文本字段可以声明动态选项。' })
}).transform(({ max_length, help_url, visible_when, required_when, reset_when_changed, dynamic_options, ...field }) => ({
  ...field,
  maxLength: max_length,
  helpUrl: help_url,
  visibleWhen: visible_when,
  requiredWhen: required_when,
  resetWhenChanged: reset_when_changed,
  dynamicOptions: dynamic_options,
}))

const seedPluginProfilesSchema = z.object({
  id_prefix: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/).default('profile'),
  default_group: identifier.optional(),
  min_items: z.number().int().min(0).max(32).default(1),
  max_items: z.number().int().min(1).max(32).default(16),
  default_required: z.boolean().default(true),
  summary_fields: z.array(identifier).min(1).max(4),
  status: seedPluginProfileStatusSchema.optional(),
  fields: z.array(seedPluginConfigurationFieldSchema).min(1).max(32),
  actions: seedPluginProfileActionsSchema,
}).strict().superRefine((profiles, context) => {
  if (profiles.max_items < profiles.min_items) context.addIssue({ code: 'custom', path: ['max_items'], message: '配置档案最大数量不能小于最小数量。' })
  const keys = new Set(profiles.fields.map((field) => field.key))
  if (keys.size !== profiles.fields.length) context.addIssue({ code: 'custom', path: ['fields'], message: '配置档案包含重复字段。' })
  for (const [index, key] of profiles.summary_fields.entries()) {
    if (!keys.has(key)) context.addIssue({ code: 'custom', path: ['summary_fields', index], message: `摘要字段不存在：${key}` })
  }
  for (const [index, field] of profiles.fields.entries()) {
    if (field.type !== 'hidden' && !field.label) context.addIssue({ code: 'custom', path: ['fields', index, 'label'], message: '可见配置字段必须提供标题。' })
    if (field.type === 'hidden' && field.default === undefined) context.addIssue({ code: 'custom', path: ['fields', index, 'default'], message: '隐藏配置字段必须提供默认值。' })
    if (field.default !== undefined && field.default.length > field.maxLength) context.addIssue({ code: 'custom', path: ['fields', index, 'default'], message: '字段默认值超过最大长度。' })
    if (field.type === 'select' && field.default && !field.options?.some((option) => option.value === field.default)) context.addIssue({ code: 'custom', path: ['fields', index, 'default'], message: '选择字段默认值不在选项中。' })
    for (const condition of [field.visibleWhen, field.requiredWhen]) {
      if (condition && !keys.has(condition.field)) context.addIssue({ code: 'custom', path: ['fields', index], message: `条件引用了不存在的字段：${condition.field}` })
    }
    for (const key of field.resetWhenChanged || []) {
      if (!keys.has(key)) context.addIssue({ code: 'custom', path: ['fields', index, 'reset_when_changed'], message: `重置条件引用了不存在的字段：${key}` })
    }
    for (const key of field.dynamicOptions?.dependsOn || []) {
      if (!keys.has(key)) context.addIssue({ code: 'custom', path: ['fields', index, 'dynamic_options', 'depends_on'], message: `动态选项依赖了不存在的字段：${key}` })
    }
    for (const key of field.dynamicOptions?.requiredFields || []) {
      if (!keys.has(key)) context.addIssue({ code: 'custom', path: ['fields', index, 'dynamic_options', 'required_fields'], message: `动态选项要求了不存在的字段：${key}` })
    }
    if (field.options && new Set(field.options.map((option) => option.value)).size !== field.options.length) {
      context.addIssue({ code: 'custom', path: ['fields', index, 'options'], message: '选择字段包含重复选项。' })
    }
    for (const option of field.options || []) {
      for (const key of Object.keys(option.defaults || {})) {
        if (!keys.has(key)) context.addIssue({ code: 'custom', path: ['fields', index, 'options'], message: `选项默认值引用了不存在的字段：${key}` })
      }
    }
  }
}).transform(({ id_prefix, default_group, min_items, max_items, default_required, summary_fields, ...profiles }) => ({
  ...profiles,
  idPrefix: id_prefix,
  defaultGroup: default_group,
  minItems: min_items,
  maxItems: max_items,
  defaultRequired: default_required,
  summaryFields: summary_fields,
}))

const emptyFormProfiles = seedPluginProfilesSchema.parse({
  id_prefix: 'form',
  min_items: 0,
  max_items: 1,
  default_required: false,
  summary_fields: ['reserved'],
  fields: [{ key: 'reserved', type: 'hidden', default: 'unused' }],
  actions: { save: { label: { en_US: 'Save', zh_Hans: '保存' } } },
})

const seedPluginConfigurationRouteNodeSchema = z.object({
  title: seedLocalizedTextSchema(100),
  description: seedLocalizedTextSchema(300),
}).strict()

const seedPluginConfigurationSourcePresentationSchema = z.object({
  mode: z.enum(['relay', 'direct', 'local']),
  summary: seedLocalizedTextSchema(500),
  origin: seedPluginConfigurationRouteNodeSchema,
  relay: seedPluginConfigurationRouteNodeSchema,
  destination: seedPluginConfigurationRouteNodeSchema,
}).strict()

const seedPluginDetailPresentationNodeSchema = z.object({
  icon: z.enum(['agent', 'cloud', 'device', 'file', 'folder', 'server', 'shield']),
  title: seedLocalizedTextSchema(100),
  description: seedLocalizedTextSchema(300),
}).strict()

const seedPluginDetailPresentationSchema = z.object({
  renderer: z.literal('seed.route'),
  summary: seedLocalizedTextSchema(500),
  nodes: z.array(seedPluginDetailPresentationNodeSchema).min(2).max(3),
}).strict()

export const seedPluginConfigurationSchema = z.object({
  id: identifier,
  schema_version: z.literal(1),
  renderer: identifier,
  permission: identifier.optional(),
  secret_access: z.enum(['owner', 'broker']).default('owner'),
  title: seedLocalizedTextSchema(100),
  description: seedLocalizedTextSchema(500),
  source_presentation: seedPluginConfigurationSourcePresentationSchema.optional(),
  fields: z.array(seedPluginConfigurationFieldSchema).max(32).default([]),
  actions: z.object({ save: seedPluginConfigurationActionSchema }).strict().optional(),
  profiles: seedPluginProfilesSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.permission && value.permission.length > 128) context.addIssue({ code: 'custom', path: ['permission'], message: '配置权限无效。' })
  if (value.fields.length > 0 && !value.actions?.save) context.addIssue({ code: 'custom', path: ['actions', 'save'], message: '配置级字段必须声明保存动作。' })
  if (value.source_presentation && !value.profiles?.defaultGroup) context.addIssue({ code: 'custom', path: ['source_presentation'], message: '来源展示必须属于一个默认配置组。' })
  if (value.renderer === 'seed.form') {
    if (value.profiles) context.addIssue({ code: 'custom', path: ['profiles'], message: '独立表单不能声明配置档案。' })
    if (!value.fields.length) context.addIssue({ code: 'custom', path: ['fields'], message: '独立表单必须声明至少一个字段。' })
  } else if (!value.profiles) {
    context.addIssue({ code: 'custom', path: ['profiles'], message: '配置档案渲染器必须声明配置档案。' })
  }
  if ((value.renderer === 'seed.option-list' || value.renderer === 'seed.catalog-list') && value.profiles) {
    const optionField = value.profiles.fields[0]
    if (value.fields.length > 0) context.addIssue({ code: 'custom', path: ['fields'], message: '动态选项列表不能声明配置级字段。' })
    if (value.profiles.fields.length !== 1 || !optionField?.dynamicOptions) {
      context.addIssue({ code: 'custom', path: ['profiles', 'fields'], message: '动态选项列表必须声明且只能声明一个动态选项字段。' })
    }
    if (optionField?.dynamicOptions?.dependsOn.length || optionField?.dynamicOptions?.requiredFields.length) {
      context.addIssue({ code: 'custom', path: ['profiles', 'fields', 0, 'dynamic_options'], message: '动态选项列表不能依赖其他配置字段。' })
    }
    if (value.profiles.maxItems !== 1) context.addIssue({ code: 'custom', path: ['profiles', 'max_items'], message: '选项列表只能保存一个选中项。' })
    if (value.renderer === 'seed.option-list' && !value.profiles.actions.setDefault) {
      context.addIssue({ code: 'custom', path: ['profiles', 'actions', 'set_default'], message: '可选择选项列表必须声明设为默认动作。' })
    }
    if (value.renderer === 'seed.catalog-list') {
      if (value.profiles.minItems !== 0 || value.profiles.defaultRequired) {
        context.addIssue({ code: 'custom', path: ['profiles'], message: '只读目录列表不能要求保存选中项。' })
      }
      if (value.profiles.actions.add || value.profiles.actions.remove || value.profiles.actions.setDefault) {
        context.addIssue({ code: 'custom', path: ['profiles', 'actions'], message: '只读目录列表不能声明档案操作。' })
      }
    }
  }
  const keys = new Set<string>()
  for (const [index, field] of (value.fields || []).entries()) {
    if (keys.has(field.key)) context.addIssue({ code: 'custom', path: ['fields', index, 'key'], message: `重复的配置字段：${field.key}` })
    if (field.type !== 'hidden' && !field.label) context.addIssue({ code: 'custom', path: ['fields', index, 'label'], message: '可见配置字段必须提供标题。' })
    if (field.type === 'hidden' && field.default === undefined) context.addIssue({ code: 'custom', path: ['fields', index, 'default'], message: '隐藏配置字段必须提供默认值。' })
    if (field.default !== undefined && field.default.length > field.maxLength) context.addIssue({ code: 'custom', path: ['fields', index, 'default'], message: '字段默认值超过最大长度。' })
    if (field.type === 'select' && field.default && !field.options?.some((option) => option.value === field.default)) context.addIssue({ code: 'custom', path: ['fields', index, 'default'], message: '选择字段默认值不在选项中。' })
    keys.add(field.key)
  }
  for (const [index, field] of value.fields.entries()) {
    for (const condition of [field.visibleWhen, field.requiredWhen]) {
      if (condition && !keys.has(condition.field)) context.addIssue({ code: 'custom', path: ['fields', index], message: `条件引用了不存在的字段：${condition.field}` })
    }
    for (const key of field.resetWhenChanged || []) {
      if (!keys.has(key)) context.addIssue({ code: 'custom', path: ['fields', index, 'reset_when_changed'], message: `重置条件引用了不存在的字段：${key}` })
    }
    for (const key of field.dynamicOptions?.dependsOn || []) {
      if (!keys.has(key)) context.addIssue({ code: 'custom', path: ['fields', index, 'dynamic_options', 'depends_on'], message: `动态选项依赖了不存在的字段：${key}` })
    }
    for (const key of field.dynamicOptions?.requiredFields || []) {
      if (!keys.has(key)) context.addIssue({ code: 'custom', path: ['fields', index, 'dynamic_options', 'required_fields'], message: `动态选项要求了不存在的字段：${key}` })
    }
    if (field.options && new Set(field.options.map((option) => option.value)).size !== field.options.length) context.addIssue({ code: 'custom', path: ['fields', index, 'options'], message: '选择字段包含重复选项。' })
    for (const option of field.options || []) {
      for (const key of Object.keys(option.defaults || {})) {
        if (!keys.has(key)) context.addIssue({ code: 'custom', path: ['fields', index, 'options'], message: `选项默认值引用了不存在的字段：${key}` })
      }
    }
  }
}).transform(({ schema_version, secret_access, source_presentation, profiles, ...configuration }) => ({
  ...configuration,
  profiles: profiles || emptyFormProfiles,
  schemaVersion: schema_version,
  secretAccess: secret_access,
  sourcePresentation: source_presentation,
}))

const seedPluginManagementSourceSchema = z.object({
  capability: identifier,
  method: identifier,
  arguments: z.record(z.string(), z.unknown()).default({}),
}).strict()

const seedPluginManagementDataSourceSchema = z.object({
  capability: identifier,
  method: identifier,
  arguments: z.record(z.string(), z.unknown()).default({}),
  parameters: z.array(identifier).max(16).default([]),
}).strict()

const seedPluginManagementConditionSchema = z.object({
  path: z.string().min(1).max(200),
  in: z.array(z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).min(1).max(16),
}).strict()

const seedPluginManagementInputFieldSchema = z.object({
  key: identifier,
  type: z.enum(['text', 'textarea']),
  label: seedLocalizedTextSchema(100),
  description: seedLocalizedTextSchema(300).optional(),
  help_url: z.string().url().max(2_048).regex(/^https:\/\//, '帮助链接必须使用 HTTPS。').optional(),
  placeholder: seedLocalizedTextSchema(200).optional(),
  required: z.boolean().default(false),
  max_length: z.number().int().min(1).max(65_536).default(2_048),
  initial_value_path: z.string().min(1).max(200).optional(),
}).strict().superRefine((field, context) => {
  if (field.help_url && !field.description) context.addIssue({ code: 'custom', path: ['help_url'], message: '帮助链接必须同时声明字段说明。' })
}).transform(({ max_length, help_url, initial_value_path, ...field }) => ({
  ...field,
  maxLength: max_length,
  helpUrl: help_url,
  initialValuePath: initial_value_path,
}))

const seedPluginManagementActionSchema = z.object({
  id: identifier,
  label: seedLocalizedTextSchema(100),
  icon: z.enum(['record', 'pause', 'play', 'check', 'save', 'x', 'trash', 'folder']).optional(),
  display: z.enum(['label', 'icon']).default('label'),
  tone: z.enum(['neutral', 'primary', 'danger']).default('neutral'),
  placement: z.enum(['toolbar', 'footer', 'item_menu', 'item_footer']).default('toolbar'),
  target: seedPluginManagementSourceSchema,
  argument_bindings: z.record(identifier, z.string().min(1).max(200)).default({}),
  visible_when: seedPluginManagementConditionSchema.optional(),
  input: z.object({
    title: seedLocalizedTextSchema(100),
    description: seedLocalizedTextSchema(500).optional(),
    confirm_label: seedLocalizedTextSchema(100),
    fields: z.array(seedPluginManagementInputFieldSchema).min(1).max(8),
  }).strict().transform(({ confirm_label, ...input }) => ({ ...input, confirmLabel: confirm_label })).optional(),
  confirmation: z.object({
    title: seedLocalizedTextSchema(100),
    description: seedLocalizedTextSchema(500).optional(),
    confirm_label: seedLocalizedTextSchema(100),
  }).strict().transform(({ confirm_label, ...confirmation }) => ({ ...confirmation, confirmLabel: confirm_label })).optional(),
  result: z.object({
    mode: z.literal('modal'),
    renderer: z.enum(['text', 'markdown', 'image', 'qr']),
    title_path: z.string().min(1).max(200).optional(),
    content_path: z.string().min(1).max(200),
  }).strict().optional(),
}).strict().refine((action) => !(action.input && action.confirmation), '插件管理动作不能同时声明输入表单和确认提示。').transform(({ visible_when, argument_bindings, ...action }) => ({ ...action, visibleWhen: visible_when, argumentBindings: argument_bindings }))

const seedPluginManagementToolbarItemSchema = z.union([
  z.object({ type: z.literal('refresh') }).strict(),
  z.object({ type: z.literal('action'), action_id: identifier }).strict().transform(({ action_id, ...item }) => ({ ...item, actionId: action_id })),
])

const seedPluginManagementImageDataUrlSchema = z.string().max(350_000).regex(/^data:image\/(?:svg\+xml|png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/)

const seedPluginCollectionItemIconSchema = z.union([
  z.object({
    type: z.literal('static'),
    src: seedPluginManagementImageDataUrlSchema,
    dark_src: seedPluginManagementImageDataUrlSchema.optional(),
  }).strict().transform(({ dark_src, ...icon }) => ({ ...icon, darkSrc: dark_src })),
  z.object({
    type: z.literal('field'),
    src_field: z.string().min(1).max(200),
    dark_src_field: z.string().min(1).max(200).optional(),
  }).strict().transform(({ src_field, dark_src_field, ...icon }) => ({ ...icon, srcField: src_field, darkSrcField: dark_src_field })),
])

const seedPluginCollectionPropsSchema = z.object({
  presentation: z.object({
    layout: z.enum(['list', 'cards']),
    columns: z.number().int().min(1).max(4).optional(),
    item_icon: seedPluginCollectionItemIconSchema.optional(),
  }).strict().optional(),
  preview: z.object({
    mode: z.enum(['modal']),
    renderer: z.enum(['markdown']),
    frontmatter: z.enum(['show', 'hide']).default('show'),
    source: identifier,
    argument_bindings: z.record(identifier, z.string().min(1).max(200)).default({}),
    title_field: z.string().min(1).max(200),
    description_field: z.string().min(1).max(200).optional(),
    content_field: z.string().min(1).max(200),
    visible_when: seedPluginManagementConditionSchema.optional(),
  }).strict().transform(({ argument_bindings, title_field, description_field, content_field, visible_when, ...preview }) => ({
    ...preview,
    argumentBindings: argument_bindings,
    titleField: title_field,
    descriptionField: description_field,
    contentField: content_field,
    visibleWhen: visible_when,
  })).optional(),
}).passthrough()

const seedPluginPanelBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), value_path: z.string().min(1).max(200), label: seedLocalizedTextSchema(100).optional() }).strict(),
  z.object({ type: z.literal('status'), state_path: z.string().min(1).max(200), label_path: z.string().min(1).max(200).optional(), states: z.record(z.string(), seedLocalizedTextSchema(100)).default({}) }).strict(),
  z.object({ type: z.enum(['image', 'qr']), data_url_path: z.string().min(1).max(200), alt: seedLocalizedTextSchema(100).optional() }).strict(),
  z.object({ type: z.literal('progress'), value_path: z.string().min(1).max(200), max: z.number().positive().default(100), label: seedLocalizedTextSchema(100).optional() }).strict(),
])

const seedPluginPanelPropsSchema = z.object({
  blocks: z.array(seedPluginPanelBlockSchema).min(1).max(32),
}).strict()

export const seedPluginManagementViewSchema = z.object({
  id: identifier,
  renderer: identifier,
  title: seedLocalizedTextSchema(100),
  description: seedLocalizedTextSchema(500),
  source: seedPluginManagementSourceSchema.optional(),
  data_sources: z.record(identifier, seedPluginManagementDataSourceSchema).default({}),
  actions: z.array(seedPluginManagementActionSchema).max(16).default([]),
  toolbar: z.array(seedPluginManagementToolbarItemSchema).max(16).default([]),
  refresh_interval_ms: z.number().int().min(500).max(60_000).optional(),
  props: z.record(z.string(), z.unknown()).default({}),
}).strict().superRefine((view, context) => {
  const actions = new Map(view.actions.map((action) => [action.id, action]))
  const toolbarEntries = new Set<string>()
  for (const [index, item] of view.toolbar.entries()) {
    const key = item.type === 'refresh' ? 'refresh' : `action:${item.actionId}`
    if (toolbarEntries.has(key)) context.addIssue({ code: 'custom', path: ['toolbar', index], message: '工具栏项目不能重复。' })
    toolbarEntries.add(key)
    if (item.type !== 'action') continue
    const action = actions.get(item.actionId)
    if (!action) context.addIssue({ code: 'custom', path: ['toolbar', index, 'action_id'], message: `工具栏引用了不存在的动作：${item.actionId}` })
    else if (action.placement !== 'toolbar') context.addIssue({ code: 'custom', path: ['toolbar', index, 'action_id'], message: `工具栏动作的 placement 必须是 toolbar：${item.actionId}` })
  }
  for (const action of view.actions) {
    if (action.placement === 'toolbar' && !toolbarEntries.has(`action:${action.id}`)) {
      context.addIssue({ code: 'custom', path: ['actions'], message: `工具栏动作未被 toolbar 引用：${action.id}` })
    }
  }
  if (view.renderer === 'seed.panel') {
    const props = seedPluginPanelPropsSchema.safeParse(view.props)
    if (!props.success) context.addIssue({ code: 'custom', path: ['props'], message: '通用面板 props 无效。' })
    return
  }
  if (view.renderer !== 'seed.collection') return
  const props = seedPluginCollectionPropsSchema.safeParse(view.props)
  if (!props.success || !props.data.preview) return
  const preview = props.data.preview
  const source = view.data_sources[preview.source]
  if (!source) {
    context.addIssue({ code: 'custom', path: ['props', 'preview', 'source'], message: `预览引用了不存在的数据源：${preview.source}` })
    return
  }
  const parameters = new Set(source.parameters)
  for (const key of Object.keys(preview.argumentBindings)) {
    if (!parameters.has(key)) context.addIssue({ code: 'custom', path: ['props', 'preview', 'argument_bindings', key], message: `预览参数未由数据源声明：${key}` })
  }
}).transform(({ refresh_interval_ms, data_sources, ...view }) => ({
  ...view,
  dataSources: data_sources,
  props: view.renderer === 'seed.collection'
    ? seedPluginCollectionPropsSchema.parse(view.props)
    : view.renderer === 'seed.panel' ? seedPluginPanelPropsSchema.parse(view.props) : view.props,
  refreshIntervalMs: refresh_interval_ms,
}))

export const seedCapabilityMethodSchema = z.object({
  name: identifier,
  description: seedLocalizedTextSchema(500).optional(),
  risk: z.enum(['read', 'write', 'control']),
  input_schema: jsonSchema.optional(),
  output_schema: jsonSchema.optional(),
  annotations: z.record(identifier, z.unknown()).default({}),
}).strict().superRefine((method, context) => {
  if (method.annotations['mcp.tool'] === true) {
    const name = method.annotations['mcp.tool_name'] ?? method.name
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(name)) {
      context.addIssue({ code: 'custom', path: ['annotations', 'mcp.tool_name'], message: 'MCP 工具名称无效。' })
    }
    if (!method.description || !method.input_schema || method.input_schema.type !== 'object') {
      context.addIssue({ code: 'custom', path: ['annotations', 'mcp.tool'], message: 'MCP 工具必须声明双语描述和对象类型的输入 Schema。' })
    }
  }
  const settlement = method.annotations['billing.settlement']
  const relayTemplate = method.annotations['billing.relay_template']
  const billingProduct = method.annotations['billing.product']
  if (settlement !== undefined && settlement !== 'cloud_relay') {
    context.addIssue({ code: 'custom', path: ['annotations', 'billing.settlement'], message: '不支持的计费结算方式。' })
  }
  if (settlement === 'cloud_relay' && method.annotations['billing.exempt'] === true) {
    context.addIssue({ code: 'custom', path: ['annotations'], message: '云转发结算方法不能同时声明计费豁免。' })
  }
  if (method.annotations['billing.mode'] !== undefined) {
    context.addIssue({ code: 'custom', path: ['annotations', 'billing.mode'], message: '插件不能声明计费模式。' })
  }
  if (settlement === 'cloud_relay' && (typeof relayTemplate !== 'string' || typeof billingProduct !== 'string')) {
    context.addIssue({ code: 'custom', path: ['annotations'], message: '云转发方法必须声明转发模板和计费产品。' })
  }
  if (settlement !== 'cloud_relay' && (relayTemplate !== undefined || billingProduct !== undefined)) {
    context.addIssue({ code: 'custom', path: ['annotations'], message: '只有云转发方法可以声明转发模板和计费产品。' })
  }
}).transform(({ input_schema, output_schema, ...method }) => ({
  ...method,
  inputSchema: input_schema,
  outputSchema: output_schema,
}))

const seedCapabilityErrorsSchema = z.record(identifier, seedLocalizedTextSchema(500)).superRefine((errors, context) => {
  if (Object.keys(errors).length > 128) context.addIssue({ code: 'custom', message: '能力错误定义不能超过 128 项。' })
})

export const seedCapabilityManifestSchema = z.object({
  id: identifier,
  version: z.number().int().positive(),
  exposure: z.enum(['terminal', 'plugin', 'local']).default('terminal'),
  description: seedLocalizedTextSchema(1_000).optional(),
  annotations: z.record(identifier, z.unknown()).default({}),
  errors: seedCapabilityErrorsSchema.default({}),
  methods: z.array(seedCapabilityMethodSchema).min(1),
}).strict().superRefine((value, context) => {
  const names = new Set<string>()
  for (const [index, method] of value.methods.entries()) {
    if (names.has(method.name)) {
      context.addIssue({ code: 'custom', path: ['methods', index, 'name'], message: `重复的方法：${method.name}` })
    }
    names.add(method.name)
  }
})

export const seedPluginManifestSchema = z.object({
  schema_version: z.literal(1).default(1),
  id: pluginIdentifier,
  name: seedLocalizedTextSchema(100),
  description: seedLocalizedTextSchema(500).optional(),
  labels: seedPluginLabelsSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  min_seed_version: z.string().regex(seedVersionPattern),
  api_version: z.literal('1').default('1'),
  publisher: z.string().min(1).max(100),
  icon: assetEntry,
  icon_dark: assetEntry.optional(),
  detail_presentation: seedPluginDetailPresentationSchema.optional(),
  runtime: z.object({
    kind: z.enum(['sandboxed-web', 'native-host']),
  }).strict(),
  caps: z.array(relativeEntry).min(1),
  permissions: z.array(identifier).default([]),
  consumes: z.array(seedConsumedCapabilitySchema).default([]),
  sidecars: z.array(seedPluginSidecarSchema).max(8).default([]),
}).strict().transform(({ schema_version, api_version, min_seed_version, icon_dark, detail_presentation, caps, ...manifest }) => ({
  ...manifest,
  schemaVersion: schema_version,
  apiVersion: api_version,
  minSeedVersion: min_seed_version,
  iconDark: icon_dark,
  detailPresentation: detail_presentation,
  capabilityPaths: caps,
})).superRefine((value, context) => {
  const paths = new Set<string>()
  for (const [index, path] of value.capabilityPaths.entries()) {
    if (paths.has(path)) {
      context.addIssue({ code: 'custom', path: ['caps', index], message: `重复的能力清单路径：${path}` })
    }
    paths.add(path)
  }
  const consumed = new Set<string>()
  for (const [index, declaration] of value.consumes.entries()) {
    const key = 'capability' in declaration
      ? `capability:${declaration.capability}`
      : `match:${declaration.match.method_annotation}:${JSON.stringify(declaration.match.equals)}`
    if (consumed.has(key)) {
      context.addIssue({
        code: 'custom',
        path: ['consumes', index, 'capability' in declaration ? 'capability' : 'match'],
        message: '重复的能力消费声明。',
      })
    }
    consumed.add(key)
  }
  const sidecarIds = new Set<string>()
  const sidecarPaths = new Set<string>()
  for (const [index, sidecar] of value.sidecars.entries()) {
    if (sidecarIds.has(sidecar.id)) context.addIssue({ code: 'custom', path: ['sidecars', index, 'id'], message: `重复的 Sidecar ID：${sidecar.id}` })
    if (sidecarPaths.has(sidecar.path)) context.addIssue({ code: 'custom', path: ['sidecars', index, 'path'], message: `重复的 Sidecar 路径：${sidecar.path}` })
    sidecarIds.add(sidecar.id)
    sidecarPaths.add(sidecar.path)
  }
  if (value.sidecars.length && !value.permissions.includes('process.sidecar')) {
    context.addIssue({ code: 'custom', path: ['permissions'], message: '声明 Sidecar 的插件必须申请 process.sidecar 权限。' })
  }
  for (const [index, permission] of value.permissions.entries()) {
    if ((permission === 'network' || permission.startsWith('network.')) && !seedNetworkPermissionSet.has(permission)) {
      context.addIssue({ code: 'custom', path: ['permissions', index], message: `网络权限必须是：${seedNetworkPermissions.join('、')}` })
    }
  }
})

export type SeedCapabilityMethodManifest = z.infer<typeof seedCapabilityMethodSchema>
export type SeedCapabilityDocument = z.infer<typeof seedCapabilityManifestSchema>
export type SeedCapabilityManifest = SeedCapabilityDocument
export type SeedPluginLabel = z.infer<typeof seedPluginLabelSchema>
export type SeedPluginManifestDocument = z.infer<typeof seedPluginManifestSchema>
export type SeedConsumedCapability = z.infer<typeof seedConsumedCapabilitySchema>
export type SeedPluginSidecar = z.infer<typeof seedPluginSidecarSchema>
export type SeedPluginDetailPresentation = z.infer<typeof seedPluginDetailPresentationSchema>
export type SeedPluginConfiguration = z.infer<typeof seedPluginConfigurationSchema>
export type SeedPluginManagementView = z.infer<typeof seedPluginManagementViewSchema>
export type SeedPluginManifest = SeedPluginManifestDocument & {
  capabilities: SeedCapabilityManifest[]
}
