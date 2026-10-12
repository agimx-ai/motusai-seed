import { desktopCapturer, screen, systemPreferences } from 'electron'
import { basename, resolve } from 'node:path'
import { z } from 'zod'

const requestSchema = z.discriminatedUnion('operation', [
  z.object({ version: z.literal(1), operation: z.literal('list_displays') }).strict(),
  z.object({ version: z.literal(1), operation: z.literal('capture'), display_id: z.string().min(1).max(128).optional() }).strict(),
])

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

/** One-shot screen capture. No window targeting, file access, retained images or background stream. */
export class ScreenCaptureService {
  async invoke(input: Record<string, unknown>, permissions: readonly string[]) {
    if (!permissions.includes('system.screen-capture')) fail('broker_permission_denied', 'Screen capture permission was not declared.')
    const parsed = requestSchema.safeParse(input)
    if (!parsed.success) fail('invalid_arguments', 'Invalid seed.screen version 1 request.')
    const request = parsed.data
    const displays = screen.getAllDisplays()
    const primaryId = String(screen.getPrimaryDisplay().id)
    if (request.operation === 'list_displays') {
      return { displays: displays.map((display) => ({
        display_id: String(display.id), label: display.label, primary: String(display.id) === primaryId,
        bounds: display.bounds, scale_factor: display.scaleFactor,
      })) }
    }
    const display = displays.find((item) => String(item.id) === (request.display_id ?? primaryId))
    if (!display) fail('display_not_found', 'The requested display is no longer connected.')
    const width = Math.round(display.size.width * display.scaleFactor)
    const height = Math.round(display.size.height * display.scaleFactor)
    if (width < 1 || height < 1 || width * height > 40_000_000) fail('screen_capture_too_large', 'Display exceeds the 40 megapixel capture limit.')
    // Let the OS register/request access before checking permission. A preflight
    // denial can also mean this app has not appeared in System Settings yet.
    let sources: Awaited<ReturnType<typeof desktopCapturer.getSources>>
    try {
      sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height }, fetchWindowIcons: false })
    } catch (error) {
      this.checkScreenPermission()
      throw error
    }
    this.checkScreenPermission()
    // Never substitute an unrelated monitor when the OS cannot identify the requested display.
    const source = sources.find((item) => item.display_id === String(display.id))
    if (!source || source.thumbnail.isEmpty()) fail('screen_capture_unavailable', 'The OS did not provide an image for this display. Check Screen Recording permission and display availability.')
    const bytes = source.thumbnail.toPNG()
    if (bytes.length > 16 * 1024 * 1024) fail('screen_capture_too_large', 'Screenshot exceeds the 16 MiB image limit.')
    const size = source.thumbnail.getSize()
    return {
      display_id: String(display.id), bounds: display.bounds, scale_factor: display.scaleFactor,
      width: size.width, height: size.height, mime_type: 'image/png',
      content_base64: bytes.toString('base64'), captured_at: new Date().toISOString(),
    }
  }

  private checkScreenPermission() {
    if (process.platform !== 'darwin') return
    const status = systemPreferences.getMediaAccessStatus('screen')
    if (status === 'granted') return
    const name = basename(resolve(process.execPath, '../../..'), '.app')
    fail('screen_permission_denied', `Allow Screen Recording for ${name} in System Settings > Privacy & Security > Screen & System Audio Recording. If it is missing, use + to add the running app. Quit and reopen it after granting access, then retry.`)
  }
}
