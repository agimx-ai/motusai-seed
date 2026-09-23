import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import createKnex from 'knex'
import { SeedStore } from './store'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), 'motusai-seed-store-'))
  temporaryDirectories.push(path)
  return path
}

describe('SeedStore SQLite persistence', () => {
  it('uses the normalized app name and fresh database defaults', async () => {
    const directory = await temporaryDirectory()

    const store = new SeedStore(directory, 'MotusAI Seed')
    await store.load()

    expect(store.databasePath).toBe(join(directory, 'motusai_seed.sqlite3'))
    expect(store.preventSystemSleep()).toBe(false)
    expect(store.languagePreference()).toBe('system')
    expect(store.themePreference()).toBe('system')
    expect((await store.queryAudit()).items).toEqual([])
    await expect(readFile(store.databasePath)).resolves.toBeInstanceOf(Buffer)
    await store.close()
  })

  it('persists renderer preferences and plugin installation state in SQLite', async () => {
    const directory = await temporaryDirectory()
    const store = new SeedStore(directory, 'MotusAI Seed')
    await store.load()
    await store.setThemePreference('dark')
    await store.setLanguagePreference('en-US')
    await store.setInstalledPluginState({ schema_version: 1, plugins: [] })
    await store.close()

    const reopened = new SeedStore(directory, 'MotusAI Seed')
    await reopened.load()
    expect(reopened.themePreference()).toBe('dark')
    expect(reopened.languagePreference()).toBe('en-US')
    await expect(reopened.installedPluginState()).resolves.toEqual({ schema_version: 1, plugins: [] })
    await reopened.close()
  })

  it('persists plugin profiles through encrypted system storage', async () => {
    const directory = await temporaryDirectory()
    const store = new SeedStore(directory, 'MotusAI Seed')
    await store.load()
    await store.setPluginConfiguration('com.example.agent:models', {
      schema_version: 1,
      profiles: [{ id: 'deepseek-main', provider: 'deepseek', api_key: 'chat-secret-key', base_url: '', model: 'deepseek-v4-flash' }],
      default_profile_id: 'deepseek-main',
      values: { system_prompt: 'Test assistant' },
    })
    await store.close()

    expect((await readFile(store.databasePath)).toString('utf8')).not.toContain('chat-secret-key')
    const reopened = new SeedStore(directory, 'MotusAI Seed')
    await reopened.load()
    expect(reopened.pluginConfiguration('com.example.agent:models')).toEqual({
      schema_version: 1,
      profiles: [{ id: 'deepseek-main', provider: 'deepseek', api_key: 'chat-secret-key', base_url: '', model: 'deepseek-v4-flash' }],
      default_profile_id: 'deepseek-main',
      values: { system_prompt: 'Test assistant' },
    })
    await reopened.close()
  })

  it('removes every configuration owned by an uninstalled plugin', async () => {
    const directory = await temporaryDirectory()
    const store = new SeedStore(directory, 'MotusAI Seed')
    await store.load()
    await store.setPluginConfiguration('com.example.agent:models', {
      schema_version: 1,
      profiles: [{ id: 'deepseek-main', api_key: 'chat-secret' }],
      default_profile_id: 'deepseek-main',
      values: {},
    })
    await store.setPluginConfiguration('com.example.agent:search', {
      schema_version: 1,
      profiles: [{ id: 'search-main', api_key: 'search-secret' }],
      default_profile_id: 'search-main',
      values: {},
    })
    await store.setPluginConfiguration('com.example.other:models', {
      schema_version: 1,
      profiles: [{ id: 'other-main', api_key: 'other-secret' }],
      default_profile_id: 'other-main',
      values: {},
    })

    await store.removePluginConfigurations('com.example.agent')
    expect(store.pluginConfiguration('com.example.agent:models')).toBeUndefined()
    expect(store.pluginConfiguration('com.example.agent:search')).toBeUndefined()
    expect(store.pluginConfiguration('com.example.other:models')?.profiles[0]?.api_key).toBe('other-secret')
    await store.close()

    const reopened = new SeedStore(directory, 'MotusAI Seed')
    await reopened.load()
    expect(reopened.pluginConfiguration('com.example.agent:models')).toBeUndefined()
    expect(reopened.pluginConfiguration('com.example.other:models')?.profiles[0]?.api_key).toBe('other-secret')
    expect((await readFile(reopened.databasePath)).toString('utf8')).not.toContain('chat-secret')
    expect((await readFile(reopened.databasePath)).toString('utf8')).not.toContain('search-secret')
    expect((await readFile(reopened.databasePath)).toString('utf8')).not.toContain('other-secret')
    await reopened.close()
  })

  it('stores only a local client token digest and revokes access', async () => {
    const directory = await temporaryDirectory()
    const store = new SeedStore(directory, 'MotusAI Seed')
    await store.load()
    const token = 'local-client-secret-token'
    const [id, recordingId] = await Promise.all([
      store.authorizeLocalClient({
        pluginId: 'com.motusai.seed.agent-harness',
        clientId: 'com.motusai.obsidian',
        installationId: 'installation-test',
        displayName: 'MotusAI for Obsidian',
        deviceName: 'Duzhijun MacBook Pro',
        token,
      }),
      store.authorizeLocalClient({
        pluginId: 'com.motusai.seed.recording',
        clientId: 'com.motusai.obsidian',
        installationId: 'installation-test',
        displayName: 'MotusAI for Obsidian',
        deviceName: 'Duzhijun MacBook Pro',
        token,
      }),
    ])
    expect(recordingId).toBe(id)
    await expect(store.localClientAuthorizationId('com.motusai.seed.agent-harness', token)).resolves.toBe(id)
    await expect(store.hasLocalClientAuthorization('com.motusai.seed.agent-harness', id)).resolves.toBe(true)
    await expect(store.hasLocalClientAuthorization('com.example.other', id)).resolves.toBe(false)
    await expect(store.localClientAuthorizationId('com.motusai.seed.agent-harness', 'wrong-token')).resolves.toBeNull()
    await expect(store.localClientAuthorizationId('com.motusai.seed.recording', token)).resolves.toBe(id)
    expect(await store.localClients()).toEqual([expect.objectContaining({
      id,
      clientId: 'com.motusai.obsidian',
      deviceName: 'Duzhijun MacBook Pro',
      pluginIds: ['com.motusai.seed.agent-harness', 'com.motusai.seed.recording'],
    })])
    await store.removePluginLocalClientAuthorizations('com.motusai.seed.recording')
    await expect(store.hasLocalClientAuthorization('com.motusai.seed.recording', id)).resolves.toBe(false)
    await expect(store.hasLocalClientAuthorization('com.motusai.seed.agent-harness', id)).resolves.toBe(true)
    expect(await store.localClients()).toEqual([expect.objectContaining({
      id, pluginIds: ['com.motusai.seed.agent-harness'],
    })])
    await store.removePluginLocalClientAuthorizations('com.motusai.seed.agent-harness')
    await expect(store.localClients()).resolves.toEqual([])
    expect((await readFile(store.databasePath)).toString('utf8')).not.toContain(token)
    await expect(store.localClientAuthorizationId('com.motusai.seed.agent-harness', token)).resolves.toBeNull()
    await store.close()
    const database = createKnex({ client: 'better-sqlite3', connection: { filename: store.databasePath }, useNullAsDefault: true })
    await expect(database('local_client_authorization_scopes').count<{ count: number }[]>({ count: '*' }).first()).resolves.toMatchObject({ count: 0 })
    await database.destroy()
  })

  it('migrates per-plugin authorizations into one client identity with plugin scopes', async () => {
    const directory = await temporaryDirectory()
    const databasePath = join(directory, 'motusai_seed.sqlite3')
    const legacy = createKnex({ client: 'better-sqlite3', connection: { filename: databasePath }, useNullAsDefault: true })
    await legacy.schema.createTable('local_client_authorizations', (table) => {
      table.text('id').primary(); table.text('plugin_id').notNullable(); table.text('client_id').notNullable(); table.text('installation_id').notNullable()
      table.text('display_name').notNullable(); table.text('token_hash').notNullable().unique(); table.text('created_at').notNullable(); table.text('updated_at').notNullable()
      table.unique(['plugin_id', 'client_id', 'installation_id'], { indexName: 'local_client_identity_unique' })
    })
    const oldToken = 'old-plugin-token'
    const currentToken = 'current-client-token'
    await legacy('local_client_authorizations').insert([
      {
        id: 'authorization-old', plugin_id: 'com.motusai.seed.agent-harness', client_id: 'com.motusai.obsidian', installation_id: 'installation-test',
        display_name: 'MotusAI for Obsidian', token_hash: createHash('sha256').update(oldToken).digest('hex'),
        created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
      },
      {
        id: 'authorization-current', plugin_id: 'com.motusai.seed.recording', client_id: 'com.motusai.obsidian', installation_id: 'installation-test',
        display_name: 'MotusAI for Obsidian', token_hash: createHash('sha256').update(currentToken).digest('hex'),
        created_at: '2026-09-01T01:00:00.000Z', updated_at: '2026-09-01T01:00:00.000Z',
      },
    ])
    await legacy.destroy()

    const store = new SeedStore(directory, 'MotusAI Seed')
    await store.load()
    expect(await store.localClients()).toEqual([expect.objectContaining({
      id: 'authorization-current',
      pluginIds: ['com.motusai.seed.agent-harness', 'com.motusai.seed.recording'],
    })])
    await expect(store.localClientAuthorizationId('com.motusai.seed.agent-harness', currentToken)).resolves.toBe('authorization-current')
    await expect(store.localClientAuthorizationId('com.motusai.seed.recording', currentToken)).resolves.toBe('authorization-current')
    await expect(store.localClientAuthorizationId('com.motusai.seed.agent-harness', oldToken)).resolves.toBeNull()
    await store.close()

    const migrated = createKnex({ client: 'better-sqlite3', connection: { filename: databasePath }, useNullAsDefault: true })
    await expect(migrated.schema.hasColumn('local_client_authorizations', 'plugin_id')).resolves.toBe(false)
    await expect(migrated.schema.hasColumn('local_client_authorizations', 'device_name')).resolves.toBe(true)
    await expect(migrated.schema.hasTable('local_client_authorization_scopes')).resolves.toBe(true)
    await migrated.destroy()
  })

  it('migrates existing client metadata and legacy authorization scope columns', async () => {
    const directory = await temporaryDirectory()
    const databasePath = join(directory, 'motusai_seed.sqlite3')
    const current = createKnex({ client: 'better-sqlite3', connection: { filename: databasePath }, useNullAsDefault: true })
    await current.schema.createTable('local_client_authorizations', (table) => {
      table.text('id').primary()
      table.text('client_id').notNullable()
      table.text('installation_id').notNullable()
      table.text('display_name').notNullable()
      table.text('token_hash').notNullable().unique()
      table.text('created_at').notNullable()
      table.text('updated_at').notNullable()
      table.unique(['client_id', 'installation_id'], { indexName: 'local_client_identity_unique' })
    })
    await current.schema.createTable('local_client_authorization_scopes', (table) => {
      table.text('authorization_id').notNullable()
      table.text('plugin_id').notNullable()
      table.text('created_at').notNullable()
      table.primary(['authorization_id', 'plugin_id'])
    })
    await current('local_client_authorizations').insert({
      id: 'authorization-current',
      client_id: 'com.motusai.obsidian',
      installation_id: 'installation-test',
      display_name: 'MotusAI for Obsidian',
      token_hash: createHash('sha256').update('current-client-token').digest('hex'),
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    })
    await current('local_client_authorization_scopes').insert({
      authorization_id: 'authorization-current',
      plugin_id: 'com.motusai.seed.agent-harness',
      created_at: '2026-09-01T00:00:00.000Z',
    })
    await current.destroy()

    const store = new SeedStore(directory, 'MotusAI Seed')
    await store.load()
    await store.updateLocalClientMetadata('authorization-current', {
      displayName: 'MotusAI for Obsidian',
      deviceName: 'Duzhijun MacBook Pro',
    })
    expect(await store.localClients()).toEqual([expect.objectContaining({
      id: 'authorization-current',
      deviceName: 'Duzhijun MacBook Pro',
    })])
    await expect(store.localClientAuthorizationId('com.motusai.seed.agent-harness', 'current-client-token'))
      .resolves.toBe('authorization-current')
    await store.close()

    const migrated = createKnex({ client: 'better-sqlite3', connection: { filename: databasePath }, useNullAsDefault: true })
    await expect(migrated.schema.hasColumn('local_client_authorization_scopes', 'authorization_id')).resolves.toBe(false)
    await expect(migrated.schema.hasColumn('local_client_authorization_scopes', 'auth_id')).resolves.toBe(true)
    await migrated.destroy()
  })

  it('renames the local client scope foreign key to the current auth_id contract', async () => {
    const directory = await temporaryDirectory()
    const databasePath = join(directory, 'motusai_seed.sqlite3')
    const legacy = createKnex({ client: 'better-sqlite3', connection: { filename: databasePath }, useNullAsDefault: true })
    await legacy.schema.createTable('local_client_authorizations', (table) => {
      table.text('id').primary()
      table.text('client_id').notNullable()
      table.text('installation_id').notNullable()
      table.text('display_name').notNullable()
      table.text('device_name')
      table.text('token_hash').notNullable().unique()
      table.text('created_at').notNullable()
      table.text('updated_at').notNullable()
      table.unique(['client_id', 'installation_id'], { indexName: 'local_client_identity_unique' })
    })
    await legacy.schema.createTable('local_client_authorization_scopes', (table) => {
      table.text('authorization_id').notNullable()
      table.text('plugin_id').notNullable()
      table.text('created_at').notNullable()
      table.primary(['authorization_id', 'plugin_id'])
      table.foreign('authorization_id').references('id').inTable('local_client_authorizations').onDelete('CASCADE')
      table.index(['plugin_id', 'authorization_id'], 'local_client_scope_plugin_index')
    })
    await legacy('local_client_authorizations').insert({
      id: 'authorization-current',
      client_id: 'com.motusai.obsidian',
      installation_id: 'installation-test',
      display_name: 'MotusAI for Obsidian',
      device_name: null,
      token_hash: createHash('sha256').update('current-client-token').digest('hex'),
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    })
    await legacy('local_client_authorization_scopes').insert({
      authorization_id: 'authorization-current',
      plugin_id: 'com.motusai.seed.terminal',
      created_at: '2026-09-01T00:00:00.000Z',
    })
    await legacy.destroy()

    const store = new SeedStore(directory, 'MotusAI Seed')
    await store.load()
    await expect(store.hasLocalClientAuthorization('com.motusai.seed.terminal', 'authorization-current')).resolves.toBe(true)
    await store.removePluginLocalClientAuthorizations('com.motusai.seed.terminal')
    await expect(store.localClients()).resolves.toEqual([])
    await store.close()

    const migrated = createKnex({ client: 'better-sqlite3', connection: { filename: databasePath }, useNullAsDefault: true })
    await expect(migrated.schema.hasColumn('local_client_authorization_scopes', 'auth_id')).resolves.toBe(true)
    await expect(migrated.schema.hasColumn('local_client_authorization_scopes', 'authorization_id')).resolves.toBe(false)
    await migrated.destroy()
  })

  it('searches and paginates the complete local activity history', async () => {
    const directory = await temporaryDirectory()
    const store = new SeedStore(directory, 'MotusAI Seed')
    await store.load()
    await store.addAudit({ source: 'agent', operation: 'files.write_file', outcome: 'allowed', summary: '写入年度报告', relativePath: 'reports/annual.md' })
    await store.addAudit({ source: 'agent', operation: 'com.motusai.seed.files.list_directory', capability: 'com.motusai.seed.files', method: 'list_directory', risk: 'read', outcome: 'allowed', summary: '列出项目文件' })
    await store.addAudit({ source: 'system', operation: 'logs.upload', outcome: 'failed', summary: '上传诊断包失败' })

    const first = await store.queryAudit({ limit: 1 })
    expect(first.total).toBe(3)
    expect(first.items).toHaveLength(1)
    expect(first.nextCursor).toBeTruthy()
    const second = await store.queryAudit({ cursor: first.nextCursor, limit: 1 })
    expect(second.items).toHaveLength(1)
    expect((await store.queryAudit({ category: 'capabilities' })).items).toHaveLength(2)
    expect((await store.queryAudit({ category: 'capabilities', query: 'annual.md' })).items).toHaveLength(1)
    expect((await store.queryAudit({ risk: 'write' })).items).toHaveLength(2)
    expect((await store.queryAudit({ status: 'attention' })).items).toHaveLength(1)
    expect((await store.queryAudit({ status: 'attention', risk: 'write' })).items).toHaveLength(1)
    const diagnosticAudit = await store.auditForDiagnostics('2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')
    const diagnosticEntries = []
    for await (const entry of diagnosticAudit.entries) diagnosticEntries.push(entry)
    expect(diagnosticAudit.count).toBe(3)
    expect(diagnosticEntries).toHaveLength(3)
    const emptyDiagnosticAudit = await store.auditForDiagnostics('2000-01-01T00:00:00.000Z', '2000-01-02T00:00:00.000Z')
    expect(emptyDiagnosticAudit.count).toBe(0)
    await store.close()
  })

  it('streams diagnostic activity across page boundaries', async () => {
    const directory = await temporaryDirectory()
    const store = new SeedStore(directory, 'MotusAI Seed')
    await store.load()
    for (let index = 0; index < 501; index += 1) {
      await store.addAudit({ source: 'system', operation: 'diagnostic.test', outcome: 'allowed', summary: `event-${index}` })
    }
    const diagnosticAudit = await store.auditForDiagnostics('2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')
    let count = 0
    for await (const _entry of diagnosticAudit.entries) count += 1
    expect(diagnosticAudit.count).toBe(501)
    expect(count).toBe(501)
    await store.close()
  })

  it('persists structured plugin activity metadata without conversation content', async () => {
    const directory = await temporaryDirectory()
    const store = new SeedStore(directory, 'MotusAI Seed')
    await store.load()
    await store.addAudit({
      source: 'plugin',
      operation: 'plugin.com.motusai.seed.agent-harness.conversation.completed',
      capability: 'com.motusai.seed.agent-harness',
      method: 'conversation.completed',
      outcome: 'allowed',
      risk: 'read',
      runId: 'run-test',
      summary: 'com.motusai.seed.agent-harness: conversation.completed',
      metadata: { workspace_id: 'vault-test', duration_ms: 321, input_length: 12, output_length: 34 },
    })
    await store.close()

    const reopened = new SeedStore(directory, 'MotusAI Seed')
    await reopened.load()
    const [entry] = (await reopened.queryAudit({ query: 'vault-test' })).items
    expect(entry).toMatchObject({
      source: 'plugin',
      method: 'conversation.completed',
      runId: 'run-test',
      metadata: { workspace_id: 'vault-test', duration_ms: 321, input_length: 12, output_length: 34 },
    })
    reopened.observations.record({
      level: 'info', source: 'plugin-host', event: 'capability.invoke', message: 'Capability invocation started.',
      plugin_id: 'com.example.paid', request_id: 'paid-call', operation: 'example.run',
      trace_id: 'usage-credit-trace', span_id: 'usage-credit-span', phase: 'started',
    })
    reopened.observations.record({
      level: 'info', source: 'plugin-host', event: 'capability.invoke', message: 'Capability invocation completed.',
      plugin_id: 'com.example.paid', request_id: 'paid-call', operation: 'example.run',
      trace_id: 'usage-credit-trace', span_id: 'usage-credit-span', phase: 'completed', duration_ms: 100,
      details: { credit_charged_amount: 9.25, plugin_name_en_us: 'Paid Plugin', plugin_name_zh_hans: '付费插件' },
    })
    reopened.observations.record({
      level: 'info', source: 'connector', event: 'local_api.request', message: 'Local plugin request started.',
      plugin_id: 'com.example.local', request_id: 'local-call', operation: 'POST /session',
      trace_id: 'usage-local-trace', span_id: 'usage-local-span', phase: 'started',
      details: { plugin_name_en_us: 'Local Plugin', plugin_name_zh_hans: '本地插件' },
    })
    reopened.observations.record({
      level: 'info', source: 'connector', event: 'local_api.request', message: 'Local plugin request completed.',
      plugin_id: 'com.example.local', request_id: 'local-call', operation: 'POST /session',
      trace_id: 'usage-local-trace', span_id: 'usage-local-span', phase: 'completed', duration_ms: 50,
      details: { plugin_name_en_us: 'Local Plugin', plugin_name_zh_hans: '本地插件' },
    })
    reopened.observations.record({
      level: 'info', source: 'main', event: 'credit.settled', message: 'Cloud relay credit settlement recorded.',
      plugin_id: 'com.example.local', operation: 'credit.settled',
      details: { credit_charged_amount: 3.01, plugin_name_en_us: 'Local Plugin', plugin_name_zh_hans: '本地插件' },
    })
    const usage = await reopened.queryUsage()
    expect(usage.retentionDays).toBe(365)
    expect(usage.days).toEqual([expect.objectContaining({
      creditsCharged: 12.26,
      paidCallCount: 2,
    })])
    expect(usage.plugins).toEqual([
      { pluginId: 'com.example.local', nameEnUs: 'Local Plugin', nameZhHans: '本地插件', callCount: 2, creditsCharged: 3.01 },
      { pluginId: 'com.example.paid', nameEnUs: 'Paid Plugin', nameZhHans: '付费插件', callCount: 1, creditsCharged: 9.25 },
    ])
    await reopened.close()
  })

  it('includes settled calls and every used plugin in usage statistics', async () => {
    const directory = await temporaryDirectory()
    const store = new SeedStore(directory, 'MotusAI Seed')
    await store.load()
    for (let index = 0; index < 11; index += 1) {
      store.observations.record({
        level: 'info', source: 'connector', event: 'local_api.request', message: 'Local plugin request completed.',
        plugin_id: `com.example.plugin-${index}`, operation: 'POST /run',
        span_id: `usage-plugin-${index}`, phase: 'completed',
      })
    }
    store.observations.record({
      level: 'info', source: 'main', event: 'credit.settled', message: 'Cloud relay credit settlement recorded.',
      plugin_id: 'com.example.settled-only', operation: 'credit.settled',
      details: { credit_charged_amount: 1.5 },
    })

    const usage = await store.queryUsage()
    expect(usage.plugins).toHaveLength(12)
    expect(usage.plugins).toContainEqual({
      pluginId: 'com.example.settled-only', callCount: 1, creditsCharged: 1.5,
    })
    await store.close()
  })

  it('isolates encrypted plugin secrets and persists revocable delegated capability grants', async () => {
    const directory = await temporaryDirectory()
    const store = new SeedStore(directory, 'MotusAI Seed')
    await store.load()
    await store.setPluginSecret('com.example.connector', 'session.token', 'secret-token')
    expect(store.pluginSecret('com.example.connector', 'session.token')).toBe('secret-token')
    expect(store.pluginSecret('com.example.other', 'session.token')).toBeUndefined()
    const grant = { consumer_plugin_id: 'com.example.connector', provider_plugin_id: 'com.motusai.seed.agent-harness', capability: 'agent_sessions', capability_version: 1, method: 'messages.submit' }
    await store.grantPluginCapability(grant)
    expect(await store.hasPluginCapabilityGrant(grant)).toBe(true)
    const [storedGrant] = store.pluginCapabilityGrants()
    expect(storedGrant).toMatchObject({ consumerPluginId: grant.consumer_plugin_id, capability: 'agent_sessions', method: 'messages.submit' })
    await store.revokePluginCapabilityGrant(storedGrant!.id)
    expect(await store.hasPluginCapabilityGrant(grant)).toBe(false)
    await store.close()
  })
})
