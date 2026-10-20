// Archiver 8 does not ship types.
declare module 'archiver' {
  import { Transform } from 'node:stream';
  import type { ZlibOptions } from 'node:zlib';

  export class ZipArchive extends Transform {
    constructor(options: { zlib: ZlibOptions; forceLocalTime: boolean });
    append(body: Buffer, options: { name: string; date: Date; mode: number }): this;
    finalize(): Promise<void>;
  }
}
