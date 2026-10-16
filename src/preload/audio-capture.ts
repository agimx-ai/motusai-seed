import { contextBridge, ipcRenderer } from 'electron'

import type { AudioCaptureCommand } from '../shared/audio-capture'

contextBridge.exposeInMainWorld('seedAudioCapture', {
  ready: () => ipcRenderer.send('seed-audio:ready'),
  emit: (event: Record<string, unknown>) => ipcRenderer.send('seed-audio:event', event),
  chunk: (sessionId: string, pcm: ArrayBuffer) => ipcRenderer.send('seed-audio:chunk', sessionId, pcm),
  subscribe(listener: (command: AudioCaptureCommand) => void) {
    const handler = (_event: Electron.IpcRendererEvent, command: AudioCaptureCommand) => listener(command)
    ipcRenderer.on('seed-audio:command', handler)
    return () => ipcRenderer.removeListener('seed-audio:command', handler)
  },
})
