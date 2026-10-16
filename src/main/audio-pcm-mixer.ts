const frameBytes = 320 * 2
const maxQueuedBytes = 16_000 * 2 * 2

/** Single PCM16/16kHz output, fixed 50/50 mixing in 20ms frames, with bounded skew. */
export class AudioPcmMixer {
  private microphone: Buffer = Buffer.alloc(0)
  private system: Buffer = Buffer.alloc(0)

  push(source: 'microphone' | 'system', pcm: Buffer): Buffer {
    if (pcm.length % 2) throw new Error('音频 PCM 数据未按采样对齐。')
    this[source] = Buffer.concat([this[source], pcm])
    const output = this.drain(false)
    if (this.microphone.length > maxQueuedBytes || this.system.length > maxQueuedBytes) {
      this.clear()
      throw new Error('混合音频来源已中断，请检查麦克风和系统输出设备。')
    }
    return output
  }

  flush(): Buffer { return this.drain(true) }

  clear() {
    this.microphone = Buffer.alloc(0)
    this.system = Buffer.alloc(0)
  }

  private drain(final: boolean) {
    const frames: Buffer[] = []
    while (final ? this.microphone.length || this.system.length : Math.min(this.microphone.length, this.system.length) >= frameBytes) {
      const length = final ? Math.min(frameBytes, Math.max(this.microphone.length, this.system.length)) : frameBytes
      const output = Buffer.alloc(length)
      for (let offset = 0; offset < length; offset += 2) {
        const microphone = offset < this.microphone.length ? this.microphone.readInt16LE(offset) : 0
        const system = offset < this.system.length ? this.system.readInt16LE(offset) : 0
        // Averaging two PCM16 samples stays in range without a dynamic limiter.
        output.writeInt16LE(Math.round((microphone + system) / 2), offset)
      }
      this.microphone = this.microphone.subarray(length)
      this.system = this.system.subarray(length)
      frames.push(output)
    }
    return Buffer.concat(frames)
  }
}
