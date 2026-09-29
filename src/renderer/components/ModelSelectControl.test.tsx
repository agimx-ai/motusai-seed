import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModelSelectControl } from './ModelSelectControl'

describe('ModelSelectControl', () => {
  it('shows the selected model with the shared themed trigger', () => {
    const html = renderToStaticMarkup(<ModelSelectControl label="Model" value="model-1" onValueChange={() => undefined}
      options={[{ value: 'model-1', label: 'GPT-6 Sol', group: 'seed', iconDataUrl: 'data:image/png;base64,iVBORw0KGgo=' }]} />)
    expect(html).toContain('GPT-6 Sol')
    expect(html).toContain('aria-label="Model"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('seed-action-button')
    expect(html).toContain('data:image/png;base64,iVBORw0KGgo=')
    expect(html).toContain('border-border bg-card')
    expect(html).not.toContain('<select')
  })
})
