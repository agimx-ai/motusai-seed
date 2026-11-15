/** The capture source reports its format. Plug-ins choose any conversion or model packet size. */
export type AudioStreamFormat = {
  encoding: string;
  sample_rate: number;
  channels: number;
  bits_per_sample: number;
  layout: 'interleaved' | 'planar';
};

export type AudioStreamChunk = {
  source: 'microphone' | 'system';
  sequence: number;
  sample_offset: number;
  frames: number;
  format: AudioStreamFormat;
  data: Uint8Array;
};

export type AudioStreamSubscription = {
  session_id: string;
  signal: AbortSignal;
  /** Resolves after the last chunk is delivered. Rejects on capture or delivery failure. */
  closed: Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Stop capture and let pending chunks drain. Await `closed` to wait for delivery. */
  stop(): Promise<void>;
  /** Stop capture and discard pending delivery. */
  unsubscribe(): Promise<void>;
};

export type AudioService = {
  subscribe(
    options: { source?: 'microphone' | 'system' | 'mixed'; signal?: AbortSignal },
    listener: (chunk: AudioStreamChunk, signal: AbortSignal) => void | Promise<void>,
  ): Promise<AudioStreamSubscription>;
};

export type AudioStreamDelivery = {
  done: boolean;
  chunks: Array<Omit<AudioStreamChunk, 'data'> & { data_base64: string }>;
};

export function createAudioClient(
  broker: (service: string, args: Record<string, unknown>) => Promise<unknown>,
  owner: AbortSignal,
  report: (error: unknown) => void,
): AudioService {
  return {
    async subscribe({ source, signal: inputSignal }, listener) {
      const lifetime = new AbortController();
      const signal = AbortSignal.any([owner, lifetime.signal, ...(inputSignal ? [inputSignal] : [])]);
      signal.throwIfAborted();
      const session_id = globalThis.crypto.randomUUID();
      const invoke = (operation: string, args: Record<string, unknown> = {}) =>
        broker('seed.audio', { operation: `stream.${operation}`, session_id, ...args });
      let closing: Promise<void> | undefined;
      const unsubscribe = () => {
        if (!closing) {
          signal.removeEventListener('abort', abort);
          closing = Promise.resolve().then(async () => { await invoke('unsubscribe'); })
            .catch((error) => { if (!owner.aborted) throw error; });
          lifetime.abort();
        }
        return closing;
      };
      const abort = () => { void unsubscribe().catch(report); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        await invoke('subscribe', { source });
        signal.throwIfAborted();
      } catch (error) {
        signal.removeEventListener('abort', abort);
        await closing?.catch(report);
        throw error;
      }
      const closed = (async () => {
        try {
          while (!signal.aborted) {
            const delivery = await invoke('next') as AudioStreamDelivery;
            for (const { data_base64, ...chunk } of delivery.chunks) {
              if (signal.aborted) return;
              const data = Uint8Array.from(atob(data_base64), (byte) => byte.charCodeAt(0));
              await listener({ ...chunk, data }, signal);
            }
            if (delivery.done) return;
          }
        } catch (error) {
          if (!signal.aborted) throw error;
        } finally {
          await unsubscribe();
        }
      })();
      void closed.catch(report);
      const control = async (operation: 'pause' | 'resume' | 'stop') => {
        signal.throwIfAborted();
        await invoke(operation);
      };
      return {
        session_id, signal, closed,
        pause: () => control('pause'),
        resume: () => control('resume'),
        stop: () => control('stop'),
        unsubscribe,
      };
    },
  };
}
