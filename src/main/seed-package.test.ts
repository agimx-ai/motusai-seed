import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import * as archiverModule from 'archiver';
import { describe, expect, it } from 'vitest';
import { verifySeedPackage } from './seed-package';

function digest(body: Buffer) {
  return createHash('sha256').update(body).digest('hex');
}

async function zip(entries: { path: string; body: Buffer }[]) {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => {
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);
  });
  const ZipArchive = (
    archiverModule as unknown as {
      ZipArchive: new (options: unknown) => import('stream').Transform & {
        append(body: Buffer, options: { name: string; date: Date }): void;
        finalize(): Promise<void>;
      };
    }
  ).ZipArchive;
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on('error', (error) => output.destroy(error));
  archive.pipe(output);
  for (const entry of entries) archive.append(entry.body, { name: entry.path, date: new Date('1980-01-01T00:00:00Z') });
  await archive.finalize();
  return await completed;
}

async function integrityPackage(options: { tamper?: boolean; legacy?: boolean } = {}) {
  const main = Buffer.from('export const seedPluginBundleVersion = 2; export function loadView() {}');
  const document = {
    id: 'com.example.seed.clock',
    name: 'Clock',
    description: 'Clock',
    author: 'Example',
    version: '1.0.0',
    minAppVersion: '0.1.67',
    apiVersion: 2,
    runtime: 'sandboxed-web',
    service: false,
    resources: [{ path: 'main.js', sha256: digest(main) }],
  };
  const packageBytes = await zip(
    options.legacy
      ? [{ path: 'manifest.yaml', body: Buffer.from('id: com.example.seed.clock') }]
      : [
          { path: 'manifest.json', body: Buffer.from(JSON.stringify(document)) },
          { path: 'main.js', body: options.tamper ? Buffer.from('modified') : main },
        ],
  );
  return { packageBytes, packageSha256: digest(packageBytes) };
}

describe('Seed package verification', () => {
  it('accepts a v2 package with just manifest.json/main.js/styles.css and no legacy view declarations', async () => {
    const main = Buffer.from('export const seedPluginBundleVersion = 2; export function loadView() {}\n');
    const style = Buffer.from('.custom-control { color: var(--foreground); }\n');
    const document = {
      id: 'com.example.seed.clock',
      name: 'Clock',
      description: 'Clock',
      author: 'Example',
      version: '1.0.0',
      minAppVersion: '0.2.15',
      apiVersion: 2,
      runtime: 'sandboxed-web',
      resources: [
        { path: 'main.js', sha256: digest(main) },
        { path: 'styles.css', sha256: digest(style) },
      ],
    };
    const packageBytes = await zip([
      { path: 'manifest.json', body: Buffer.from(JSON.stringify(document)) },
      { path: 'main.js', body: main },
      { path: 'styles.css', body: style },
    ]);
    const verified = await verifySeedPackage(packageBytes, { expectedPackageSha256: digest(packageBytes) });
    expect([...verified.files.keys()]).toEqual(['manifest.json', 'main.js', 'styles.css']);
    expect(verified.manifest).toMatchObject({ id: document.id, jsonManifest: { apiVersion: 2 } });
    expect(verified).not.toHaveProperty('publisherId');
    expect(verified.manifest.jsonManifest).not.toHaveProperty('renderer');
    expect(verified.manifest.jsonManifest).not.toHaveProperty('seed');
    const tampered = await zip([
      { path: 'manifest.json', body: Buffer.from(JSON.stringify(document)) },
      { path: 'main.js', body: Buffer.from('changed') },
      { path: 'styles.css', body: style },
    ]);
    await expect(verifySeedPackage(tampered, { expectedPackageSha256: digest(tampered) })).rejects.toThrow(
      '摘要不匹配',
    );
    const undeclared = await zip([
      { path: 'manifest.json', body: Buffer.from(JSON.stringify(document)) },
      { path: 'main.js', body: main },
      { path: 'styles.css', body: style },
      { path: 'extra.js', body: Buffer.from('extra') },
    ]);
    await expect(verifySeedPackage(undeclared, { expectedPackageSha256: digest(undeclared) })).rejects.toThrow(
      '完整覆盖',
    );
    const legacyDeclaration = structuredClone(document) as typeof document & { renderer: string };
    legacyDeclaration.renderer = 'seed.form';
    const legacyBytes = await zip([
      { path: 'manifest.json', body: Buffer.from(JSON.stringify(legacyDeclaration)) },
      { path: 'main.js', body: main },
      { path: 'styles.css', body: style },
    ]);
    await expect(verifySeedPackage(legacyBytes, { expectedPackageSha256: digest(legacyBytes) })).rejects.toThrow();
    for (const metadata of [
      { capabilities: [] },
      { publisherId: 'forged-official' },
      { labels: ['utilities'] },
      { seed: { icon: 'assets/icon.svg' } },
    ]) {
      const extra = { ...document, ...metadata };
      const extraBytes = await zip([
        { path: 'manifest.json', body: Buffer.from(JSON.stringify(extra)) },
        { path: 'main.js', body: main },
        { path: 'styles.css', body: style },
      ]);
      await expect(verifySeedPackage(extraBytes, { expectedPackageSha256: digest(extraBytes) })).rejects.toThrow();
    }
  });
  it('verifies the package digest and every archived file', async () => {
    const fixture = await integrityPackage();
    const verified = await verifySeedPackage(fixture.packageBytes, {
      expectedPackageSha256: fixture.packageSha256,
      expectedPluginId: 'com.example.seed.clock',
      expectedVersion: '1.0.0',
    });
    expect(verified.manifest.id).toBe('com.example.seed.clock');
    expect(verified.manifest).not.toHaveProperty('configurations');
    expect(verified.manifest).not.toHaveProperty('managementViews');
    expect(verified.files.has('main.js')).toBe(true);
    expect(verified.manifest).not.toHaveProperty('capabilities');
  });

  it('rejects package content changed after the digest list is generated', async () => {
    const fixture = await integrityPackage({ tamper: true });
    await expect(
      verifySeedPackage(fixture.packageBytes, {
        expectedPackageSha256: fixture.packageSha256,
      }),
    ).rejects.toThrow(/摘要不匹配/);
  });

  it('rejects old YAML packages instead of loading a second plugin framework', async () => {
    const fixture = await integrityPackage({ legacy: true });
    await expect(
      verifySeedPackage(fixture.packageBytes, {
        expectedPackageSha256: fixture.packageSha256,
      }),
    ).rejects.toThrow(/manifest.json/);
  });

  it('rejects a package digest that differs from the catalog', async () => {
    const fixture = await integrityPackage();
    await expect(
      verifySeedPackage(fixture.packageBytes, {
        expectedPackageSha256: '0'.repeat(64),
      }),
    ).rejects.toThrow(/服务端目录不一致/);
  });

  it('rejects Windows path aliases before writing any files', async () => {
    const content = [
      { path: 'CON/readme.txt', body: Buffer.from('unsafe') },
      { path: 'manifest.yaml', body: Buffer.from('id: com.example.seed.clock') },
    ];
    const digests = Buffer.from(content.map((entry) => `${digest(entry.body)}  ${entry.path}\n`).join(''));
    const packageBytes = await zip([...content, { path: 'META-INF/files.sha256', body: digests }]);
    await expect(
      verifySeedPackage(packageBytes, {
        expectedPackageSha256: digest(packageBytes),
      }),
    ).rejects.toThrow(/不安全条目/);
  });
});
