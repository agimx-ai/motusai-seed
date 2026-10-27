// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdaptiveIcon } from './ResourceCard'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('resource icon network failures', () => {
  it('replaces a broken image with the normal placeholder without changing its size', () => {
    const h = render(<AdaptiveIcon iconUrl="https://example.com/icon.svg" large />)
    const frame = h.container.firstElementChild!
    expect(frame.className).toContain('h-14 w-14')
    expect(h.container.querySelector('svg')).not.toBeNull()
    fireEvent.error(h.container.querySelector('img')!)
    expect(h.container.querySelector('img')).toBeNull()
    expect(h.container.querySelector('svg')).not.toBeNull()
    expect(h.container.firstElementChild).toBe(frame)
  })

  it('uses the supplied fallback for failed images', () => {
    const h = render(<AdaptiveIcon iconUrl="https://example.com/icon.svg" fallback={<span>fallback</span>} />)
    fireEvent.error(h.container.querySelector('img')!)
    expect(h.container.textContent).toBe('fallback')
  })

  it('tries the light image when the dark image fails, then falls back if both fail', () => {
    const h = render(<AdaptiveIcon iconUrl="light.svg" iconDarkUrl="dark.svg" />)
    const darkFrame = h.container.children[1]
    expect(darkFrame.className).toContain('hidden dark:block')
    fireEvent.error(darkFrame.querySelector('img')!)
    expect(darkFrame.querySelector('img')?.getAttribute('src')).toBe('light.svg')
    fireEvent.error(darkFrame.querySelector('img')!)
    expect(darkFrame.querySelector('img')).toBeNull()
    expect(darkFrame.querySelector('svg')).not.toBeNull()
  })

  it('retries after reconnecting and removes the placeholder when loading succeeds', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const h = render(<AdaptiveIcon iconUrl="https://example.com/icon.svg" />)
    fireEvent.error(h.container.querySelector('img')!)
    fireEvent(window, new Event('online'))
    const image = h.container.querySelector('img')!
    expect(image.getAttribute('src')).toBe('https://example.com/icon.svg')
    fireEvent.load(image)
    expect(h.container.querySelector('svg')).toBeNull()
    expect(image.className).not.toContain('invisible')
  })

  it('loads a changed URL after failure and cleans up reconnect listeners on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const h = render(<AdaptiveIcon iconUrl="old.svg" />)
    fireEvent.error(h.container.querySelector('img')!)
    h.rerender(<AdaptiveIcon iconUrl="new.svg" />)
    expect(h.container.querySelector('img')?.getAttribute('src')).toBe('new.svg')
    expect(remove).toHaveBeenCalledWith('online', expect.any(Function))
    fireEvent.error(h.container.querySelector('img')!)
    h.unmount()
    expect(remove.mock.calls.filter(([name]) => name === 'online')).toHaveLength(2)
  })
})
