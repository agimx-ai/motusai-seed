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
})
