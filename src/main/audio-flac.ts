import flacFactory = require('libflacjs')
import { Decoder } from 'libflacjs/lib/decoder'
import { Encoder } from 'libflacjs/lib/encoder'

const Flac = flacFactory()

const ready = new Promise<void>((resolve) => {
  if (Flac.isReady()) resolve()
  else Flac.on('ready', () => resolve())
})

export async function encodePcm16Flac(pcm: Buffer, sampleRate: number, channels: number) {
  if (pcm.byteLength % 2 !== 0) throw new Error('PCM 16-bit audio must contain complete samples.')
  await ready
  const samples = new Int32Array(pcm.byteLength / 2)
  for (let offset = 0; offset < pcm.byteLength; offset += 2) samples[offset / 2] = pcm.readInt16LE(offset)
  const encoder = new Encoder(Flac, {
    sampleRate,
    channels,
    bitsPerSample: 16,
    compression: 5,
    verify: true,
  })
  try {
    if (!encoder.encode(samples) || !encoder.encode()) throw new Error('FLAC encoder rejected the audio segment.')
    return Buffer.from(encoder.getSamples())
  } finally {
    encoder.destroy()
  }
}

export async function decodePcm16Flac(encoded: Buffer) {
  await ready
  const decoder = new Decoder(Flac, { verify: true })
  try {
    if (!decoder.decode(new Uint8Array(encoded))) throw new Error('FLAC decoder rejected the audio segment.')
    const metadata = decoder.metadata
    if (!metadata || metadata.bitsPerSample !== 16) throw new Error('The persisted FLAC segment is not 16-bit PCM.')
    return {
      pcm: Buffer.from(decoder.getSamples(true)),
      sampleRate: metadata.sampleRate,
      channels: metadata.channels,
    }
  } finally {
    decoder.destroy()
  }
}
