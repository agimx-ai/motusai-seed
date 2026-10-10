import { afterEach, describe, expect, it, vi } from 'vitest'
import rendering from './icon-rendering.cjs'

const { rasterizeImage, validateIconPixels } = rendering

function pixels(color = 249) {
  const data = new Uint8ClampedArray(1024 * 1024 * 4)
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set([color, color, color, 255], offset)
  }
  return { data, width: 1024, height: 1024 }
}

function logoPixels(darkAppearance = false) {
  const image = pixels(darkAppearance ? 10 : 249)
  for (let y = 308; y < 716; y++) {
    for (let x = 308; x < 716; x++) {
      const eye = x >= 520 && x < 550 && y < 420
      const color = eye !== darkAppearance ? 249 : 10
      image.data.set([color, color, color, 255], (y * 1024 + x) * 4)
    }
  }
  return image
}

describe('desktop icon pixel validation', () => {
  it.each([false, true])('accepts a complete logo (dark=%s)', (dark) => {
    expect(() => validateIconPixels(logoPixels(dark))).not.toThrow()
  })

  it.each([10, 244])('rejects a nonempty icon containing only its background (%s)', (color) => {
    expect(() => validateIconPixels(pixels(color))).toThrow('blank or missing')
  })

  it('rejects a body without eyes, even if the outer background is light', () => {
    const image = logoPixels()
    for (let y = 308; y < 716; y++) {
      for (let x = 308; x < 716; x++) {
        image.data.set([10, 10, 10, 255], (y * 1024 + x) * 4)
      }
    }
    expect(() => validateIconPixels(image)).toThrow('blank or missing')
  })

  it('rejects transparent images and wrong dimensions', () => {
    const image = pixels()
    image.data.fill(0)
    expect(() => validateIconPixels(image)).toThrow('blank or missing')
    expect(() => validateIconPixels({ ...image, width: 512 })).toThrow('1024×1024')
  })

  it('allows an explicitly background-only Icon Composer layer', () => {
    expect(() => validateIconPixels(pixels(), false)).not.toThrow()
  })
})

describe('desktop icon rasterization', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('waits for decoding before drawing, validating and encoding', async () => {
    let finishDecode
    const decoded = new Promise((resolve) => { finishDecode = resolve })
    const drawImage = vi.fn()
    const validate = vi.fn()
    const bitmap = logoPixels()
    const toDataURL = vi.fn(() => 'data:image/png;base64,complete')
    const context = { drawImage, getImageData: () => bitmap }
    vi.stubGlobal('Image', class {
      naturalWidth = 1024
      naturalHeight = 1024
      decode() { return decoded }
    })
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context, toDataURL }) })
    const result = rasterizeImage('data:image/svg+xml;base64,logo', true, validate)
    expect(drawImage).not.toHaveBeenCalled()
    expect(toDataURL).not.toHaveBeenCalled()
    finishDecode()
    await expect(result).resolves.toBe('data:image/png;base64,complete')
    expect(drawImage).toHaveBeenCalledOnce()
    expect(validate).toHaveBeenCalledWith(bitmap, true)
    expect(validate.mock.invocationCallOrder[0]).toBeLessThan(toDataURL.mock.invocationCallOrder[0])
  })

  it('fails rather than encoding an undecodable image', async () => {
    const createElement = vi.fn()
    vi.stubGlobal('Image', class { decode() { return Promise.reject(new Error('decode failed')) } })
    vi.stubGlobal('document', { createElement })
    await expect(rasterizeImage('broken', true, validateIconPixels)).rejects.toThrow('decode failed')
    expect(createElement).not.toHaveBeenCalled()
  })

  it('rejects incorrect source dimensions instead of silently enlarging them', async () => {
    vi.stubGlobal('Image', class {
      naturalWidth = 512
      naturalHeight = 512
      decode() { return Promise.resolve() }
    })
    await expect(rasterizeImage('small', true, validateIconPixels)).rejects.toThrow('source must be 1024×1024')
  })

  it('does not encode pixels rejected by the content gate', async () => {
    const toDataURL = vi.fn()
    vi.stubGlobal('Image', class {
      naturalWidth = 1024
      naturalHeight = 1024
      decode() { return Promise.resolve() }
    })
    vi.stubGlobal('document', { createElement: () => ({
      getContext: () => ({ drawImage() {}, getImageData: () => pixels() }), toDataURL,
    }) })
    await expect(rasterizeImage('blank', true, validateIconPixels)).rejects.toThrow('blank or missing')
    expect(toDataURL).not.toHaveBeenCalled()
  })
})
