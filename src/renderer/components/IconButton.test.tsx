import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { IconButton } from './IconButton'

describe('IconButton', () => {
  it('keeps its accessible label without a visible tooltip when disabled for that instance', () => {
    const html = renderToStaticMarkup(<IconButton icon={<span>×</span>} label="Remove file" tone="danger-hover" showTooltip={false} />)
    expect(html).toMatch(/^<button\b/)
    expect(html).toContain('aria-label="Remove file"')
    expect(html).toContain('text-muted-foreground hover:text-danger')
  })
})
