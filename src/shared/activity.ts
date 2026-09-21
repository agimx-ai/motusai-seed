import type { AuditCategory, AuditEntry } from './contracts'

const writeMethods = new Set([
  'create_directory',
  'delete',
  'edit',
  'edit_file',
  'import',
  'import_artifact',
  'mkdir',
  'move',
  'move_path',
  'trash_path',
  'upload',
  'write',
  'write_file',
])
const controlOperations = new Set([
  'account.login',
  'account.logout',
  'device.revoke',
  'grant.create',
  'grant.revoke',
  'grant.update',
  'plugin.install',
  'plugin.uninstall',
  'settings.launch_at_login',
  'settings.prevent_system_sleep',
])

export function activityCategory(entry: Pick<AuditEntry, 'operation' | 'capability' | 'source'>): Exclude<AuditCategory, 'all'> {
  const operation = entry.operation.toLowerCase()
  if (operation.startsWith('grant.')) return 'permissions'
  if (operation.startsWith('plugin.')) return 'plugins'
  if (entry.capability || entry.source === 'agent' || entry.source === 'plugin') return 'capabilities'
  return 'system'
}

export function activityRisk(entry: Pick<AuditEntry, 'operation' | 'method' | 'risk'>): NonNullable<AuditEntry['risk']> {
  if (entry.risk) return entry.risk
  const method = entry.method || entry.operation.split('.').at(-1) || ''
  if (writeMethods.has(method.toLowerCase())) return 'write'
  if (controlOperations.has(entry.operation.toLowerCase())) return 'control'
  return 'read'
}
