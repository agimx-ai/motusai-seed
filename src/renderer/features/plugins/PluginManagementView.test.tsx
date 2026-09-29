import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { seedPluginManagementViewSchema } from '../../../shared/plugin-manifest'
import { PluginManagementSkeleton } from './PluginManagementView'

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
