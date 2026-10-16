import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

function processor() {
  let Constructor: new () => { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean; port: { onmessage(event: unknown): void } }
  const messages: Array<{ type: string; pcm?: ArrayBuffer }> = []
  runInNewContext(readFileSync(new URL('./capture-processor.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: class { port = { postMessage: (message: { type: string; pcm?: ArrayBuffer }, transfer?: ArrayBuffer[]) => messages.push(structuredClone(message, { transfer })) } },
    registerProcessor: (name: string, constructor: typeof Constructor) => { expect(name).toBe('seed-pcm-capture'); Constructor = constructor },
  })
  return { capture: new Constructor!(), messages }
}

describe('20ms microphone AudioWorklet', () => {
  it('retains every sample without per-callback resampling drift or playback echo', () => {
    const { capture, messages } = processor()
    for (let index = 0; index < 1_000; index++) {
      const output = new Float32Array(128).fill(1)
      capture.process([[new Float32Array(128).fill(0.5)]], [[output]])
      expect(output.every((value) => value === 0)).toBe(true)
    }
    expect(messages.length).toBe(400)
    expect(messages.every((message) => message.pcm?.byteLength === 640)).toBe(true)
    expect(new Int16Array(messages[0].pcm!)[0]).toBe(16_384)
  })

  it('sends the final partial audio before acknowledging flush', () => {
    const { capture, messages } = processor()
    capture.process([[new Float32Array(128).fill(-1)]], [[new Float32Array(128)]])
    expect(messages).toHaveLength(0)
    capture.port.onmessage({ data: { type: 'flush' } })
    expect(messages.map((message) => message.type)).toEqual(['pcm', 'flushed'])
    expect(messages[0].pcm?.byteLength).toBe(256)
    expect(new Int16Array(messages[0].pcm!)[0]).toBe(-32_768)
  })
})
