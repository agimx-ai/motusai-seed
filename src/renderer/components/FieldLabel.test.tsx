import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FieldLabel } from './FieldLabel'

describe('FieldLabel', () => {
  it('renders declared help as a focusable tooltip trigger without inline copy', () => {
    const markup = renderToStaticMarkup(<FieldLabel description="Choose the provider.">Provider</FieldLabel>)
    expect(markup).toContain('Provider')
    expect(markup).toContain('aria-label="Choose the provider."')
    expect(markup).toContain('tabindex="0"')
    expect(markup).not.toContain('>Choose the provider.<')
  })

  it('does not render a help trigger when no description is declared', () => {
    const markup = renderToStaticMarkup(<FieldLabel>Provider</FieldLabel>)
    expect(markup).not.toContain('tabindex="0"')
  })

  it('renders the help trigger as an external link when a help URL is declared', () => {
    const markup = renderToStaticMarkup(<FieldLabel description="Choose the provider." helpUrl="https://docs.example.com/providers">Provider</FieldLabel>)
    expect(markup).toContain('href="https://docs.example.com/providers"')
    expect(markup).toContain('target="_blank"')
    expect(markup).toContain('rel="noreferrer"')
  })
})
