import type { SeedInvocation, SeedLocalApiClient } from '@motus-ai/seed-sdk'
import type { NativePluginRuntimeSnapshot, SeedPluginRuntimeDefinition, WorkerCommand } from './contracts'
import type { DiagnosticTraceContext, HostDiagnosticEvent } from './diagnostic-trace'

export type NativePluginOperation =
  | { type: 'invoke'; capability: string; method: string; invocation: SeedInvocation; chain: string[]; trace?: DiagnosticTraceContext }
  | { type: 'local-api'; url: string; method: string; headers: Array<[string, string]>; body?: Uint8Array; client: SeedLocalApiClient | null; trace?: DiagnosticTraceContext }
  | { type: 'local-api-read'; stream_id: string }
  | { type: 'local-api-close'; stream_id: string }
  | { type: 'configuration-options'; configuration_id: string; field_key: string; values: Record<string, string> }
  | { type: 'reconnect'; configuration_id: string; profile_id: string }

export type NativePluginCommand =
  | { type: 'start'; plugin: SeedPluginRuntimeDefinition; configuration: Extract<WorkerCommand, { type: 'configure' }> }
  | { type: 'call'; requestId: string; operation: NativePluginOperation }
  | { type: 'cancel'; requestId: string }
  | { type: 'host.result'; requestId: string; ok: boolean; result?: unknown; error?: string; errorCode?: string }
  | { type: 'stop' }

export type NativePluginEvent =
  | { type: 'ready'; snapshot: NativePluginRuntimeSnapshot }
  | { type: 'snapshot'; snapshot: NativePluginRuntimeSnapshot }
  | { type: 'result'; requestId: string; ok: boolean; result?: unknown; error?: string; errorCode?: string }
  | { type: 'host.invoke'; requestId: string; service: string; arguments: Record<string, unknown>; trace?: DiagnosticTraceContext }
  | { type: 'diagnostic'; event: string; message: string; error_name?: string; error_stack?: string }
  | { type: 'host.diagnostic'; entry: HostDiagnosticEvent }
  | { type: 'task.changed'; requestId: string; taskId: string; phase: 'started' | 'completed' | 'failed'; operation: string }
