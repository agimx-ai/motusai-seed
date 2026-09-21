import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import createKnex from 'knex'
import { SeedStore } from './store'
import { ObservationStore, errorDetails } from './observation-store'

describe('ObservationStore', () => {
  it('keeps an activity span and its raw error in one SQLite row, then exports that same row', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-observations-'))
    let observations: ObservationStore | undefined
    let store: SeedStore | undefined
    try {
      observations = new ObservationStore(directory, 'MotusAI Seed')
      store = new SeedStore(directory, 'MotusAI Seed', observations)
      await store.load()
      const trace = { trace_id: 'trace-1', span_id: 'span-1', plugin_id: 'com.example.plugin',
        plugin_version: '1.0.0', request_id: 'request-1', operation: 'search.query', event: 'capability.invoke' }
      const started = observations.record({ ...trace, level: 'info', source: 'plugin-host',
        phase: 'started', message: 'Started.' })
      const error = new Error('original provider failure')
      const finished = observations.record({ ...trace, level: 'error', source: 'plugin-host',
        phase: 'failed', duration_ms: 37, ...errorDetails(error) })
      expect(finished.event_id).toBe(started.event_id)
      const page = await store.queryAudit()
      expect(page.total).toBe(1)
      expect(page.items[0]).toMatchObject({ id: started.event_id, traceId: 'trace-1', spanId: 'span-1',
        outcome: 'failed', durationMs: 37, errorMessage: error.message, errorStack: error.stack })
      const archive = await store.auditForDiagnostics('2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')
      expect(archive.count).toBe(1)
      const records = []
      for await (const entry of archive.entries) records.push(entry)
      expect(records).toEqual(page.items)
      expect((await stat(observations.databasePath)).mode & 0o777).toBe(0o600)
    } finally {
      await store?.close()
      await observations?.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('groups child calls under the root without counting them as separate top-level activity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-observations-'))
    const observations = new ObservationStore(directory, 'MotusAI Seed')
    const store = new SeedStore(directory, 'MotusAI Seed', observations)
    try {
      await store.load()
      const base = { level: 'info' as const, source: 'plugin-host' as const, event: 'capability.invoke',
        message: 'Started.', trace_id: 'trace-2', plugin_id: 'com.example.agent', request_id: 'request-2' }
      observations.record({ ...base, span_id: 'root', operation: 'task.run', phase: 'started' })
      observations.record({ ...base, span_id: 'child', parent_span_id: 'root', operation: 'search.query', phase: 'started' })
      const page = await store.queryAudit()
      expect(page.total).toBe(1)
      expect(page.items.map((entry) => [entry.spanId, entry.parentSpanId])).toEqual([['root', undefined], ['child', 'root']])
      await store.clearAudit()
      expect((await store.queryAudit()).items).toEqual([])
    } finally {
      await store.close()
      await observations.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('does not leak a sibling root\'s children into a paginated call tree', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-observations-'))
    const observations = new ObservationStore(directory, 'MotusAI Seed')
    const store = new SeedStore(directory, 'MotusAI Seed', observations)
    try {
      await store.load()
      const base = { level: 'info' as const, source: 'plugin-host' as const, event: 'capability.invoke',
        message: 'Started.', plugin_id: 'com.example.plugin', trace_id: 'shared-trace', phase: 'started' as const }
      for (const root of ['one', 'two']) {
        observations.record({ ...base, span_id: root, operation: `task.${root}` })
        observations.record({ ...base, span_id: `${root}-child`, parent_span_id: root, operation: `child.${root}` })
      }
      const page = await store.queryAudit({ limit: 1 })
      expect(page.total).toBe(2)
      expect(page.items).toHaveLength(2)
      expect(page.items[1].parentSpanId).toBe(page.items[0].spanId)
    } finally { await store.close(); await observations.close(); await rm(directory, { recursive: true, force: true }) }
  })

  it('keeps internal host service calls in diagnostics without presenting them as user activities', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-observations-'))
    const observations = new ObservationStore(directory, 'MotusAI Seed')
    const store = new SeedStore(directory, 'MotusAI Seed', observations)
    try {
      await store.load()
      observations.record({ level: 'info', source: 'plugin-host', event: 'host.invoke',
        message: 'Configuration loaded.', plugin_id: 'com.example.plugin', operation: 'seed.configuration',
        trace_id: 'internal-trace', span_id: 'internal-span', phase: 'completed' })
      expect((await store.queryAudit()).total).toBe(0)
      const archive = await store.auditForDiagnostics('2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')
      expect(archive.count).toBe(1)
      for await (const row of archive.entries) expect(row.visibility).toBe('technical')
    } finally { await store.close(); await observations.close(); await rm(directory, { recursive: true, force: true }) }
  })

  it('keeps management data-source refreshes in diagnostics without presenting them as user activities', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-observations-'))
    const observations = new ObservationStore(directory, 'MotusAI Seed')
    const store = new SeedStore(directory, 'MotusAI Seed', observations)
    try {
      await store.load()
      observations.record({ level: 'info', source: 'plugin-host', event: 'capability.invoke',
        message: 'Capability invocation completed.', plugin_id: 'com.example.plugin', operation: 'skills.view',
        trace_id: 'management-trace', span_id: 'management-span', phase: 'completed',
        details: { activity_visibility: 'technical' } })
      expect((await store.queryAudit()).total).toBe(0)
      const archive = await store.auditForDiagnostics('2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')
      expect(archive.count).toBe(1)
      for await (const row of archive.entries) expect(row).toMatchObject({
        operation: 'skills.view', visibility: 'technical', diagnosticDetails: { activity_visibility: 'technical' },
      })
    } finally { await store.close(); await observations.close(); await rm(directory, { recursive: true, force: true }) }
  })

  it('does not block Main when another connection holds a write transaction', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-observations-'))
    const observations = new ObservationStore(directory, 'MotusAI Seed')
    const store = new SeedStore(directory, 'MotusAI Seed', observations)
    let release!: () => void
    let entered!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const inside = new Promise<void>((resolve) => { entered = resolve })
    const knex = createKnex({ client: 'better-sqlite3', connection: { filename: observations.databasePath }, useNullAsDefault: true })
    try {
      await store.load()
      const transaction = knex.transaction(async (trx) => {
        await trx('app_settings').insert({ key: 'observation-test-lock', value: 'held' })
        entered()
        await held
      })
      await inside
      const before = performance.now()
      observations.record({ level: 'error', source: 'main', event: 'lock.test', message: 'held transaction' })
      expect(performance.now() - before).toBeLessThan(100)
      release()
      await transaction
      await observations.flush()
      const archive = await store.auditForDiagnostics('2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')
      expect(archive.count).toBe(1)
    } finally {
      release()
      await knex.destroy()
      await store.close()
      await observations.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('marks unfinished calls interrupted after a process restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-observations-'))
    try {
      const first = new ObservationStore(directory, 'MotusAI Seed')
      first.record({ level: 'info', source: 'plugin-host', event: 'capability.invoke', message: 'Started.',
        plugin_id: 'com.example.plugin', operation: 'task.run', trace_id: 'trace-restart', span_id: 'span-restart', phase: 'started' })
      await first.close()
      const second = new ObservationStore(directory, 'MotusAI Seed')
      const store = new SeedStore(directory, 'MotusAI Seed', second)
      try {
        await store.load()
        expect((await store.queryAudit()).items[0]).toMatchObject({ outcome: 'interrupted', errorCode: 'process_interrupted' })
      } finally { await store.close(); await second.close() }
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('drops the obsolete audit table and prunes an expired trace as a whole', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-observations-'))
    try {
      const first = new ObservationStore(directory, 'MotusAI Seed')
      const base = { level: 'info' as const, source: 'plugin-host' as const, event: 'capability.invoke',
        message: 'Completed.', plugin_id: 'com.example.plugin', trace_id: 'expired-trace', phase: 'completed' as const }
      first.record({ ...base, span_id: 'expired-parent', operation: 'task.run' })
      first.record({ ...base, span_id: 'expired-child', parent_span_id: 'expired-parent', operation: 'search.query' })
      await first.close()
      const knex = createKnex({ client: 'better-sqlite3', connection: { filename: first.databasePath }, useNullAsDefault: true })
      await knex.schema.createTable('audit_entries', (table) => { table.text('id') })
      await knex('observation_records').where({ span_id: 'expired-parent' }).update({ timestamp: '2000-01-01T00:00:00.000Z' })
      await knex.destroy()

      const second = new ObservationStore(directory, 'MotusAI Seed')
      try {
        const store = new SeedStore(directory, 'MotusAI Seed', second)
        try {
          await store.load()
          expect((await store.queryAudit()).items).toEqual([])
          const verifier = createKnex({ client: 'better-sqlite3',
            connection: { filename: second.databasePath }, useNullAsDefault: true })
          try { expect(await verifier.schema.hasTable('audit_entries')).toBe(false) }
          finally { await verifier.destroy() }
        } finally { await store.close() }
      } finally { await second.close() }
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
