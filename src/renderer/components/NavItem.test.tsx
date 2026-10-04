import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NavItem } from './NavItem'

describe('Navigation row height', () => {
  it('changes only row height in the compact variant', () => {
    const render = (size: 'default' | 'compact') => renderToStaticMarkup(<NavItem size={size} active icon={<span />} label="Plugins" onClick={() => {}} />)
    const original = render('default')
    const compact = render('compact')
    expect(original).toContain('h-8')
    expect(compact).toContain('h-[30px]')
    expect(compact.replace('h-[30px]', 'h-8')).toBe(original)
  })

  it('keeps the original height unless compact is requested', () => {
    const html = renderToStaticMarkup(<NavItem active={false} icon={<span />} label="Plugins" onClick={() => {}} />)
    expect(html).toContain('h-8')
    expect(html).not.toContain('h-[30px]')
  })

  it('uses foreground text only when requested, retaining the main navigation default', () => {
    const render = (tone?: 'muted' | 'foreground') => renderToStaticMarkup(<NavItem tone={tone} active={false} icon={<span />} label="Plugins" onClick={() => {}} />)
    expect(render()).toContain('bg-transparent text-muted-foreground')
    expect(render('foreground')).toContain('bg-transparent text-foreground')
    expect(render('foreground').replace('bg-transparent text-foreground', 'bg-transparent text-muted-foreground')).toBe(render())
  })

  it('changes only the icon gap when compact spacing is requested', () => {
    const render = (iconSpacing?: 'default' | 'compact') => renderToStaticMarkup(<NavItem iconSpacing={iconSpacing} active icon={<span />} label="Plugins" onClick={() => {}} />)
    expect(render()).toContain('gap-2.5')
    expect(render('compact')).not.toContain('gap-2.5')
    expect(render('compact').replace('gap-2', 'gap-2.5')).toBe(render())
    expect(render()).toContain('font-normal')
    expect(render()).not.toMatch(/font-medium|font-semibold|font-bold/)
  })
})
