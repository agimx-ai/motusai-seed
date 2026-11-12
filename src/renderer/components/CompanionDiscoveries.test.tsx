// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedI18nResources } from '../i18n/resources'
import type { CompanionDiscovery } from '../../shared/companion-discoveries'
import { prepareDiscoveries, discoveryFrontLook, discoveryIdleDelay, discoveryTiming } from '../lib/companion-discoveries'
import { BotEngine, type BotFrame } from '@motus-ai/seed-sdk/companion'
import { bloubStateForPresentation } from '../lib/bloub/presentation'
import type { CompanionVisualState } from '../lib/companion'
import { CompanionDiscoveries } from './CompanionDiscoveries'
import { SeedlingMascot } from './SeedlingMascot'


const discoveryItems = [
  { corner: 'top-left', enabled: true, title: { 'zh-CN': '让 MotusAI 主动关心你', 'en-US': 'Let MotusAI look out for you' }, url: 'https://motusseed.com/guides/use-personal-assistant' },
  { corner: 'bottom-left', enabled: true, title: { 'zh-CN': '让 AI 记住你的偏好', 'en-US': 'Let AI remember your preferences' }, url: 'https://motusseed.com/guides/use-global-memory' },
  { corner: 'top-right', enabled: true, title: { 'zh-CN': '把 MotusAI 带进微信', 'en-US': 'Bring MotusAI into WeChat' }, url: 'https://motusseed.com/guides/use-motusai-in-weixin' },
  { corner: 'bottom-right', enabled: true, title: { 'zh-CN': '把 MotusAI 带进企业微信', 'en-US': 'Bring MotusAI into WeCom' }, url: 'https://motusseed.com/guides/use-motusai-in-wecom' },
] as const
const items: CompanionDiscovery[] = discoveryItems.map((item) => ({ ...item, title: { ...item.title } }))
const companionDiscoveries = prepareDiscoveries(items)

const i18n = createInstance()
void i18n.init({ lng: 'zh-CN', fallbackLng: 'zh-CN', defaultNS: 'app', resources: seedI18nResources, initAsync: false })

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  // Advance the carousel clock separately from the production SVG animation clock.
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete document.documentElement.dataset.reducedMotion
})

function advance(ms: number) { act(() => vi.advanceTimersByTime(ms)) }

function page(state: CompanionVisualState = 'idle') {
  return <I18nextProvider i18n={i18n}><CompanionDiscoveries state={state} label="和伙伴互动" items={items} /></I18nextProvider>
}

function visibleBubble(container: HTMLElement) {
  return container.querySelector<HTMLElement>('.seed-discovery[data-phase="visible"]')
}

describe('companion discovery rotation', () => {
  it('shows link arrows only for destinations and keeps plain introductions out of the tab order', () => {
    document.documentElement.dataset.reducedMotion = 'true'
    const mixed = items.map((item, index) => ({ ...item, url: index === 0 ? '' : index === 1 ? undefined : item.url }))
    const view = render(<I18nextProvider i18n={i18n}><CompanionDiscoveries state="idle" label="和伙伴互动" items={mixed} /></I18nextProvider>)
    advance(discoveryIdleDelay)
    expect(view.container.querySelectorAll('.seed-discovery[data-phase="visible"]')).toHaveLength(4)
    expect(view.getAllByRole('link')).toHaveLength(2)
    for (const item of mixed) {
      const title = view.getByText(item.title['zh-CN'])
      const bubble = title.parentElement!
      expect(bubble.tagName).toBe(item.url ? 'A' : 'SPAN')
      expect(title.querySelector('svg') !== null).toBe(!!item.url)
      if (!item.url) {
        expect(bubble.hasAttribute('href')).toBe(false)
        expect(bubble.hasAttribute('tabindex')).toBe(false)
        expect(bubble.hasAttribute('target')).toBe(false)
        expect(bubble.tabIndex).toBe(-1)
      }
    }
    const renderItems = (values: CompanionDiscovery[]) => <I18nextProvider i18n={i18n}><CompanionDiscoveries state="idle" label="和伙伴互动" items={values} /></I18nextProvider>
    view.rerender(renderItems(mixed.map((item) => ({ ...item, url: undefined }))))
    expect(view.queryAllByRole('link')).toHaveLength(0)
    expect(view.container.querySelectorAll('.seed-discovery-title svg')).toHaveLength(0)
    view.rerender(renderItems(items))
    expect(view.getAllByRole('link')).toHaveLength(4)
    expect(view.container.querySelectorAll('.seed-discovery-title svg')).toHaveLength(4)
  })

  it('rotates plain introductions normally and preserves their hover reading time', () => {
    const plain = items.map((item) => ({ ...item, url: '' }))
    const view = render(<I18nextProvider i18n={i18n}><CompanionDiscoveries state="idle" label="和伙伴互动" items={plain} /></I18nextProvider>)
    advance(discoveryIdleDelay)
    advance(discoveryTiming.look)
    expect(visibleBubble(view.container)?.textContent).toBe(plain[0]!.title['zh-CN'])
    expect(view.queryAllByRole('link')).toHaveLength(0)
    fireEvent.mouseEnter(visibleBubble(view.container)!)
    advance(discoveryTiming.visible + 5000)
    expect(view.container.querySelectorAll('.seed-discovery[data-phase="visible"]')).toHaveLength(1)
    fireEvent.mouseLeave(visibleBubble(view.container)!)
    advance(discoveryTiming.visible)
    advance(discoveryTiming.look)
    expect(view.container.querySelectorAll('.seed-discovery[data-phase="visible"]')).toHaveLength(2)
  })

  it('retains each introduction, faces front and winks, then clears all four before restarting', () => {
    const looks = vi.spyOn(BotEngine.prototype, 'setLook')
    const states = vi.spyOn(BotEngine.prototype, 'setState')
    const view = render(page())
    expect(visibleBubble(view.container)).toBeNull()
    advance(discoveryIdleDelay)
    for (const index of [0, 1, 2, 3]) {
      const item = companionDiscoveries[index]!
      expect(view.queryAllByRole('link')).toHaveLength(index)
      expect(looks.mock.calls.at(-1)?.[0]).toEqual(item.look)
      advance(discoveryTiming.look)
      const links = view.getAllByRole('link')
      expect(links).toHaveLength(index + 1)
      expect(links[index]!.closest('.seed-discovery')?.getAttribute('data-corner')).toBe(item.corner)
      expect(links[index]!.getAttribute('href')).toBe(item.url)
      expect(links[index]!.getAttribute('target')).toBe('_blank')
      const tails = view.container.querySelectorAll('.seed-discovery[data-looking="true"]')
      expect(tails).toHaveLength(1)
      expect(tails[0]!.getAttribute('data-corner')).toBe(item.corner)
      advance(discoveryTiming.visible)
      expect(view.container.querySelectorAll('.seed-discovery[data-looking="true"]')).toHaveLength(0)
    }
    expect(view.getAllByRole('link')).toHaveLength(4)
    expect(looks.mock.calls.at(-1)?.[0]).toEqual(discoveryFrontLook)
    expect(states.mock.calls.at(-1)?.[0]).toBe('idle')
    advance(discoveryTiming.front)
    expect(states.mock.calls.at(-1)?.[0]).toBe('wink')
    advance(discoveryTiming.wink)
    expect(states.mock.calls.at(-1)?.[0]).toBe('idle')
    expect(view.getAllByRole('link')).toHaveLength(4)
    advance(discoveryTiming.rest)
    expect(view.queryAllByRole('link')).toHaveLength(0)
    expect(view.container.querySelectorAll('[data-phase="leaving"]')).toHaveLength(4)
    advance(discoveryTiming.leaving)
    expect(visibleBubble(view.container)).toBeNull()
    advance(discoveryTiming.gap)
    expect(looks.mock.calls.at(-1)?.[0]).toEqual(companionDiscoveries[0]!.look)
    advance(discoveryTiming.look)
    expect(view.getAllByRole('link')).toHaveLength(1)
    expect(visibleBubble(view.container)?.dataset.corner).toBe('top-left')
  })

  it('keeps the current cycle stable and applies changed or disabled introductions on the next cycle', () => {
    const changed = items.map((item, index) => ({ ...item, enabled: index === 3, title: { ...item.title, 'zh-CN': '新的介绍' } }))
    const view = render(page())
    advance(discoveryIdleDelay)
    advance(discoveryTiming.look)
    view.rerender(<I18nextProvider i18n={i18n}><CompanionDiscoveries state="idle" label="和伙伴互动" items={changed} /></I18nextProvider>)
    expect(view.getByRole('link').textContent).toContain(items[0]!.title['zh-CN'])
    for (let index = 0; index < 4; index++) {
      advance(discoveryTiming.visible)
      if (index < 3) advance(discoveryTiming.look)
    }
    advance(discoveryTiming.front)
    advance(discoveryTiming.wink)
    advance(discoveryTiming.rest)
    advance(discoveryTiming.leaving)
    advance(discoveryTiming.gap)
    advance(discoveryTiming.look)
    expect(view.getAllByRole('link')).toHaveLength(1)
    expect(view.getByRole('link').textContent).toContain('新的介绍')
    expect(visibleBubble(view.container)?.dataset.corner).toBe('bottom-right')
  })

  it('starts when content arrives and removes every introduction when all positions are disabled', () => {
    const renderItems = (values: typeof items) => <I18nextProvider i18n={i18n}><CompanionDiscoveries state="idle" label="和伙伴互动" items={values} /></I18nextProvider>
    const view = render(renderItems([]))
    advance(discoveryIdleDelay + 10_000)
    expect(view.queryAllByRole('link')).toHaveLength(0)
    view.rerender(renderItems(items))
    advance(discoveryTiming.look)
    expect(view.getAllByRole('link')).toHaveLength(1)
    view.rerender(renderItems(items.map((item) => ({ ...item, enabled: false }))))
    for (let index = 0; index < 4; index++) {
      advance(discoveryTiming.visible)
      if (index < 3) advance(discoveryTiming.look)
    }
    advance(discoveryTiming.front)
    advance(discoveryTiming.wink)
    advance(discoveryTiming.rest)
    advance(discoveryTiming.leaving)
    advance(discoveryTiming.gap + 20_000)
    expect(view.queryAllByRole('link')).toHaveLength(0)
  })

  it('preserves reading time through hover, keyboard focus and backgrounding', () => {
    const view = render(page())
    advance(discoveryIdleDelay)
    advance(discoveryTiming.look)
    advance(500)
    const bubble = visibleBubble(view.container)!
    fireEvent.mouseEnter(bubble)
    advance(20_000)
    expect(visibleBubble(view.container)).toBe(bubble)
    fireEvent.mouseLeave(bubble)
    fireEvent.focus(view.getByRole('link'))
    advance(20_000)
    expect(visibleBubble(view.container)).toBe(bubble)
    fireEvent.blur(view.getByRole('link'), { relatedTarget: null })
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    advance(20_000)
    expect(visibleBubble(view.container)).toBe(bubble)
    hidden.mockReturnValue(false)
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    advance(discoveryTiming.visible - 500 - 1)
    expect(visibleBubble(view.container)).toBe(bubble)
    advance(1)
    expect(view.getAllByRole('link')).toHaveLength(1)
    expect(view.container.querySelector('.seed-companion-stage')?.getAttribute('data-discovery-phase')).toBe('look')
  })

  it('starts and continues while the visible window is unfocused, without any click', () => {
    const view = render(page())
    act(() => window.dispatchEvent(new Event('blur')))
    advance(discoveryIdleDelay)
    advance(discoveryTiming.look)
    expect(view.getAllByRole('link')).toHaveLength(1)
    expect(view.container.querySelector('[data-looking="true"]')?.getAttribute('data-corner')).toBe('top-left')
    advance(discoveryTiming.visible)
    advance(discoveryTiming.look)
    expect(view.getAllByRole('link')).toHaveLength(2)
    expect(view.container.querySelector('[data-looking="true"]')?.getAttribute('data-corner')).toBe('bottom-left')
  })

  it('yields to task states and existing mascot click reactions, then resumes after the idle morph', () => {
    const looks = vi.spyOn(BotEngine.prototype, 'setLook')
    const view = render(page())
    advance(discoveryIdleDelay)
    advance(discoveryTiming.look)
    advance(1_000)
    view.rerender(page('working'))
    expect(looks.mock.calls.at(-1)?.[0]).toBeNull()
    expect(view.container.querySelectorAll('[data-looking="true"]')).toHaveLength(0)
    advance(30_000)
    expect(visibleBubble(view.container)?.dataset.corner).toBe('top-left')
    view.rerender(page())
    advance(discoveryIdleDelay - 1)
    expect(looks.mock.calls.at(-1)?.[0]).toBeNull()
    advance(1)
    expect(looks.mock.calls.at(-1)?.[0]).toEqual(companionDiscoveries[0]!.look)
    fireEvent.click(view.getByRole('button', { name: '和伙伴互动' }))
    expect(looks.mock.calls.at(-1)?.[0]).toBeNull()
    expect(view.queryAllByRole('link')).toHaveLength(0)
    advance(1_150)
    expect(looks.mock.calls.at(-1)?.[0]).toBeNull()
    expect(view.queryAllByRole('link')).toHaveLength(0)
    advance(discoveryIdleDelay)
    expect(looks.mock.calls.at(-1)?.[0]).toEqual(companionDiscoveries[0]!.look)
  })

  it('clears all introductions on a mascot click and restarts at top-left after repeated interactions', () => {
    const states = vi.spyOn(BotEngine.prototype, 'setState')
    const view = render(page())
    advance(discoveryIdleDelay)
    for (let index = 0; index < 4; index++) {
      advance(discoveryTiming.look)
      if (index < 3) advance(discoveryTiming.visible)
    }
    expect(view.getAllByRole('link')).toHaveLength(4)
    // A focused old link must not leave the new cycle permanently paused.
    fireEvent.focus(view.getAllByRole('link')[2]!)
    const mascot = view.getByRole('button', { name: '和伙伴互动' })
    fireEvent.click(mascot)
    expect(states.mock.calls.at(-1)?.[0]).toBe('wide')
    expect(view.queryAllByRole('link')).toHaveLength(0)
    expect(view.container.querySelector('.seed-companion-stage')?.getAttribute('data-interacting')).toBe('true')
    advance(1_000)
    fireEvent.click(mascot)
    expect(states.mock.calls.at(-1)?.[0]).toBe('wink')
    advance(1_149)
    expect(view.queryAllByRole('link')).toHaveLength(0)
    advance(1)
    expect(view.queryAllByRole('link')).toHaveLength(0)
    advance(discoveryIdleDelay)
    advance(discoveryTiming.look - 1)
    expect(view.queryAllByRole('link')).toHaveLength(0)
    advance(1)
    expect(view.getAllByRole('link')).toHaveLength(1)
    expect(visibleBubble(view.container)?.dataset.corner).toBe('top-left')
  })

  it('stays static in reduced motion without carousel controls and cleans up every timer on unmount', async () => {
    document.documentElement.dataset.reducedMotion = 'true'
    const looks = vi.spyOn(BotEngine.prototype, 'setLook')
    const view = render(page())
    advance(60_000)
    expect(visibleBubble(view.container)?.dataset.corner).toBe('top-left')
    expect(view.getAllByRole('link')).toHaveLength(4)
    expect(view.container.querySelectorAll('[data-looking="true"]')).toHaveLength(0)
    expect(looks).not.toHaveBeenCalled()
    expect(view.getAllByRole('button')).toHaveLength(1)
    await act(async () => { delete document.documentElement.dataset.reducedMotion })
    expect(view.getAllByRole('button')).toHaveLength(1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('interrupts the closing wink for a task and resumes without losing the four introductions', () => {
    const states = vi.spyOn(BotEngine.prototype, 'setState')
    const looks = vi.spyOn(BotEngine.prototype, 'setLook')
    const view = render(page())
    advance(discoveryIdleDelay)
    for (let index = 0; index < 4; index++) {
      advance(discoveryTiming.look)
      advance(discoveryTiming.visible)
    }
    advance(discoveryTiming.front)
    expect(states.mock.calls.at(-1)?.[0]).toBe('wink')
    view.rerender(page('working'))
    expect(states.mock.calls.at(-1)?.[0]).toBe('thinking')
    expect(looks.mock.calls.at(-1)?.[0]).toBeNull()
    advance(20_000)
    expect(view.getAllByRole('link')).toHaveLength(4)
    view.rerender(page())
    advance(discoveryIdleDelay)
    expect(states.mock.calls.at(-1)?.[0]).toBe('wink')
    advance(discoveryTiming.wink)
    expect(states.mock.calls.at(-1)?.[0]).toBe('idle')
    expect(looks.mock.calls.at(-1)?.[0]).toEqual(discoveryFrontLook)
  })

})

describe('original Bloub animation preservation', () => {
  it.each<CompanionVisualState>(['running', 'working', 'waiting', 'review', 'failed', 'listening', 'paused', 'processing'])(
    'renders the original %s frames even when a discovery look is supplied', (state) => {
      const sample = vi.spyOn(BotEngine.prototype, 'sample')
      let raf: FrameRequestCallback | undefined
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { raf = callback; return 1 })
      render(<SeedlingMascot state={state} label="伙伴" look={companionDiscoveries[0]!.look} idleAnimation="wink" />)
      const original = new BotEngine(100, bloubStateForPresentation(state))
      const assertFrame = (frame: BotFrame) => {
        expect(frame.eyes).toEqual(original.sample(0).eyes)
        expect(frame.bodyPath).toBe(original.sample(0).bodyPath)
      }
      act(() => raf?.(1_000))
      assertFrame(sample.mock.results.at(-1)!.value as BotFrame)
    },
  )
})
