import type { AudioStreamChunk, AudioStreamDelivery, AudioStreamFormat } from '@motus-ai/seed-sdk';

type Source = AudioStreamChunk['source'];
type Frame = Omit<AudioStreamChunk, 'data'> & { pcm: Buffer };

const maxBufferedBytes = 2 * 1024 * 1024;
const maxBufferedChunks = 2048;
const maxDeliveryBytes = 128 * 1024;
const maxDeliveryChunks = 32;

export class AudioStream {
  private queue: Frame[] = [];
  private queuedBytes = 0;
  private sequence = 0;
  private readonly offsets = { microphone: 0, system: 0 };
  private pending?: { resolve(result: AudioStreamDelivery): void; reject(error: Error): void };
  private failure?: Error;
  private finished = false;
  expiry?: ReturnType<typeof setTimeout>;

  constructor(readonly packageId: string, readonly sessionId: string) {}

  append(source: Source, format: AudioStreamFormat, pcm: Buffer) {
    if (this.finished) return;
    const bytesPerFrame = format.channels * format.bits_per_sample / 8;
    const frames = pcm.length / bytesPerFrame;
    if (!Number.isSafeInteger(frames) || frames <= 0 || !Number.isSafeInteger(format.sample_rate) ||
      format.sample_rate < 1 || !Number.isSafeInteger(bytesPerFrame) || bytesPerFrame < 1)
      throw new Error('音频采集返回了无效的格式或数据。');
    if (this.queuedBytes + pcm.length > maxBufferedBytes || this.queue.length >= maxBufferedChunks)
      throw Object.assign(new Error('音频订阅方处理过慢。'), { code: 'audio_stream_overflow' });
    this.queue.push({
      source, sequence: this.sequence++, sample_offset: this.offsets[source], frames, format,
      pcm: Buffer.from(pcm),
    });
    this.offsets[source] += frames;
    this.queuedBytes += pcm.length;
    if (this.pending) {
      const { resolve } = this.pending;
      this.pending = undefined;
      resolve(this.drain());
    }
  }

  async next(): Promise<AudioStreamDelivery> {
    if (this.failure) throw this.failure;
    if (this.queue.length || this.finished) return this.drain();
    if (this.pending) throw Object.assign(new Error('音频订阅已有一次等待。'), { code: 'audio_stream_concurrent_read' });
    return await new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
  }

  close(error?: Error, discard = false) {
    if (this.finished && !discard) return;
    this.finished = true;
    this.failure = error;
    if (error || discard) {
      this.queue = [];
      this.queuedBytes = 0;
    }
    const pending = this.pending;
    this.pending = undefined;
    if (error) pending?.reject(error);
    else if (pending) pending.resolve(this.drain());
  }

  private drain(): AudioStreamDelivery {
    const chunks: AudioStreamDelivery['chunks'] = [];
    let bytes = 0;
    while (this.queue[0] && chunks.length < maxDeliveryChunks) {
      const { pcm, ...chunk } = this.queue[0];
      if (chunks.length && bytes + pcm.length > maxDeliveryBytes) break;
      this.queue.shift();
      bytes += pcm.length;
      chunks.push({ ...chunk, data_base64: pcm.toString('base64') });
    }
    this.queuedBytes -= bytes;
    return { done: this.finished && !this.queue.length, chunks };
  }
}
