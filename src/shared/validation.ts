import { z } from 'zod'
import { seedLocalizedTextSchema, seedPluginLabelsSchema } from './plugin-manifest'
import { seedVersionPattern } from './seed-version'

export const serverUrlSchema = z.string().trim().min(1).transform((value, context) => {
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('unsupported protocol')
    if (url.username || url.password || url.search || url.hash) throw new Error('unexpected URL components')
    url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString().replace(/\/$/, '')
  } catch {
    context.addIssue({ code: 'custom', message: '请输入有效的 HTTP 或 HTTPS 服务地址。' })
    return z.NEVER
  }
})

const httpUrlSchema = z.string().url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol))

export const seedDistributionSchema = z.object({
  ver: z.literal(3),
  dist_id: z.string().min(1).max(128),
  auth: z.object({
    issuer: httpUrlSchema,
    client_id: z.string().min(1).max(128),
    redirect_uri: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+:\/oauth\/callback$/i),
    authorization_endpoint: httpUrlSchema,
    token_endpoint: httpUrlSchema,
    userinfo_endpoint: httpUrlSchema,
    revocation_endpoint: httpUrlSchema,
  }).strict(),
  market_url: httpUrlSchema.nullable(),
  update_url: httpUrlSchema.nullable(),
  events_url: httpUrlSchema,
  exp: z.number().int().positive(),
}).strict()

const seedDistributionEventBaseSchema = z.object({
  ver: z.literal(1),
  dist_id: z.string().min(1).max(128),
  revision: z.string().uuid(),
  occurred_at: z.string().datetime(),
})

export const seedDistributionEventSchema = z.discriminatedUnion('type', [
  seedDistributionEventBaseSchema.extend({ type: z.literal('plugin.catalog.changed') }),
  seedDistributionEventBaseSchema.extend({
    type: z.literal('client.release.changed'),
    channel: z.enum(['stable', 'beta']),
    platform: z.enum(['win-x64', 'win-arm64', 'mac-x64', 'mac-arm64', 'mac-universal', 'linux-x64', 'linux-arm64']),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).max(80),
  }),
])

export const signedSeedDistributionSchema = z.object({
  alg: z.literal('EdDSA'),
  kid: z.string().min(1).max(128),
  payload: seedDistributionSchema,
  sig: z.string().min(1),
}).strict()

export const auditQuerySchema = z.object({
  query: z.string().max(500).optional(),
  category: z.enum(['all', 'capabilities', 'permissions', 'plugins', 'system']).optional(),
  status: z.enum(['all', 'attention']).optional(),
  risk: z.enum(['all', 'read', 'write', 'control']).optional(),
  cursor: z.string().max(1_000).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict()

const pluginAuditMetadataSchema = z.object({
  client_id: z.string().trim().min(1).max(128).optional(),
  client_name: z.string().trim().min(1).max(100).optional(),
  workspace_id: z.string().trim().min(1).max(128).optional(),
  conversation_id: z.string().trim().min(1).max(256).optional(),
  model_profile_id: z.string().trim().min(1).max(128).optional(),
  thinking_level: z.string().trim().min(1).max(32).optional(),
  duration_ms: z.number().int().nonnegative().max(86_400_000).optional(),
  input_length: z.number().int().nonnegative().max(10_000_000).optional(),
  output_length: z.number().int().nonnegative().max(10_000_000).optional(),
  attachment_count: z.number().int().nonnegative().max(100).optional(),
  provider_plugin_id: z.string().trim().min(1).max(128).optional(),
  capability_id: z.string().trim().min(1).max(128).optional(),
  capability_method: z.string().trim().min(1).max(128).optional(),
}).strict()

export const pluginAuditRecordSchema = z.object({
  operation: z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){0,3}$/).max(80),
  outcome: z.enum(['allowed', 'denied', 'failed']),
  visibility: z.enum(['activity', 'technical']).optional(),
  summary: seedLocalizedTextSchema(500).optional(),
  risk: z.enum(['read', 'write', 'control']).optional(),
  run_id: z.string().trim().min(1).max(256).optional(),
  request_id: z.string().trim().min(1).max(256).optional(),
  error_code: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/).optional(),
  metadata: pluginAuditMetadataSchema.optional(),
}).strict()

export const terminalLogUploadRangeSchema = z.object({
  days: z.union([z.literal(1), z.literal(3), z.literal(7)]),
}).strict()

const catalogMethodSchema = z.object({
  name: z.string(),
  description: seedLocalizedTextSchema(500).optional(),
  risk: z.enum(['read', 'write', 'control']),
}).strict()

const catalogCapabilitySchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  exposure: z.enum(['terminal', 'plugin', 'local']).optional(),
  description: seedLocalizedTextSchema(1_000).optional(),
  methods: z.array(catalogMethodSchema),
}).strict()

const seedCatalogPluginWireSchema = z.object({
  plugin_id: z.string(),
  visibility: z.enum(['public', 'organization']),
  organization: z.object({ id: z.string().uuid(), name: z.string().min(1).max(120) }).nullable(),
  name: seedLocalizedTextSchema(100),
  description: seedLocalizedTextSchema(500),
  readme: seedLocalizedTextSchema(5 * 1024 * 1024).optional(),
  labels: seedPluginLabelsSchema,
  publisher_id: z.string(),
  publisher_type: z.enum(['official', 'community']),
  latest_version: z.string(),
  package_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  package_size: z.number().int().positive(),
  api_version: z.literal('1'),
  min_seed_version: z.string().regex(seedVersionPattern).nullable(),
  runtime_kind: z.enum(['sandboxed-web', 'native-host']),
  permissions: z.array(z.string()),
  capabilities: z.array(catalogCapabilitySchema),
  compatible: z.boolean(),
  published_at: z.string(),
  icon_url: z.string().min(1).max(512).nullable(),
  icon_dark_url: z.string().min(1).max(512).nullable(),
  download_url: z.string().min(1).max(512),
  platform: z.enum(['darwin', 'win32', 'linux']),
  architecture: z.enum(['arm64', 'x64']),
}).refine((plugin) => plugin.visibility === 'public' ? plugin.organization === null : plugin.organization !== null, {
  path: ['organization'],
  message: 'Enterprise plugins require exactly one enterprise',
}).transform(({
  plugin_id,
  publisher_id,
  publisher_type,
  latest_version,
  package_sha256,
  package_size,
  api_version,
  min_seed_version,
  runtime_kind,
  compatible,
  published_at,
  icon_url,
  icon_dark_url,
  download_url,
  platform,
  architecture,
  ...plugin
}) => ({
  ...plugin,
  id: plugin_id,
  publisher: publisher_id,
  publisherType: publisher_type,
  latestVersion: latest_version,
  packageSha256: package_sha256,
  packageSize: package_size,
  apiVersion: api_version,
  minSeedVersion: min_seed_version,
  runtimeKind: runtime_kind,
  compatible,
  publishedAt: published_at,
  iconUrl: icon_url ?? undefined,
  iconDarkUrl: icon_dark_url ?? undefined,
  versions: [{
    version: latest_version,
    platform,
    architecture,
    packageSha256: package_sha256,
    packageSize: package_size,
    apiVersion: api_version,
    minSeedVersion: min_seed_version,
    runtimeKind: runtime_kind,
    permissions: plugin.permissions,
    capabilities: plugin.capabilities,
    publishedAt: published_at,
    downloadUrl: download_url,
  }],
}))

export const seedCatalogResponseSchema = z.object({
  items: z.array(seedCatalogPluginWireSchema).superRefine((items, context) => {
    const ids = new Set<string>()
    for (const [index, item] of items.entries()) {
      if (ids.has(item.id)) context.addIssue({ code: 'custom', path: [index, 'plugin_id'], message: `重复插件：${item.id}` })
      ids.add(item.id)
    }
  }),
  next_cursor: z.string().nullable(),
}).strict()

export const pluginIdSchema = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/)

export const installPluginSchema = z.object({
  pluginId: pluginIdSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
}).strict()
