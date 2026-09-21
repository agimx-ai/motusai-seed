import type { AuditCategory, AuditEntry, AuditRiskFilter, AuditStatusFilter } from '../../../shared/contracts'
import { activityCategory, activityRisk } from '../../../shared/activity'

export { activityCategory, activityRisk }

export function pluginActivityPresentation(entry: AuditEntry, locale: string) {
  const metadata = entry.metadata
  const english = locale.toLowerCase().startsWith('en')
  const pluginName = String((english ? metadata?.plugin_name_en_us : metadata?.plugin_name_zh_hans) || (english ? 'plugin' : '插件'))
  const actionLabel = String((english ? metadata?.action_label_en_us : metadata?.action_label_zh_hans) || (english ? 'management action' : '管理操作'))
  const clientName = String(metadata?.client_name || (english ? 'client' : '客户端'))
  const values = { pluginName, actionLabel, clientName }
  if (entry.operation === 'plugin.install') return { key: `activity.pluginEvent.install.${entry.outcome}`, values }
  if (entry.operation === 'plugin.uninstall') return { key: `activity.pluginEvent.uninstall.${entry.outcome}`, values }
  if (entry.operation === 'plugin.authorization') return { key: `activity.pluginEvent.authorization.${entry.outcome}`, values }
  if (entry.operation === 'plugin.runtime.start' && entry.outcome === 'failed') return { key: 'activity.pluginEvent.runtime.failed', values }
  if (entry.operation === 'settings.plugin_configuration' && entry.outcome === 'allowed') return { key: 'activity.pluginEvent.configuration.allowed', values }
  if ((entry.operation === 'local_client.authorize' || entry.operation === 'local_client.scope.grant') && entry.outcome === 'allowed') {
    return { key: 'activity.pluginEvent.client.allowed', values }
  }
  if (/^plugin\.[a-z][a-z0-9.-]+\.management\.[a-z][a-z0-9_.-]+$/.test(entry.operation)) {
    return { key: `activity.pluginEvent.management.${entry.outcome}`, values }
  }
  return null
}

export function isAttentionEntry(entry: AuditEntry) {
  return entry.outcome === 'denied' || entry.outcome === 'failed' || entry.outcome === 'interrupted'
}

export function filterActivityEntries(
  entries: AuditEntry[],
  options: { category: AuditCategory; status: AuditStatusFilter; risk: AuditRiskFilter; query: string },
) {
  const query = options.query.trim().toLocaleLowerCase()
  return entries.filter((entry) => {
    if (options.category !== 'all' && activityCategory(entry) !== options.category) return false
    if (options.status === 'attention' && !isAttentionEntry(entry)) return false
    if (options.risk !== 'all' && activityRisk(entry) !== options.risk) return false
    if (!query) return true
    return [entry.summary, entry.operation, entry.relativePath, entry.capability, entry.method, entry.errorCode]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(query))
  })
}

export function groupActivityEntriesByDay(entries: AuditEntry[]) {
  const groups = new Map<string, AuditEntry[]>()
  for (const entry of entries) {
    const date = new Date(entry.timestamp)
    const key = Number.isNaN(date.getTime()) ? 'invalid' : `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
    const group = groups.get(key)
    if (group) group.push(entry)
    else groups.set(key, [entry])
  }
  return [...groups.entries()].map(([key, items]) => ({ key, entries: items }))
}

export function activityHierarchy(entries: AuditEntry[]) {
  const spans = new Set(entries.map((entry) => entry.spanId).filter((id): id is string => Boolean(id)))
  const children = new Map<string, AuditEntry[]>()
  const roots: AuditEntry[] = []
  for (const entry of entries) {
    if (entry.parentSpanId && spans.has(entry.parentSpanId)) {
      const siblings = children.get(entry.parentSpanId) || []
      siblings.push(entry)
      children.set(entry.parentSpanId, siblings)
    } else roots.push(entry)
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return { roots, childrenByParent: children }
}

export function visibleActivityChildren(spanId: string, childrenByParent: Map<string, AuditEntry[]>): AuditEntry[] {
  return (childrenByParent.get(spanId) || []).flatMap((child) => {
    if (child.visibility !== 'technical') return [child]
    return child.spanId ? visibleActivityChildren(child.spanId, childrenByParent) : []
  })
}
