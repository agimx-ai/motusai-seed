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

/** Paths are relative to the calling plugin's private data directory. */
export type AudioFileOutputPaths = Partial<Record<AudioStreamChunk['source'] | 'stereo', string>> & {
  append?: boolean;
};

export type AudioRecordingResult = {
  session_id: string;
  duration_ms: number;
  audio_files: string[];
  audio_save_failed?: true;
};

export type AudioRecording = {
  session_id: string;
  /** Wait for the next newly captured frame. Aborting this read leaves the recording active. */
  nextFrame(signal?: AbortSignal): Promise<AudioStreamChunk | null>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<AudioRecordingResult>;
};

export type AudioService = {
  /** Record to plugin-selected files, independently of any reads of the realtime frames. */
  startRecording(options: {
    source?: 'microphone' | 'system' | 'mixed';
    output: AudioFileOutputPaths;
    signal?: AbortSignal;
  }): Promise<AudioRecording>;
};

export type AudioStreamDelivery = {
  done: boolean;
  chunks: Array<Omit<AudioStreamChunk, 'data'> & { data_base64: string }>;
};

function decodeChunk({ data_base64, ...chunk }: AudioStreamDelivery['chunks'][number]): AudioStreamChunk {
  return { ...chunk, data: Uint8Array.from(atob(data_base64), (byte) => byte.charCodeAt(0)) };
}

function streamClosed(error: unknown) {
  return (error as { code?: string } | null)?.code === 'audio_stream_closed';
}

export function createAudioClient(
  broker: (service: string, args: Record<string, unknown>) => Promise<unknown>,
  owner: AbortSignal,
  report: (error: unknown) => void,
): AudioService {
  return {
    async startRecording({ source, output, signal: inputSignal }) {
      const signal = inputSignal ? AbortSignal.any([owner, inputSignal]) : owner;
      signal.throwIfAborted();
      const session_id = globalThis.crypto.randomUUID();
      const invoke = (operation: string, args: Record<string, unknown> = {}) =>
        broker('seed.audio', { operation: `stream.${operation}`, session_id, ...args });
      let stopping: Promise<AudioRecordingResult> | undefined;
      const abort = () => {
        if (!stopping) void invoke('cancel').catch((error) => {
          if (!owner.aborted && !streamClosed(error)) report(error);
        });
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        await invoke('record', { source, output });
        signal.throwIfAborted();
      } catch (error) {
        signal.removeEventListener('abort', abort);
        throw error;
      }
      const control = async (operation: 'pause' | 'resume') => {
        signal.throwIfAborted();
        await invoke(operation);
      };
      const buffered: AudioStreamChunk[] = [];
      return {
        session_id,
        async nextFrame(readSignal) {
          if (stopping) return null;
          const pendingSignal = readSignal ? AbortSignal.any([signal, readSignal]) : signal;
          pendingSignal.throwIfAborted();
          if (buffered.length) return buffered.shift()!;
          const read_id = globalThis.crypto.randomUUID();
          const cancel = () => {
            void invoke('cancel-read', { read_id }).catch((error) => {
              if (!signal.aborted && !stopping && !streamClosed(error)) report(error);
            });
          };
          pendingSignal.addEventListener('abort', cancel, { once: true });
          try {
            const delivery = await invoke('next', { read_id }) as AudioStreamDelivery;
            pendingSignal.throwIfAborted();
            if (!delivery.chunks.length) return null;
            for (const chunk of delivery.chunks) buffered.push(decodeChunk(chunk));
            return buffered.shift() ?? null;
          } finally {
            pendingSignal.removeEventListener('abort', cancel);
          }
        },
        pause: () => control('pause'),
        resume: () => control('resume'),
        async stop() {
          if (!stopping) {
            signal.throwIfAborted();
            stopping = invoke('stop') as Promise<AudioRecordingResult>;
            void stopping.then(() => signal.removeEventListener('abort', abort), () => {
              stopping = undefined;
              if (signal.aborted) abort();
            });
          }
          return stopping;
        },
      };
    },
  };
}
