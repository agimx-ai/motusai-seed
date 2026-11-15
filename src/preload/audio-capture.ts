import { contextBridge, ipcRenderer } from 'electron'

import type { AudioStreamFormat } from '@motus-ai/seed-sdk'
import type { AudioCaptureCommand } from '../shared/audio-capture'

contextBridge.exposeInMainWorld('seedAudioCapture', {
  ready: () => ipcRenderer.send('seed-audio:ready'),
  emit: (event: Record<string, unknown>) => ipcRenderer.send('seed-audio:event', event),
  chunk: (sessionId: string, pcm: ArrayBuffer, format?: AudioStreamFormat) =>
    ipcRenderer.send('seed-audio:chunk', sessionId, pcm, format),
  subscribe(listener: (command: AudioCaptureCommand) => void) {
    const handler = (_event: Electron.IpcRendererEvent, command: AudioCaptureCommand) => listener(command)
    ipcRenderer.on('seed-audio:command', handler)
    return () => ipcRenderer.removeListener('seed-audio:command', handler)
  },
})
