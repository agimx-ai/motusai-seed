import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { seedPluginManagementViewSchema } from '../../../shared/plugin-manifest'
import { managementResultShouldDismiss, managementResultTitle, PluginManagementSkeleton } from './PluginManagementView'

const text = (value: string) => ({ en_US: value, zh_Hans: value })

describe('PluginManagementSkeleton', () => {
  it('uses the declared panel blocks and toolbar without plugin-specific content', () => {
    const view = seedPluginManagementViewSchema.parse({
      id: 'example', renderer: 'seed.panel', title: text('Example'), description: text('Example'),
      props: { blocks: [
        { type: 'status', state_path: 'state', states: { ready: text('Ready') } },
        { type: 'markdown', value_path: 'output' },
      ] },
      toolbar: [{ type: 'refresh' }],
    })
    const html = renderToStaticMarkup(<PluginManagementSkeleton view={view} label="Loading plugin view" />)
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="Loading plugin view"')
    expect(html).toContain('motion-reduce:animate-none')
    expect(html).not.toContain('Ready')
  })

  it('renders a list placeholder for a collection view', () => {
    const view = seedPluginManagementViewSchema.parse({
      id: 'examples', renderer: 'seed.collection', title: text('Examples'), description: text('Examples'),
      props: { presentation: { layout: 'list' } },
    })
    const html = renderToStaticMarkup(<PluginManagementSkeleton view={view} label="Loading" />)
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-hidden="true"')
  })
})

describe('managementResultTitle', () => {
  it('does not stringify the action result when no title path is declared', () => {
    const view = seedPluginManagementViewSchema.parse({
      id: 'qr', renderer: 'seed.panel', title: text('QR'), description: text('QR'), props: { blocks: [{ type: 'text', value_path: 'status' }] },
      toolbar: [{ type: 'action', action_id: 'start' }],
      actions: [{
        id: 'start', label: { en_US: 'Scan', zh_Hans: '扫码添加' },
        target: { capability: 'binding', method: 'start', arguments: {} },
        result: { mode: 'modal', renderer: 'qr', title: { en_US: 'Connect account', zh_Hans: '连接账户' }, content_path: 'qr' },
      }],
    })
    expect(managementResultTitle(view.actions[0], { qr: 'data:image/png;base64,AAAA' }, 'zh-CN')).toBe('连接账户')
  })

  it('localizes a dynamic title instead of rendering an object string', () => {
    const view = seedPluginManagementViewSchema.parse({
      id: 'result', renderer: 'seed.panel', title: text('Result'), description: text('Result'), props: { blocks: [{ type: 'text', value_path: 'status' }] },
      toolbar: [{ type: 'action', action_id: 'open' }],
      actions: [{
        id: 'open', label: text('Open'), target: { capability: 'result', method: 'open', arguments: {} },
        result: { mode: 'modal', renderer: 'text', title_path: 'title', content_path: 'content' },
      }],
    })
    expect(managementResultTitle(view.actions[0], { title: { en_US: 'Result', zh_Hans: '结果' }, content: 'ok' }, 'zh-CN')).toBe('结果')
  })

  it('dismisses a result only after its declared state transition', () => {
    const view = seedPluginManagementViewSchema.parse({
      id: 'qr', renderer: 'seed.panel', title: text('QR'), description: text('QR'), props: { blocks: [{ type: 'text', value_path: 'status' }] },
      toolbar: [{ type: 'action', action_id: 'start' }],
      actions: [{
        id: 'start', label: text('Start'), target: { capability: 'binding', method: 'start' },
        result: { mode: 'modal', renderer: 'qr', content_path: 'qr', dismiss_when: { path: 'state', in: ['saving', 'connected'] }, close_action_id: 'cancel' },
      }, {
        id: 'cancel', label: text('Cancel'), placement: 'result_close', target: { capability: 'binding', method: 'cancel' },
      }],
    })
    expect(managementResultShouldDismiss(view.actions[0], { state: 'pending' })).toBe(false)
    expect(managementResultShouldDismiss(view.actions[0], { state: 'saving' })).toBe(true)
  })
})
