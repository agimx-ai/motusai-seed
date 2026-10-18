import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const temporary = await mkdtemp(join(tmpdir(), 'seed-vite-smoke-'));
let server, child;
const stop = () => child?.kill('SIGTERM');
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  server = await createServer({
    configFile: resolve('vite.config.mts'),
    cacheDir: join(temporary, 'vite-cache'),
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  server.ws.on('seed-smoke:ping', (data, client) => client.send('seed-smoke:pong', data));
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not bind a TCP port.');
  const url = `http://127.0.0.1:${address.port}`;
  const page = await fetch(url + '/');
  const nonce = page.headers.get('x-seed-development-nonce');
  if (!nonce || !(await page.text()).includes('nonce="' + nonce + '"'))
    throw new Error('Vite did not nonce its initialization scripts.');
  process.stdout.write('Testing the real Vite plugin hosts with an isolated development server.\n');
  const cases = [
    ['scripts/smoke-plugin-sdk.mjs'],
    ...process.argv
      .slice(2)
      .filter((argument) => argument !== '--page')
      .map((project) => [
        'scripts/smoke-plugin-project.mjs',
        resolve(project),
        ...(process.argv.includes('--page') ? ['--page'] : []),
      ]),
  ];
  for (const [script, ...args] of cases) {
    process.exitCode = await new Promise((resolveExit, reject) => {
      child = spawn(require('electron'), [resolve(script), ...args], {
        cwd: process.cwd(),
        env: { ...process.env, VITE_DEV_SERVER_URL: url },
        stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('exit', (code) => resolveExit(code ?? 1));
    });
    child = undefined;
    if (process.exitCode) break;
  }
} finally {
  stop();
  await server?.close();
  await rm(temporary, { recursive: true, force: true });
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
