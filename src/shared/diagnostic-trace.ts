/** Seed-owned correlation data. Plugins may see request IDs, but cannot author these spans. */
export type DiagnosticTraceContext = {
  trace_id: string
  span_id: string
  parent_span_id?: string
  activity_visibility?: 'activity' | 'technical'
  /** Host-authenticated amount returned by Cloud after a successful settlement. */
  credit_charged_amount?: number
}

export type HostDiagnosticEvent = DiagnosticTraceContext & {
  phase: 'started' | 'completed' | 'failed'
  event: string
  plugin_id: string
  plugin_version?: string
  request_id: string
  operation: string
  duration_ms?: number
  error_code?: string
  error_name?: string
  error_stack?: string
  message: string
  details?: Record<string, string | number | boolean | null>
}
