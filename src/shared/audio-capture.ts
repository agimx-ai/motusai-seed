export const audioCaptureSources = ['microphone', 'system', 'mixed'] as const
export type AudioCaptureSource = typeof audioCaptureSources[number]

export function parseAudioCaptureSource(value: unknown): AudioCaptureSource {
  if (value === undefined) return 'microphone'
  if (audioCaptureSources.includes(value as AudioCaptureSource)) return value as AudioCaptureSource
  throw Object.assign(new Error('音频来源无效。'), { code: 'audio_source_invalid' })
}

export type AudioCaptureCommand =
  | { type: 'start'; session_id: string }
  | { type: 'pause'; session_id: string }
  | { type: 'resume'; session_id: string }
  | { type: 'stop'; session_id: string }
