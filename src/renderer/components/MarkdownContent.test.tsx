import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownContent } from './MarkdownContent'

describe('MarkdownContent', () => {
  it('renders completed and partial Markdown through the shared renderer', () => {
    expect(renderToStaticMarkup(<MarkdownContent>{'**done**'}</MarkdownContent>)).toContain('data-streamdown="strong">done</span>')
    expect(renderToStaticMarkup(<MarkdownContent streaming>{'**in progress'}</MarkdownContent>)).toContain('in progress')
  })
})
