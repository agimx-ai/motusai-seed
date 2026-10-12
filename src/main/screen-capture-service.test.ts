import { beforeEach, describe, expect, it, vi } from 'vitest'
const electron = vi.hoisted(() => ({ getSources: vi.fn(), getAllDisplays: vi.fn(), getPrimaryDisplay: vi.fn(), getMediaAccessStatus: vi.fn() }))
vi.mock('electron', () => ({
  desktopCapturer: { getSources: electron.getSources },
  screen: { getAllDisplays: electron.getAllDisplays, getPrimaryDisplay: electron.getPrimaryDisplay },
  systemPreferences: { getMediaAccessStatus: electron.getMediaAccessStatus },
}))
import { ScreenCaptureService } from './screen-capture-service'

describe('seed.screen v1', () => {
  const service = new ScreenCaptureService()
  const permissions = ['system.screen-capture']
  beforeEach(() => {
    vi.resetAllMocks()
    electron.getAllDisplays.mockReturnValue([
      { id: 7, label: 'Primary', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, scaleFactor: 2 },
      { id: 9, label: 'Other', bounds: { x: 1920, y: 0, width: 1000, height: 800 }, size: { width: 1000, height: 800 }, scaleFactor: 1 },
    ])
    electron.getPrimaryDisplay.mockReturnValue({ id: 7 })
    electron.getMediaAccessStatus.mockReturnValue('granted')
    electron.getSources.mockResolvedValue([7, 9].map((id) => ({ display_id: String(id), thumbnail: {
      isEmpty: () => false, toPNG: () => Buffer.from('png'), getSize: () => ({ width: 1000, height: 800 }),
    } })))
  })
  it('checks permission and version before touching OS APIs', async () => {
    await expect(service.invoke({ version: 1, operation: 'capture' }, [])).rejects.toMatchObject({ code: 'broker_permission_denied' })
    await expect(service.invoke({ version: 2, operation: 'capture' }, permissions)).rejects.toMatchObject({ code: 'invalid_arguments' })
    await expect(service.invoke({ version: 1, operation: 'capture', window_id: '1' }, permissions)).rejects.toMatchObject({ code: 'invalid_arguments' })
    expect(electron.getSources).not.toHaveBeenCalled()
    expect(electron.getAllDisplays).not.toHaveBeenCalled()
  })
  it('lists displays without taking a screenshot', async () => {
    const result = await service.invoke({ version: 1, operation: 'list_displays' }, permissions)
    expect(result).toMatchObject({ displays: [{ display_id: '7', primary: true }, { display_id: '9', primary: false }] })
    expect(electron.getSources).not.toHaveBeenCalled()
  })
  it('captures the primary screen at physical dimensions, not the frontmost window', async () => {
    expect(await service.invoke({ version: 1, operation: 'capture' }, permissions)).toMatchObject({ display_id: '7', mime_type: 'image/png', content_base64: 'cG5n' })
    expect(electron.getSources).toHaveBeenCalledWith({ types: ['screen'], thumbnailSize: { width: 3840, height: 2160 }, fetchWindowIcons: false })
    expect(await service.invoke({ version: 1, operation: 'capture', display_id: '9' }, permissions)).toMatchObject({ display_id: '9' })
  })
  it('never substitutes another display for a disconnected or unavailable display', async () => {
    await expect(service.invoke({ version: 1, operation: 'capture', display_id: 'missing' }, permissions)).rejects.toMatchObject({ code: 'display_not_found' })
    electron.getSources.mockResolvedValue([{ display_id: '9' }])
    await expect(service.invoke({ version: 1, operation: 'capture' }, permissions)).rejects.toMatchObject({ code: 'screen_capture_unavailable' })
    electron.getSources.mockResolvedValue([{ display_id: '7', thumbnail: { isEmpty: () => true } }])
    await expect(service.invoke({ version: 1, operation: 'capture' }, permissions)).rejects.toMatchObject({ code: 'screen_capture_unavailable' })
  })
  it.skipIf(process.platform !== 'darwin')('requests capture before checking permission, then explains how to authorize the running app', async () => {
    electron.getMediaAccessStatus.mockReturnValue('denied')
    const result = service.invoke({ version: 1, operation: 'capture' }, permissions)
    await expect(result).rejects.toMatchObject({ code: 'screen_permission_denied', message: expect.stringContaining('System Settings > Privacy & Security') })
    expect(electron.getSources).toHaveBeenCalledOnce()
    expect(electron.getSources.mock.invocationCallOrder[0]).toBeLessThan(electron.getMediaAccessStatus.mock.invocationCallOrder[0]!)
    await expect(result).rejects.toThrow('use + to add the running app')
  })
  it.skipIf(process.platform !== 'darwin')('allows authorization during capture and explains OS capture rejections', async () => {
    electron.getMediaAccessStatus.mockReturnValue('denied')
    electron.getSources.mockImplementationOnce(async () => {
      electron.getMediaAccessStatus.mockReturnValue('granted')
      return [{ display_id: '7', thumbnail: { isEmpty: () => false, toPNG: () => Buffer.from('png'), getSize: () => ({ width: 1, height: 1 }) } }]
    })
    await expect(service.invoke({ version: 1, operation: 'capture' }, permissions)).resolves.toMatchObject({ mime_type: 'image/png' })
    electron.getMediaAccessStatus.mockReturnValue('denied')
    electron.getSources.mockRejectedValueOnce(new Error('OS permission denied'))
    await expect(service.invoke({ version: 1, operation: 'capture' }, permissions)).rejects.toMatchObject({ code: 'screen_permission_denied' })
    electron.getMediaAccessStatus.mockReturnValue('granted')
    electron.getSources.mockRejectedValueOnce(new Error('OS capture failed'))
    await expect(service.invoke({ version: 1, operation: 'capture' }, permissions)).rejects.toThrow('OS capture failed')
  })
  it('rejects oversized captures', async () => {
    electron.getSources.mockResolvedValue([{ display_id: '7', thumbnail: { isEmpty: () => false, toPNG: () => Buffer.alloc(16 * 1024 * 1024 + 1) } }])
    await expect(service.invoke({ version: 1, operation: 'capture' }, permissions)).rejects.toMatchObject({ code: 'screen_capture_too_large' })
  })
})
