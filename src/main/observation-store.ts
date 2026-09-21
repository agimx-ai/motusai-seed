import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AuditEntry } from '../shared/contracts'

type Statement = {
  run(...values: unknown[]): { changes: number }
  get(...values: unknown[]): Record<string, unknown> | undefined
}
type DatabaseConnection = {
  exec(sql: string): void
  pragma(sql: string): unknown
  prepare(sql: string): Statement
  close(): void
}
const Sqlite = require('better-sqlite3') as new (path: string) => DatabaseConnection

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'
export type DiagnosticSource = 'main' | 'renderer' | 'connector' | 'plugin-host' | 'broker' | 'sidecar'
export type DiagnosticRecord = {
  schema_version: 1
  event_id: string
  session_id: string
  timestamp: string
  level: DiagnosticLevel
  source: DiagnosticSource
  event: string
  message: string
  plugin_id?: string
  plugin_version?: string
  request_id?: string
  operation?: string
  trace_id?: string
  span_id?: string
  parent_span_id?: string
  phase?: 'started' | 'completed' | 'failed'
  duration_ms?: number
  error_code?: string
  error_name?: string
  error_stack?: string
  details?: Record<string, string | number | boolean | null>
}
export type DiagnosticInput = Pick<DiagnosticRecord, 'level' | 'source' | 'event' | 'message'> &
  Partial<Pick<DiagnosticRecord, 'plugin_id' | 'plugin_version' | 'request_id' | 'operation' | 'trace_id' | 'span_id' | 'parent_span_id' | 'phase' | 'duration_ms' | 'error_code' | 'error_name' | 'error_stack' | 'details'>> &
  { evidence_origin?: 'host' | 'plugin' }

const observationRetentionDays = 365
const observationMaxRows = 200_000

export function observationDatabaseFileName(appName: string) {
  const safeName = appName.trim().toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'application'
  return `${safeName}.sqlite3`
}

export function errorDetails(error: unknown): Pick<DiagnosticInput, 'message' | 'error_name' | 'error_stack'> {
  if (error instanceof Error) return {
    message: error.message,
    error_name: error.name,
    ...(error.stack ? { error_stack: error.stack } : {}),
  }
  return { message: String(error) }
}

/** The activity UI and diagnostic archive read this one SQLite table. Main owns every write. */
export class ObservationStore {
  readonly sessionId = randomUUID()
  readonly databasePath: string
  private readonly database: DatabaseConnection
  private readonly pendingWrites: Array<() => void> = []
  private readonly flushWaiters: Array<{ resolve(): void; reject(error: Error): void }> = []
  private readonly spanIds = new Map<string, { eventId: string; pluginId?: string }>()
  private insertsSincePrune = 0
  private retryTimer: NodeJS.Timeout | null = null
  private writeError: Error | null = null

  constructor(userDataPath: string, appName: string) {
    mkdirSync(userDataPath, { recursive: true, mode: 0o700 })
    this.databasePath = join(userDataPath, observationDatabaseFileName(appName))
    this.database = new Sqlite(this.databasePath)
    this.database.pragma('journal_mode = WAL')
    this.database.pragma('foreign_keys = ON')
    // A synchronous wait would deadlock Main while Knex owns a write transaction.
    this.database.pragma('busy_timeout = 0')
    // This is a new, pre-release storage contract. Do not migrate or keep the old audit table.
    this.database.exec('DROP TABLE IF EXISTS audit_entries')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS observation_records (
        id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, ended_at TEXT,
        source TEXT NOT NULL, operation TEXT NOT NULL, category TEXT NOT NULL,
        capability TEXT, method TEXT, risk TEXT NOT NULL,
        task_id TEXT, run_id TEXT, request_id TEXT, approval_id TEXT,
        error_code TEXT, grant_id TEXT, relative_path TEXT,
        outcome TEXT NOT NULL, summary TEXT NOT NULL, metadata TEXT,
        record_kind TEXT NOT NULL DEFAULT 'activity', visibility TEXT NOT NULL DEFAULT 'activity',
        trace_id TEXT, span_id TEXT, parent_span_id TEXT,
        level TEXT, component TEXT, plugin_id TEXT, plugin_version TEXT,
        duration_ms INTEGER, event_name TEXT, error_message TEXT, error_name TEXT, error_stack TEXT, diagnostic_details TEXT,
        session_id TEXT, evidence_origin TEXT NOT NULL DEFAULT 'host'
      );
      CREATE INDEX IF NOT EXISTS observation_time_idx ON observation_records(timestamp DESC, id DESC);
      CREATE INDEX IF NOT EXISTS observation_category_time_idx ON observation_records(category, timestamp DESC);
      CREATE INDEX IF NOT EXISTS observation_outcome_time_idx ON observation_records(outcome, timestamp DESC);
      CREATE INDEX IF NOT EXISTS observation_trace_idx ON observation_records(trace_id, timestamp, id);
      CREATE INDEX IF NOT EXISTS observation_parent_idx ON observation_records(parent_span_id);
      CREATE INDEX IF NOT EXISTS observation_request_idx ON observation_records(request_id);
      CREATE UNIQUE INDEX IF NOT EXISTS observation_span_idx ON observation_records(span_id) WHERE span_id IS NOT NULL;
    `)
    this.database.prepare(`UPDATE observation_records SET outcome = 'interrupted', ended_at = ?,
      error_code = 'process_interrupted', error_message = 'The process exited before this call completed.'
      WHERE record_kind = 'span' AND outcome = 'running'`).run(new Date().toISOString())
    this.prune()
    if (process.platform !== 'win32') chmodSync(this.databasePath, 0o600)
  }

  interruptOpenSpans(pluginId?: string, code = 'process_interrupted', message = 'The process exited before this call completed.') {
    for (const [spanId, owner] of this.spanIds) if (!pluginId || owner.pluginId === pluginId) this.spanIds.delete(spanId)
    this.enqueue(() => {
      this.database.prepare(`UPDATE observation_records SET outcome = 'interrupted', ended_at = ?,
        error_code = ?, error_message = ? WHERE record_kind = 'span' AND outcome = 'running'
        AND (? IS NULL OR plugin_id = ?)`)
        .run(new Date().toISOString(), code, message, pluginId || null, pluginId || null)
    })
  }

  private enqueue(write: () => void) {
    this.pendingWrites.push(write)
    this.drain()
  }

  /** Remove complete traces as a unit, so a retained child never loses its parent. */
  private prune() {
    const ageCutoff = new Date(Date.now() - observationRetentionDays * 86_400_000).toISOString()
    const boundary = this.database.prepare(`SELECT timestamp FROM observation_records
      ORDER BY timestamp DESC, id DESC LIMIT 1 OFFSET ?`).get(observationMaxRows - 1)
    const cutoff = boundary && String(boundary.timestamp) > ageCutoff ? String(boundary.timestamp) : ageCutoff
    this.database.prepare(`DELETE FROM observation_records WHERE trace_id IS NULL AND timestamp < ? AND outcome != 'running'`)
      .run(cutoff)
    this.database.prepare(`DELETE FROM observation_records WHERE trace_id IN (
      SELECT DISTINCT older.trace_id FROM observation_records older WHERE older.timestamp < ?
        AND older.trace_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM observation_records running WHERE running.trace_id = older.trace_id AND running.outcome = 'running'
        )
    )`).run(cutoff)
  }

  private drain() {
    while (this.pendingWrites.length) {
      try {
        this.pendingWrites[0]!()
        this.pendingWrites.shift()
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'SQLITE_BUSY') {
          if (!this.retryTimer) this.retryTimer = setTimeout(() => { this.retryTimer = null; this.drain() }, 10)
          return
        }
        this.pendingWrites.shift()
        this.writeError = error instanceof Error ? error : new Error(String(error))
        process.stderr.write(`Observation write failed: ${this.writeError.stack || this.writeError.message}\n`)
      }
    }
    if (this.flushWaiters.length) {
      const error = this.writeError
      this.writeError = null
      for (const waiter of this.flushWaiters.splice(0)) error ? waiter.reject(error) : waiter.resolve()
    }
  }

  async flush() {
    if (!this.pendingWrites.length) {
      if (this.writeError) { const error = this.writeError; this.writeError = null; throw error }
      return
    }
    await new Promise<void>((resolve, reject) => {
      const waiter = { resolve: () => { clearTimeout(timer); resolve() },
        reject: (error: Error) => { clearTimeout(timer); reject(error) } }
      const timer = setTimeout(() => {
        const index = this.flushWaiters.indexOf(waiter)
        if (index >= 0) this.flushWaiters.splice(index, 1)
        reject(new Error('Observation storage remained busy for 5 seconds.'))
      }, 5_000)
      this.flushWaiters.push(waiter)
    })
  }

  record(input: DiagnosticInput): DiagnosticRecord {
    const event: DiagnosticRecord = {
      schema_version: 1, event_id: randomUUID(), session_id: this.sessionId,
      timestamp: new Date().toISOString(), ...input,
    }
    const isSpan = Boolean(input.span_id && input.phase)
    const outcome = input.phase === 'started' ? 'running'
      : input.phase === 'failed' || input.level === 'error' || input.level === 'fatal' ? 'failed' : 'allowed'
    const source = input.plugin_id ? 'plugin' : 'system'
    const visibility = isSpan && ['capability.invoke', 'capability.execute', 'local_api.request'].includes(input.event)
      && input.details?.activity_visibility !== 'technical' ? 'activity' : 'technical'
    const category = input.plugin_id ? 'capabilities' : 'system'
    const values = {
      id: event.event_id, timestamp: event.timestamp, ended_at: input.phase && input.phase !== 'started' ? event.timestamp : null,
      source, operation: input.operation || input.event, category, capability: null, method: null, risk: 'read',
      task_id: null, run_id: null, request_id: input.request_id || null, approval_id: null,
      error_code: input.error_code || null, grant_id: null, relative_path: null, outcome,
      summary: input.plugin_id ? `${input.plugin_id} · ${input.operation || input.event}` : input.message,
      metadata: null, record_kind: isSpan ? 'span' : 'event', visibility,
      trace_id: input.trace_id || null, span_id: input.span_id || null,
      parent_span_id: input.parent_span_id || null, level: input.level,
      component: input.source, plugin_id: input.plugin_id || null, plugin_version: input.plugin_version || null,
      duration_ms: input.duration_ms ?? null, event_name: input.event, error_message: input.phase === 'failed' ? input.message : null,
      error_name: input.error_name || null,
      error_stack: input.error_stack || null, diagnostic_details: input.details ? JSON.stringify(input.details) : null,
      session_id: this.sessionId, evidence_origin: input.evidence_origin || 'host',
    }
    if (isSpan && input.phase === 'started') this.spanIds.set(input.span_id!, { eventId: event.event_id, pluginId: input.plugin_id })
    const originalId = isSpan && input.phase !== 'started' ? this.spanIds.get(input.span_id!)?.eventId : undefined
    this.enqueue(() => {
      if (isSpan && input.phase !== 'started') {
        const existing = this.database.prepare('SELECT id FROM observation_records WHERE span_id = ?').get(input.span_id!)
        if (existing) {
          this.database.prepare(`UPDATE observation_records SET ended_at = ?, outcome = ?, duration_ms = ?,
            error_code = ?, error_message = ?, error_name = ?, error_stack = ?, diagnostic_details = ?, level = ?
            WHERE span_id = ? AND outcome = 'running'`)
            .run(event.timestamp, outcome, input.duration_ms ?? null, input.error_code || null,
              input.phase === 'failed' ? input.message : null, input.error_name || null,
              input.error_stack || null, values.diagnostic_details, input.level, input.span_id!)
          this.spanIds.delete(input.span_id!)
          return
        }
      }
      const columns = Object.keys(values)
      this.database.prepare(`INSERT INTO observation_records (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
        .run(...Object.values(values))
      if (++this.insertsSincePrune >= 500) {
        this.insertsSincePrune = 0
        this.prune()
      }
    })
    return originalId ? { ...event, event_id: originalId } : event
  }

  async close() { await this.flush(); if (this.retryTimer) clearTimeout(this.retryTimer); this.database.close() }
}
