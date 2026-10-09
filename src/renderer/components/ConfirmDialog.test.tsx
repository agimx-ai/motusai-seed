import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }))

describe('ConfirmDialog presentation', () => {
  function render(icon?: ReactNode, contentPadding?: boolean) {
    vi.stubGlobal('document', { body: {} })
    try {
      return renderToStaticMarkup(<ConfirmDialog open title="Title" icon={icon} contentPadding={contentPadding} confirmLabel="OK" cancelLabel="Cancel" onConfirm={() => {}} onCancel={() => {}}>Body</ConfirmDialog>)
    } finally {
      vi.unstubAllGlobals()
    }
  }

  it('keeps the default icon when no icon is specified', () => {
    expect(render()).toContain('lucide-shield-check')
  })

  it('renders a supplied icon instead of the default', () => {
    const html = render(<span>Custom icon</span>)
    expect(html).toContain('Custom icon')
    expect(html).not.toContain('lucide-shield-check')
  })

  it('removes the icon and its container when null is specified', () => {
    const html = render(null)
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('aria-hidden="true"')
    expect(html).not.toContain('<span')
    expect(html).toContain('Title')
    expect(html).toContain('Body')
  })

  it('preserves content padding for existing callers', () => {
    expect(render()).toContain('px-3.5 py-3')
  })

  it('lets scrollable content reach the background edge while clipping its corners', () => {
    const html = render(undefined, false)
    expect(html).not.toContain('px-3.5 py-3')
    expect(html).toContain('leading-5 overflow-hidden')
  })
})
