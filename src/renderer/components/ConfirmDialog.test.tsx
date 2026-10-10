import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }))

describe('ConfirmDialog presentation', () => {
  function render(icon?: ReactNode) {
    vi.stubGlobal('document', { body: {} })
    try {
      return renderToStaticMarkup(<ConfirmDialog open title="Title" icon={icon} confirmLabel="OK" cancelLabel="Cancel" onConfirm={() => {}} onCancel={() => {}}>Body</ConfirmDialog>)
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

  it('preserves the standard confirmation layout and actions', () => {
    const html = render()
    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('max-w-[390px]')
    expect(html).toContain('px-3.5 py-3')
    expect(html).toContain('>Cancel</button>')
    expect(html).toContain('>OK</button>')
  })
})
