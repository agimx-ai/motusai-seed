import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { safeStorage } from 'electron'
import createKnex, { type Knex } from 'knex'
import { activityCategory, activityRisk } from '../shared/activity'
import type { AuditCategory, AuditEntry, AuditMetadata, AuditOutcome, AuditPage, AuditQueryInput, LocalClientAuthorization, SeedLanguagePreference, SeedThemePreference, StoredPluginConfiguration, UsageSummary } from '../shared/contracts'
import type { CloudSessionCredential } from './cloud-auth'
import { ObservationStore, observationDatabaseFileName } from './observation-store'
import type { ClientReleaseReadState } from './client-release-notes'

type StoredConfig = { encryptedCloudSession?: string; encryptedPluginConfigurations?: string; encryptedPluginSecrets?: string; preventSystemSleep: boolean; languagePreference: SeedLanguagePreference; themePreference: SeedThemePreference }
type SettingRow = { key: string; value: string }
type LocalClientRow = {
  id: string
  client_id: string
  installation_id: string
  display_name: string
  device_name: string | null
  token_hash: string
  created_at: string
  updated_at: string
}
type LegacyLocalClientRow = Omit<LocalClientRow, 'device_name'> & { plugin_id: string; device_name?: string | null }
type LocalClientScopeRow = { auth_id: string; plugin_id: string; created_at: string }
type LegacyLocalClientScopeRow = { authorization_id: string; plugin_id: string; created_at: string }
type AuditRow = {
  id: string; timestamp: string; source: AuditEntry['source']; operation: string; category: Exclude<AuditCategory, 'all'>
  capability: string | null; method: string | null; risk: NonNullable<AuditEntry['risk']>; task_id: string | null
  run_id: string | null; request_id: string | null; approval_id: string | null; error_code: string | null
  grant_id: string | null; relative_path: string | null; outcome: AuditOutcome; summary: string; metadata: string | null
  record_kind: 'activity' | 'span' | 'event'; visibility: 'activity' | 'technical'; trace_id: string | null
  span_id: string | null; parent_span_id: string | null; ended_at: string | null; duration_ms: number | null
  level: string | null; component: string | null; plugin_id: string | null; plugin_version: string | null
  event_name: string | null; error_message: string | null; error_name: string | null; error_stack: string | null
  diagnostic_details: string | null; session_id: string | null; evidence_origin: 'host' | 'plugin'
}

const defaults = (): StoredConfig => ({
  preventSystemSleep: false,
  languagePreference: 'system',
  themePreference: 'system',
})

function toAuditRow(entry: AuditEntry): AuditRow {
  return {
    id: entry.id, timestamp: entry.timestamp, source: entry.source, operation: entry.operation, category: activityCategory(entry),
    capability: entry.capability ?? null, method: entry.method ?? null, risk: activityRisk(entry), task_id: entry.taskId ?? null,
    run_id: entry.runId ?? null, request_id: entry.requestId ?? null, approval_id: entry.approvalId ?? null,
    error_code: entry.errorCode ?? null, grant_id: entry.grantId ?? null, relative_path: entry.relativePath ?? null,
    outcome: entry.outcome, summary: entry.summary, metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    record_kind: entry.recordKind || 'activity', visibility: entry.visibility || 'activity',
    trace_id: entry.traceId ?? null, span_id: entry.spanId ?? null, parent_span_id: entry.parentSpanId ?? null,
    ended_at: entry.endedAt ?? null, duration_ms: entry.durationMs ?? null,
    level: entry.level ?? null, component: entry.component ?? null,
    plugin_id: entry.pluginId ?? null, plugin_version: entry.pluginVersion ?? null,
    event_name: entry.eventName ?? null, error_message: entry.errorMessage ?? null,
    error_name: entry.errorName ?? null, error_stack: entry.errorStack ?? null,
    diagnostic_details: entry.diagnosticDetails ? JSON.stringify(entry.diagnosticDetails) : null,
    session_id: null, evidence_origin: entry.evidenceOrigin || 'host',
  }
}

function parseAuditMetadata(value: string | null): AuditMetadata | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as AuditMetadata : undefined
  } catch { return undefined }
}

function fromAuditRow(row: AuditRow): AuditEntry {
  const metadata = parseAuditMetadata(row.metadata)
  return {
    id: row.id, timestamp: row.timestamp, source: row.source, operation: row.operation, risk: row.risk, outcome: row.outcome, summary: row.summary,
    ...(row.capability ? { capability: row.capability } : {}), ...(row.method ? { method: row.method } : {}),
    ...(row.task_id ? { taskId: row.task_id } : {}), ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.request_id ? { requestId: row.request_id } : {}), ...(row.approval_id ? { approvalId: row.approval_id } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}), ...(row.grant_id ? { grantId: row.grant_id } : {}),
    ...(row.relative_path ? { relativePath: row.relative_path } : {}),
    ...(metadata ? { metadata } : {}),
    recordKind: row.record_kind, visibility: row.visibility,
    ...(row.trace_id ? { traceId: row.trace_id } : {}), ...(row.span_id ? { spanId: row.span_id } : {}),
    ...(row.parent_span_id ? { parentSpanId: row.parent_span_id } : {}),
    ...(row.ended_at ? { endedAt: row.ended_at } : {}),
    ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
    ...(row.level ? { level: row.level as AuditEntry['level'] } : {}),
    ...(row.component ? { component: row.component } : {}),
    ...(row.plugin_id ? { pluginId: row.plugin_id } : {}),
    ...(row.plugin_version ? { pluginVersion: row.plugin_version } : {}),
    ...(row.error_name ? { errorName: row.error_name } : {}),
    ...(row.error_stack ? { errorStack: row.error_stack } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    ...(row.event_name ? { eventName: row.event_name } : {}),
    evidenceOrigin: row.evidence_origin,
    ...(row.diagnostic_details ? { diagnosticDetails: JSON.parse(row.diagnostic_details) as AuditEntry['diagnosticDetails'] } : {}),
  }
}

function encodeAuditCursor(row: Pick<AuditRow, 'id' | 'timestamp'>) {
  return Buffer.from(JSON.stringify([row.timestamp, row.id]), 'utf8').toString('base64url')
}

function decodeAuditCursor(cursor?: string) {
  if (!cursor) return undefined
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(value) || value.length !== 2 || value.some((item) => typeof item !== 'string')) throw new Error('invalid cursor')
    return { timestamp: value[0] as string, id: value[1] as string }
  } catch { throw new Error('活动记录分页游标无效。') }
}

function escapedLikePattern(value: string) {
  return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
}

export class SeedStore {
  readonly databasePath: string
  readonly observations: ObservationStore
  private readonly ownsObservations: boolean
  private value: StoredConfig = defaults()
  private database: Knex | null = null
  private recentAudit: AuditEntry[] = []

  constructor(userDataPath: string, appName: string, observations?: ObservationStore) {
    this.databasePath = join(userDataPath, observationDatabaseFileName(appName))
    this.observations = observations || new ObservationStore(userDataPath, appName)
    this.ownsObservations = !observations
  }

  async load() {
    await mkdir(dirname(this.databasePath), { recursive: true })
    await this.initializeDatabase()
    await chmod(this.databasePath, 0o600)
    await this.loadCachedState()
  }

  private async initializeDatabase() {
    this.database = createKnex({
      client: 'better-sqlite3', connection: { filename: this.databasePath }, useNullAsDefault: true,
      pool: {
        min: 1, max: 1,
        afterCreate(connection: { pragma: (value: string) => unknown }, done: (error: Error | null, connection: unknown) => void) {
          try {
            connection.pragma('journal_mode = WAL'); connection.pragma('foreign_keys = ON'); connection.pragma('busy_timeout = 5000'); done(null, connection)
          } catch (error) { done(error instanceof Error ? error : new Error(String(error)), connection) }
        },
      },
    })
    const database = this.getDatabase()
    if (!await database.schema.hasTable('app_settings')) await database.schema.createTable('app_settings', (table) => { table.text('key').primary(); table.text('value').notNullable() })
    if (await database.schema.hasTable('plugin_capability_grants')) await database.schema.dropTable('plugin_capability_grants')
    await this.initializeLocalClientAuthorizationSchema(database)
  }

  private async initializeLocalClientAuthorizationSchema(database: Knex) {
    const tableName = 'local_client_authorizations'
    const scopeTableName = 'local_client_authorization_scopes'
    const exists = await database.schema.hasTable(tableName)
    const legacy = exists && await database.schema.hasColumn(tableName, 'plugin_id')
    const legacyRows = legacy ? await database<LegacyLocalClientRow>(tableName).select('*') : []
    if (legacy) {
      await database.transaction(async (transaction) => {
        if (await transaction.schema.hasTable(scopeTableName)) await transaction.schema.dropTable(scopeTableName)
        await transaction.schema.dropTable(tableName)
        await this.createLocalClientAuthorizationTables(transaction)
        const identities = new Map<string, LegacyLocalClientRow[]>()
        for (const row of legacyRows) {
          const key = `${row.client_id}\0${row.installation_id}`
          const rows = identities.get(key)
          if (rows) rows.push(row)
          else identities.set(key, [row])
        }
        for (const rows of identities.values()) {
          const selected = [...rows].sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0]!
          await transaction<LocalClientRow>(tableName).insert({
            id: selected.id,
            client_id: selected.client_id,
            installation_id: selected.installation_id,
            display_name: selected.display_name,
            device_name: selected.device_name ?? null,
            token_hash: selected.token_hash,
            created_at: rows.reduce((earliest, row) => row.created_at < earliest ? row.created_at : earliest, rows[0]!.created_at),
            updated_at: selected.updated_at,
          })
          for (const pluginId of new Set(rows.map((row) => row.plugin_id))) {
            const source = rows.find((row) => row.plugin_id === pluginId)!
            await transaction<LocalClientScopeRow>(scopeTableName).insert({ auth_id: selected.id, plugin_id: pluginId, created_at: source.created_at })
          }
        }
      })
      return
    }
    if (!exists) {
      await this.createLocalClientAuthorizationTables(database)
      return
    }
    if (!await database.schema.hasColumn(tableName, 'device_name')) {
      await database.schema.alterTable(tableName, (table) => table.text('device_name'))
    }
    if (!await database.schema.hasTable(scopeTableName)) {
      await this.createLocalClientScopeTable(database)
      return
    }
    if (!await database.schema.hasColumn(scopeTableName, 'auth_id')) {
      if (!await database.schema.hasColumn(scopeTableName, 'authorization_id')) {
        throw new Error('本地客户端授权范围表结构无法识别。')
      }
      const scopeRows = await database<LegacyLocalClientScopeRow>(scopeTableName).select('*')
      await database.transaction(async (transaction) => {
        await transaction.schema.dropTable(scopeTableName)
        await this.createLocalClientScopeTable(transaction)
        if (scopeRows.length) {
          await transaction<LocalClientScopeRow>(scopeTableName).insert(scopeRows.map((row) => ({
            auth_id: row.authorization_id,
            plugin_id: row.plugin_id,
            created_at: row.created_at,
          })))
        }
      })
    }
  }

  private async createLocalClientAuthorizationTables(database: Knex | Knex.Transaction) {
    await database.schema.createTable('local_client_authorizations', (table) => {
      table.text('id').primary(); table.text('client_id').notNullable(); table.text('installation_id').notNullable()
      table.text('display_name').notNullable(); table.text('device_name'); table.text('token_hash').notNullable().unique(); table.text('created_at').notNullable(); table.text('updated_at').notNullable()
      table.unique(['client_id', 'installation_id'], { indexName: 'local_client_identity_unique' })
    })
    await this.createLocalClientScopeTable(database)
  }

  private async createLocalClientScopeTable(database: Knex | Knex.Transaction) {
    await database.schema.createTable('local_client_authorization_scopes', (table) => {
      table.text('auth_id').notNullable(); table.text('plugin_id').notNullable(); table.text('created_at').notNullable()
      table.primary(['auth_id', 'plugin_id'])
      table.foreign('auth_id').references('id').inTable('local_client_authorizations').onDelete('CASCADE')
      table.index(['plugin_id', 'auth_id'], 'local_client_scope_plugin_index')
    })
  }

  private async loadCachedState() {
    const database = this.getDatabase()
    await database<SettingRow>('app_settings').whereIn('key', [
      'encrypted_transcription_api_key',
      'transcription_model',
      'transcription_base_url',
      'encrypted_chat_model_configuration',
      'terminal_id',
      'encrypted_token',
    ]).delete()
    const settings = new Map((await database<SettingRow>('app_settings').select('*')).map((row) => [row.key, row.value]))
    const language = settings.get('language_preference')
    this.value = {
      encryptedCloudSession: settings.get('encrypted_cloud_session'), encryptedPluginConfigurations: settings.get('encrypted_plugin_configurations'), encryptedPluginSecrets: settings.get('encrypted_plugin_secrets'), preventSystemSleep: settings.get('prevent_system_sleep') === 'true',
      languagePreference: language === 'zh-CN' || language === 'en-US' ? language : 'system',
      themePreference: settings.get('theme_preference') === 'light' || settings.get('theme_preference') === 'dark' ? settings.get('theme_preference') as SeedThemePreference : 'system',
    }
    this.recentAudit = await this.loadRecentAudit()
  }

  private getDatabase() { if (!this.database) throw new Error('客户端数据库尚未初始化。'); return this.database }
  private async setSetting(key: string, value?: string) {
    const table = this.getDatabase()<SettingRow>('app_settings')
    if (value === undefined) await table.where({ key }).delete(); else await table.insert({ key, value }).onConflict('key').merge({ value })
  }
  private async loadRecentAudit(limit = 50) {
    const rows = await this.getDatabase()<AuditRow>('observation_records').select('*').where({ visibility: 'activity' })
      .whereNull('parent_span_id').orderBy('timestamp', 'desc').orderBy('id', 'desc').limit(limit)
    return rows.map(fromAuditRow)
  }

  cloudSession(): CloudSessionCredential | undefined {
    if (!this.value.encryptedCloudSession || !safeStorage.isEncryptionAvailable()) return undefined
    try {
      const value = JSON.parse(safeStorage.decryptString(Buffer.from(this.value.encryptedCloudSession, 'base64'))) as CloudSessionCredential
      if (!value.accessToken || !value.refreshToken || !value.accessExpiresAt || !value.refreshExpiresAt || !value.user?.id || !value.user.displayName) return undefined
      return value
    } catch { return undefined }
  }
  async setCloudSession(session: CloudSessionCredential) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法安全保存登录凭据。')
    const encrypted = safeStorage.encryptString(JSON.stringify(session)).toString('base64')
    await this.setSetting('encrypted_cloud_session', encrypted)
    this.value.encryptedCloudSession = encrypted
  }
  async clearCloudSession() {
    await this.setSetting('encrypted_cloud_session')
    this.value.encryptedCloudSession = undefined
  }
  preventSystemSleep() { return this.value.preventSystemSleep }
  async setPreventSystemSleep(enabled: boolean) { await this.setSetting('prevent_system_sleep', JSON.stringify(enabled)); this.value.preventSystemSleep = enabled }
  languagePreference() { return this.value.languagePreference }
  async setLanguagePreference(preference: SeedLanguagePreference) { await this.setSetting('language_preference', preference); this.value.languagePreference = preference }
  themePreference() { return this.value.themePreference }
  async clientReleaseReadState(): Promise<ClientReleaseReadState | undefined> {
    const row = await this.getDatabase()<SettingRow>('app_settings').where({ key: 'client_release_read_state' }).first()
    return row ? JSON.parse(row.value) as ClientReleaseReadState : undefined
  }
  async setClientReleaseReadState(state: ClientReleaseReadState) {
    await this.setSetting('client_release_read_state', JSON.stringify(state))
  }
  async setThemePreference(preference: SeedThemePreference) { await this.setSetting('theme_preference', preference); this.value.themePreference = preference }
  private pluginConfigurations(): Record<string, StoredPluginConfiguration> {
    if (!this.value.encryptedPluginConfigurations || !safeStorage.isEncryptionAvailable()) return {}
    try {
      const value = JSON.parse(safeStorage.decryptString(Buffer.from(this.value.encryptedPluginConfigurations, 'base64'))) as unknown
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, StoredPluginConfiguration> : {}
    } catch { return {} }
  }
  pluginConfiguration(key: string): StoredPluginConfiguration | undefined {
    const value = this.pluginConfigurations()[key]
    return value?.schema_version === 1 ? { schema_version: 1, profiles: value.profiles.map((profile) => ({ ...profile })), default_profile_id: value.default_profile_id, values: { ...value.values } } : undefined
  }
  async setPluginConfiguration(key: string, configuration: StoredPluginConfiguration) {
    await this.setPluginConfigurations({ [key]: configuration })
  }
  async setPluginConfigurations(updates: Record<string, StoredPluginConfiguration>) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法安全保存插件配置。')
    const configurations = this.pluginConfigurations()
    Object.assign(configurations, updates)
    const encrypted = safeStorage.encryptString(JSON.stringify(configurations)).toString('base64')
    await this.setSetting('encrypted_plugin_configurations', encrypted)
    this.value.encryptedPluginConfigurations = encrypted
  }
  async removePluginConfigurations(pluginId: string) {
    const configurations = this.pluginConfigurations()
    let changed = false
    for (const key of Object.keys(configurations)) {
      if (!key.startsWith(`${pluginId}:`)) continue
      delete configurations[key]
      changed = true
    }
    if (!changed) return
    const encrypted = Object.keys(configurations).length ? safeStorage.encryptString(JSON.stringify(configurations)).toString('base64') : undefined
    await this.setSetting('encrypted_plugin_configurations', encrypted)
    this.value.encryptedPluginConfigurations = encrypted
  }
  private pluginSecrets(): Record<string, Record<string, string>> {
    if (!this.value.encryptedPluginSecrets || !safeStorage.isEncryptionAvailable()) return {}
    try {
      const value = JSON.parse(safeStorage.decryptString(Buffer.from(this.value.encryptedPluginSecrets, 'base64'))) as unknown
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Record<string, string>> : {}
    } catch { return {} }
  }
  pluginSecret(pluginId: string, key: string) { return this.pluginSecrets()[pluginId]?.[key] }
  async setPluginSecret(pluginId: string, key: string, value: string) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法安全保存插件私密凭据。')
    const secrets = this.pluginSecrets()
    secrets[pluginId] = { ...(secrets[pluginId] || {}), [key]: value }
    const encrypted = safeStorage.encryptString(JSON.stringify(secrets)).toString('base64')
    await this.setSetting('encrypted_plugin_secrets', encrypted)
    this.value.encryptedPluginSecrets = encrypted
  }
  async removePluginSecret(pluginId: string, key: string) {
    const secrets = this.pluginSecrets()
    if (!secrets[pluginId] || !(key in secrets[pluginId])) return
    delete secrets[pluginId]![key]
    if (!Object.keys(secrets[pluginId]!).length) delete secrets[pluginId]
    const encrypted = Object.keys(secrets).length ? safeStorage.encryptString(JSON.stringify(secrets)).toString('base64') : undefined
    await this.setSetting('encrypted_plugin_secrets', encrypted)
    this.value.encryptedPluginSecrets = encrypted
  }
  async removePluginSecrets(pluginId: string) {
    const secrets = this.pluginSecrets()
    if (!secrets[pluginId]) return
    delete secrets[pluginId]
    const encrypted = Object.keys(secrets).length ? safeStorage.encryptString(JSON.stringify(secrets)).toString('base64') : undefined
    await this.setSetting('encrypted_plugin_secrets', encrypted)
    this.value.encryptedPluginSecrets = encrypted
  }
  pluginDataIds() {
    const ids = new Set<string>()
    for (const [encrypted, configurations] of [
      [this.value.encryptedPluginConfigurations, true],
      [this.value.encryptedPluginSecrets, false],
    ] as const) {
      if (!encrypted) continue
      if (!safeStorage.isEncryptionAvailable()) throw new Error('无法读取安全存储，已停止清理插件数据。')
      const value: unknown = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64')))
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('插件安全存储格式无效，已停止清理。')
      for (const key of Object.keys(value)) ids.add(configurations ? key.split(':')[0]! : key)
    }
    return [...ids]
  }
  async installedPluginState(): Promise<unknown | undefined> {
    const row = await this.getDatabase()<SettingRow>('app_settings').where({ key: 'installed_plugin_state' }).first()
    if (!row) return undefined
    try { return JSON.parse(row.value) as unknown } catch { throw new Error('数据库中的插件安装状态无效。') }
  }
  async setInstalledPluginState(state: unknown) { await this.setSetting('installed_plugin_state', JSON.stringify(state)) }
  async localClients(): Promise<LocalClientAuthorization[]> {
    const rows = await this.getDatabase()<LocalClientRow>('local_client_authorizations').select('*').orderBy('created_at', 'asc')
    const scopes = await this.getDatabase()<LocalClientScopeRow>('local_client_authorization_scopes').select('*')
    const pluginIdsByAuthorization = new Map<string, string[]>()
    for (const scope of scopes) {
      const pluginIds = pluginIdsByAuthorization.get(scope.auth_id)
      if (pluginIds) pluginIds.push(scope.plugin_id)
      else pluginIdsByAuthorization.set(scope.auth_id, [scope.plugin_id])
    }
    return rows.map((row) => ({
      id: row.id,
      pluginIds: (pluginIdsByAuthorization.get(row.id) || []).sort(),
      clientId: row.client_id,
      installationId: row.installation_id,
      displayName: row.display_name,
      ...(row.device_name ? { deviceName: row.device_name } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }
  async authorizeLocalClient(input: {
    pluginId: string
    clientId: string
    installationId: string
    displayName: string
    deviceName?: string
    token: string
  }) {
    const now = new Date().toISOString()
    const tokenHash = createHash('sha256').update(input.token).digest('hex')
    return await this.getDatabase().transaction(async (transaction) => {
      const existing = await transaction<LocalClientRow>('local_client_authorizations').where({ client_id: input.clientId, installation_id: input.installationId }).first()
      const row: LocalClientRow = {
        id: existing?.id ?? randomUUID(), client_id: input.clientId, installation_id: input.installationId,
        display_name: input.displayName, device_name: input.deviceName ?? existing?.device_name ?? null,
        token_hash: tokenHash, created_at: existing?.created_at ?? now, updated_at: now,
      }
      await transaction<LocalClientRow>('local_client_authorizations').insert(row).onConflict(['client_id', 'installation_id']).merge(row)
      await transaction<LocalClientScopeRow>('local_client_authorization_scopes').insert({
        auth_id: row.id, plugin_id: input.pluginId, created_at: now,
      }).onConflict(['auth_id', 'plugin_id']).ignore()
      return row.id
    })
  }
  async localClientAuthorizationId(pluginId: string, token: string) {
    if (!token) return null
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const row = await this.getDatabase()('local_client_authorizations as authorization')
      .join('local_client_authorization_scopes as scope', 'scope.auth_id', 'authorization.id')
      .where({ 'scope.plugin_id': pluginId, 'authorization.token_hash': tokenHash })
      .select<{ id: string }[]>('authorization.id').first()
    return row?.id ?? null
  }
  async localClientByIdentity(clientId: string, installationId: string) {
    const row = await this.getDatabase()<LocalClientRow>('local_client_authorizations').where({ client_id: clientId, installation_id: installationId }).first()
    if (!row) return null
    const pluginIds = (await this.getDatabase()<LocalClientScopeRow>('local_client_authorization_scopes').where({ auth_id: row.id }))
      .map((scope) => scope.plugin_id).sort()
    return {
      id: row.id,
      pluginIds,
      clientId: row.client_id,
      installationId: row.installation_id,
      displayName: row.display_name,
      ...(row.device_name ? { deviceName: row.device_name } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
  async updateLocalClientMetadata(id: string, input: { displayName: string; deviceName?: string }) {
    const updatedAt = new Date().toISOString()
    await this.getDatabase()<LocalClientRow>('local_client_authorizations').where({ id }).update({
      display_name: input.displayName,
      ...(input.deviceName ? { device_name: input.deviceName } : {}),
      updated_at: updatedAt,
    })
  }
  async matchesLocalClientToken(authorizationId: string, token: string) {
    if (!authorizationId || !token) return false
    const tokenHash = createHash('sha256').update(token).digest('hex')
    return Boolean(await this.getDatabase()<LocalClientRow>('local_client_authorizations').where({ id: authorizationId, token_hash: tokenHash }).first())
  }
  async hasLocalClientAuthorization(pluginId: string, authorizationId: string) {
    if (!authorizationId) return false
    return Boolean(await this.getDatabase()<LocalClientScopeRow>('local_client_authorization_scopes').where({ auth_id: authorizationId, plugin_id: pluginId }).first())
  }
  async removePluginLocalClientAuthorizations(pluginId: string) {
    await this.getDatabase().transaction(async (transaction) => {
      const affected = await transaction<LocalClientScopeRow>('local_client_authorization_scopes')
        .where({ plugin_id: pluginId })
        .select('auth_id')
      await transaction<LocalClientScopeRow>('local_client_authorization_scopes').where({ plugin_id: pluginId }).delete()
      for (const { auth_id: authorizationId } of affected) {
        const remainingScope = await transaction<LocalClientScopeRow>('local_client_authorization_scopes')
          .where({ auth_id: authorizationId })
          .first()
        if (!remainingScope) await transaction<LocalClientRow>('local_client_authorizations').where({ id: authorizationId }).delete()
      }
    })
  }

  audit() { return [...this.recentAudit] }
  async addAudit(input: Omit<AuditEntry, 'id' | 'timestamp'>) {
    if (input.requestId && !input.traceId) await this.observations.flush()
    const related = input.requestId && !input.traceId
      ? await this.getDatabase()<AuditRow>('observation_records').select('trace_id', 'span_id')
        .where({ request_id: input.requestId, record_kind: 'span' }).orderBy('timestamp', 'desc').first()
      : undefined
    const frameworkCallAudit = input.source === 'plugin' && input.operation.includes('.capability.')
    const entry: AuditEntry = { ...input, id: randomUUID(), timestamp: new Date().toISOString(),
      ...(related?.trace_id && related.span_id ? { traceId: related.trace_id, parentSpanId: related.span_id,
        recordKind: 'event' as const, visibility: frameworkCallAudit ? 'technical' as const : 'activity' as const } : {}),
    }
    await this.getDatabase()<AuditRow>('observation_records').insert(toAuditRow(entry))
    if (!entry.parentSpanId && entry.visibility !== 'technical') this.recentAudit = [entry, ...this.recentAudit].slice(0, 50)
  }
  async auditSystem(operation: string, outcome: AuditOutcome, summary: string, risk?: AuditEntry['risk'], metadata?: AuditEntry['metadata']) { await this.addAudit({ source: 'system', operation, outcome, summary, ...(risk ? { risk } : {}), ...(metadata ? { metadata } : {}) }) }
  async clearAudit() {
    await this.observations.flush()
    await this.getDatabase()<AuditRow>('observation_records').delete()
    this.recentAudit = []
  }

  async queryAudit(input: AuditQueryInput = {}): Promise<AuditPage> {
    await this.observations.flush()
    const database = this.getDatabase(); const limit = Math.min(Math.max(input.limit ?? 50, 1), 100); const cursor = decodeAuditCursor(input.cursor)
    const applyFilters = (builder: Knex.QueryBuilder<AuditRow, AuditRow[]>) => {
      if (input.category && input.category !== 'all') builder.where('category', input.category)
      if (input.status === 'attention') builder.whereIn('outcome', ['denied', 'failed', 'interrupted'])
      if (input.risk && input.risk !== 'all') builder.where('risk', input.risk)
      const query = input.query?.trim().toLocaleLowerCase()
      if (query) {
        const pattern = escapedLikePattern(query); const fields: Array<keyof AuditRow> = ['summary', 'operation', 'relative_path', 'capability', 'method', 'error_code', 'task_id', 'run_id', 'request_id', 'metadata']
        builder.where((scope) => { for (const field of fields) scope.orWhereRaw(`lower(coalesce(??, '')) like ? escape '\\'`, [field, pattern]) })
      }
      return builder
    }
    const countQuery = applyFilters(database<AuditRow>('observation_records').where({ visibility: 'activity' }).whereNull('parent_span_id'))
    const [{ total: totalValue }] = await countQuery.clone().clearSelect().clearOrder().count<{ total: number | string }>({ total: '*' })
    const rowsQuery = applyFilters(database<AuditRow>('observation_records').select('*').where({ visibility: 'activity' }).whereNull('parent_span_id'))
    if (cursor) rowsQuery.andWhere((scope) => { scope.where('timestamp', '<', cursor.timestamp).orWhere((sameTimestamp) => sameTimestamp.where('timestamp', cursor.timestamp).andWhere('id', '<', cursor.id)) })
    const rows = await rowsQuery.orderBy('timestamp', 'desc').orderBy('id', 'desc').limit(limit + 1)
    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows
    const last = pageRows.at(-1)
    const traces = [...new Set(pageRows.map((row) => row.trace_id).filter((id): id is string => Boolean(id)))]
    const traceRows = traces.length ? await database<AuditRow>('observation_records').select('*')
      .whereIn('trace_id', traces).whereNotIn('id', pageRows.map((row) => row.id))
      .whereNotNull('parent_span_id').orderBy('timestamp', 'asc').orderBy('id', 'asc') : []
    const reached = new Set(pageRows.map((row) => row.span_id).filter((id): id is string => Boolean(id)))
    const children: AuditRow[] = []
    let remaining = traceRows
    while (remaining.length) {
      const next = remaining.filter((row) => row.parent_span_id && reached.has(row.parent_span_id))
      if (!next.length) break
      children.push(...next)
      for (const row of next) if (row.span_id) reached.add(row.span_id)
      const included = new Set(next.map((row) => row.id))
      remaining = remaining.filter((row) => !included.has(row.id))
    }
    return { items: [...pageRows, ...children].map(fromAuditRow), total: Number(totalValue),
      ...(hasMore && last ? { nextCursor: encodeAuditCursor(last) } : {}) }
  }

  async queryUsage(): Promise<UsageSummary> {
    await this.observations.flush()
    const retentionDays = 365
    const cutoff = new Date(Date.now() - (retentionDays - 1) * 86_400_000)
    cutoff.setHours(0, 0, 0, 0)
    type UsageRow = {
      date: string
      credits_charged: number | string | null
      paid_call_count: number | string | null
    }
    type UsagePluginRow = {
      plugin_id: string
      name_en_us: string | null
      name_zh_hans: string | null
      call_count: number | string | null
      credits_charged: number | string | null
    }
    const rows = await this.getDatabase().raw(`
      SELECT date(timestamp, 'localtime') AS date,
        ROUND(SUM(CAST(COALESCE(json_extract(diagnostic_details, '$.credit_charged_amount'), 0) AS REAL)), 2) AS credits_charged,
        SUM(CASE WHEN json_type(diagnostic_details, '$.credit_charged_amount') IN ('integer', 'real') THEN 1 ELSE 0 END) AS paid_call_count
      FROM observation_records
      WHERE timestamp >= ? AND evidence_origin = 'host'
        AND (visibility = 'activity' OR event_name = 'credit.settled')
      GROUP BY date(timestamp, 'localtime')
      ORDER BY date ASC
    `, [cutoff.toISOString()]) as unknown as UsageRow[]
    const plugins = await this.getDatabase().raw(`
      SELECT plugin_id,
        MAX(json_extract(diagnostic_details, '$.plugin_name_en_us')) AS name_en_us,
        MAX(json_extract(diagnostic_details, '$.plugin_name_zh_hans')) AS name_zh_hans,
        SUM(CASE WHEN (visibility = 'activity'
          AND event_name IN ('capability.invoke', 'local_api.request'))
          OR event_name = 'credit.settled' THEN 1 ELSE 0 END) AS call_count,
        ROUND(SUM(CAST(COALESCE(json_extract(diagnostic_details, '$.credit_charged_amount'), 0) AS REAL)), 2) AS credits_charged
      FROM observation_records
      WHERE timestamp >= ? AND evidence_origin = 'host' AND outcome = 'allowed' AND plugin_id IS NOT NULL
        AND ((visibility = 'activity' AND event_name IN ('capability.invoke', 'local_api.request'))
          OR event_name = 'credit.settled')
      GROUP BY plugin_id
      HAVING call_count > 0
      ORDER BY call_count DESC, credits_charged DESC, plugin_id ASC
    `, [cutoff.toISOString()]) as unknown as UsagePluginRow[]
    return {
      retentionDays,
      days: rows.map((row) => ({
        date: String(row.date),
        creditsCharged: Number(row.credits_charged || 0),
        paidCallCount: Number(row.paid_call_count || 0),
      })),
      plugins: plugins.map((row) => ({
        pluginId: row.plugin_id,
        ...(row.name_en_us ? { nameEnUs: row.name_en_us } : {}),
        ...(row.name_zh_hans ? { nameZhHans: row.name_zh_hans } : {}),
        callCount: Number(row.call_count || 0),
        creditsCharged: Number(row.credits_charged || 0),
      })),
    }
  }
  async auditForDiagnostics(startAt: string, endAt: string) {
    await this.observations.flush()
    const database = this.getDatabase()
    const [{ total }] = await database<AuditRow>('observation_records').whereBetween('timestamp', [startAt, endAt])
      .count<{ total: number | string }>({ total: '*' })
    async function* entries() {
      let cursor: Pick<AuditRow, 'timestamp' | 'id'> | null = null
      while (true) {
        const query = database<AuditRow>('observation_records').select('*').whereBetween('timestamp', [startAt, endAt])
        if (cursor) query.andWhere((scope) => {
          scope.where('timestamp', '<', cursor!.timestamp)
            .orWhere((sameTimestamp) => sameTimestamp.where('timestamp', cursor!.timestamp).andWhere('id', '<', cursor!.id))
        })
        const rows = await query.orderBy('timestamp', 'desc').orderBy('id', 'desc').limit(500)
        for (const row of rows) yield fromAuditRow(row)
        if (rows.length < 500) return
        cursor = rows[rows.length - 1]!
      }
    }
    return { count: Number(total), entries: entries() }
  }
  async close() { const database = this.database; this.database = null; if (database) await database.destroy(); if (this.ownsObservations) await this.observations.close() }
}
