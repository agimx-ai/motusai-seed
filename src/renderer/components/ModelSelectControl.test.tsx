import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModelSelectControl, modelSelectionThinking } from './ModelSelectControl'

describe('ModelSelectControl', () => {
  it('keeps the default trigger unchanged and applies the complete form control appearance for the form size', () => {
    const props = { label: 'Model', value: 'one', options: [{ value: 'one', label: 'Test model', thinkingLevels: ['off', 'high'] }], thinkingValue: 'high', onChange: () => undefined }
    const defaultHtml = renderToStaticMarkup(<ModelSelectControl {...props} />)
    expect(renderToStaticMarkup(<ModelSelectControl {...props} loading={false} />)).toBe(defaultHtml)
    const explicitDefault = renderToStaticMarkup(<ModelSelectControl {...props} size="default" />)
    const formHtml = renderToStaticMarkup(<ModelSelectControl {...props} size="form" />)
    expect(explicitDefault).toBe(defaultHtml)
    expect(formHtml).toContain('style="height:var(--text-input-height)"')
    expect(formHtml).not.toContain('width:100%')
    expect(formHtml).toContain('relative inline-flex shrink-0')
    expect(formHtml).toContain('aria-haspopup="dialog"')
    expect(defaultHtml).toContain('seed-action-button')
    expect(defaultHtml).toContain('border-border')
    expect(defaultHtml).toContain('px-2')
    expect(formHtml).not.toContain('seed-action-button')
    expect(formHtml).toContain('border-input')
    expect(formHtml).toContain('px-[var(--text-input-padding-x)]')
    expect(formHtml).toContain('text-[var(--text-input-font-size)]')
    expect(formHtml).toContain('rounded-[var(--radius-control)]')
    expect(formHtml).toContain('focus-visible:border-foreground/35')
    expect(defaultHtml).toContain('Test model')
    expect(defaultHtml).toContain('· plugins.managementThinking.high')
  })
  it('shows the selected model with the shared themed trigger', () => {
    const html = renderToStaticMarkup(<ModelSelectControl label="Model" value="model-1" onChange={() => undefined}
      options={[{ value: 'model-1', label: 'GPT-6 Sol', group: 'seed', iconDataUrl: 'data:image/png;base64,iVBORw0KGgo=' }]} />)
    expect(html).toContain('GPT-6 Sol')
    expect(html).not.toContain('· Default')
    expect(html).toContain('aria-label="Model"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('seed-action-button')
    expect(html).toContain('justify-start gap-2')
    expect(html).not.toContain('justify-start gap-3')
    expect(html).toContain('ml-auto')
    expect(html).toContain('data:image/png;base64,iVBORw0KGgo=')
    expect(html).toContain('border-border bg-card')
    expect(html).not.toContain('<select')
  })

  it('retains supported thinking and clears unsupported choices without inventing a level', () => {
    expect(modelSelectionThinking(['off', 'high'], 'high')).toBe('high')
    expect(modelSelectionThinking(['off', 'low'], 'high')).toBe('')
    expect(modelSelectionThinking([], 'off')).toBe('')
    expect(modelSelectionThinking(undefined, 'high')).toBe('')
  })

  it('does not display the first model as if a missing or removed model were selected', () => {
    for (const value of ['', 'removed']) {
      const html = renderToStaticMarkup(<ModelSelectControl label="Choose model" value={value} onChange={() => undefined}
        options={[{ value: 'first', label: 'Unexpected first model' }]} />)
      expect(html).toContain('Choose model')
      expect(html).not.toContain('Unexpected first model')
    }
  })
})
