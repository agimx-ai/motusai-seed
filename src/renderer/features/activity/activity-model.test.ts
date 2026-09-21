import { describe, expect, it } from 'vitest'
import type { AuditEntry } from '../../../shared/contracts'
import { activityCategory, activityHierarchy, activityRisk, filterActivityEntries, groupActivityEntriesByDay, pluginActivityPresentation, visibleActivityChildren } from './activity-model'

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'entry-1',
    timestamp: '2026-08-30T08:00:00.000Z',
    source: 'agent',
    operation: 'files.read_file',
    outcome: 'allowed',
    summary: '读取项目文件',
    ...overrides,
  }
}

describe('activity model', () => {
  it('uses localized plugin names and action labels without showing technical IDs in the list', () => {
    const management = entry({
      operation: 'plugin.com.example.tool.management.connect',
      summary: '已执行 com.example.tool 的管理动作 connect。',
      metadata: {
        plugin_id: 'com.example.tool',
        plugin_name_en_us: 'Example Tool',
        plugin_name_zh_hans: '示例工具',
        action_label_en_us: 'Connect',
        action_label_zh_hans: '连接',
      },
    })
    expect(pluginActivityPresentation(management, 'zh-CN')).toEqual({
      key: 'activity.pluginEvent.management.allowed',
      values: { pluginName: '示例工具', actionLabel: '连接', clientName: '客户端' },
    })
    expect(pluginActivityPresentation(management, 'en-US')?.values.pluginName).toBe('Example Tool')
    expect(pluginActivityPresentation(entry({ operation: 'plugin.uninstall', summary: '已卸载 com.example.tool@0.1.1。' }), 'zh-CN')?.values.pluginName).toBe('插件')
    expect(pluginActivityPresentation(entry(), 'zh-CN')).toBeNull()
  })
  it('classifies activity categories and risks', () => {
    expect(activityCategory(entry())).toBe('capabilities')
    expect(activityCategory(entry({ operation: 'recording.start' }))).toBe('capabilities')
    expect(activityCategory(entry({ operation: 'audio.transcription', capability: 'models' }))).toBe('capabilities')
    expect(activityCategory(entry({ operation: 'com.motusai.seed.files.list_directory', capability: 'com.motusai.seed.files' }))).toBe('capabilities')
    expect(activityCategory(entry({ operation: 'com.motusai.seed.audio.capture', capability: 'com.motusai.seed.audio' }))).toBe('capabilities')
    expect(activityCategory(entry({ operation: 'grant.create' }))).toBe('permissions')
    expect(activityCategory(entry({ operation: 'plugin.install' }))).toBe('plugins')
    expect(activityCategory(entry({ source: 'system', operation: 'logs.upload' }))).toBe('system')
    expect(activityRisk(entry({ operation: 'files.trash_path' }))).toBe('write')
    expect(activityRisk(entry({ operation: 'account.logout' }))).toBe('control')
    expect(activityRisk(entry({ operation: 'device.revoke' }))).toBe('control')
    expect(activityRisk(entry({ operation: 'logs.upload' }))).toBe('write')
  })

  it('combines status, risk, category and search filters', () => {
    const entries = [
      entry(),
      entry({ id: 'entry-2', operation: 'files.write_file', relativePath: 'docs/report.md', summary: '写入报告' }),
      entry({ id: 'entry-3', operation: 'recording.start', outcome: 'failed', summary: '录音启动失败' }),
      entry({ id: 'entry-4', operation: 'files.write_file', outcome: 'failed', summary: '写入失败' }),
      entry({ id: 'entry-5', operation: 'agent.run', outcome: 'interrupted', summary: '进程退出' }),
    ]
    expect(filterActivityEntries(entries, {
      category: 'all',
      status: 'attention',
      risk: 'all',
      query: '',
    }).map((item) => item.id)).toEqual(['entry-3', 'entry-4', 'entry-5'])
    expect(filterActivityEntries(entries, {
      category: 'all',
      status: 'all',
      risk: 'write',
      query: '',
    }).map((item) => item.id)).toEqual(['entry-2', 'entry-4'])
    expect(filterActivityEntries(entries, {
      category: 'all',
      status: 'attention',
      risk: 'write',
      query: '',
    }).map((item) => item.id)).toEqual(['entry-4'])
    expect(filterActivityEntries(entries, {
      category: 'capabilities',
      status: 'all',
      risk: 'all',
      query: 'report',
    }).map((item) => item.id)).toEqual(['entry-2'])
  })

  it('groups records by local calendar day', () => {
    const groups = groupActivityEntriesByDay([
      entry(),
      entry({ id: 'entry-2', timestamp: '2026-08-30T12:00:00.000Z' }),
      entry({ id: 'entry-3', timestamp: '2026-08-29T12:00:00.000Z' }),
    ])
    expect(groups.map((group) => group.entries.length)).toEqual([2, 1])
  })

  it('keeps the call tree while collapsing technical broker nodes by default', () => {
    const records = [
      entry({ id: 'root', traceId: 'trace', spanId: 'root', recordKind: 'span' }),
      entry({ id: 'broker', traceId: 'trace', spanId: 'broker', parentSpanId: 'root',
        recordKind: 'span', visibility: 'technical' }),
      entry({ id: 'provider', traceId: 'trace', spanId: 'provider', parentSpanId: 'broker',
        recordKind: 'span', visibility: 'activity' }),
      entry({ id: 'error', traceId: 'trace', parentSpanId: 'broker',
        recordKind: 'event', visibility: 'technical' }),
    ]
    const hierarchy = activityHierarchy(records)
    expect(hierarchy.roots.map((item) => item.id)).toEqual(['root'])
    expect(visibleActivityChildren('root', hierarchy.childrenByParent).map((item) => item.id)).toEqual(['provider'])
  })
})
