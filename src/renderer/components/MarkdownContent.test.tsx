import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownContent } from './MarkdownContent'

describe('MarkdownContent', () => {
  it('renders completed and partial Markdown through the shared renderer', () => {
    expect(renderToStaticMarkup(<MarkdownContent>{'**done**'}</MarkdownContent>)).toContain('data-streamdown="strong">done</span>')
    expect(renderToStaticMarkup(<MarkdownContent streaming>{'**in progress'}</MarkdownContent>)).toContain('in progress')
  })

  it('preserves existing comfortable typography by default', () => {
    const html = renderToStaticMarkup(<MarkdownContent>{'Summary\n\n## Heading\n\nParagraph\n\n- First\n- Second'}</MarkdownContent>)
    expect(html).toContain('leading-6')
    expect(html).toContain('space-y-4')
    expect(html).toContain('class="my-3"')
    expect(html).toContain('mb-2 mt-6')
  })

  it('uses compact line and block spacing without stacked paragraph margins', () => {
    const html = renderToStaticMarkup(<MarkdownContent compact>{'Summary\n\n## Heading\n\nParagraph\n\n- First\n- Second'}</MarkdownContent>)
    expect(html).toContain('leading-[22px]')
    expect(html).not.toContain('leading-6')
    expect(html).toContain('space-y-2.5')
    expect(html).not.toContain('space-y-4')
    expect(html).toContain('<p>')
    expect(html).not.toContain('m-0')
    expect(html).toContain('space-y-1.5')
    expect(html).toContain('<li class="py-0">')
    expect(html).not.toContain('class="my-3"')
  })
})
