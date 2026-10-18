import { describe, expect, it } from 'vitest';
import { pluginHostContentSecurityPolicy } from './plugin-host-policy';

const nonce = 'a'.repeat(43) + '=';
const development = 'http://127.0.0.1:5173';
const response = {
  url: development + '/index.html',
  responseHeaders: { 'X-Seed-Development-Nonce': [nonce] },
};
const directives = (value: string) =>
  Object.fromEntries(
    value
      .split(';')
      .filter((item) => item.trim())
      .map((item) => {
        const [name, ...sources] = item.trim().split(' ');
        return [name, sources];
      }),
  );

describe('product and isolated service host content security policy', () => {
  it.each(['product', 'service'] as const)(
    'keeps production %s scripts nonce-free and all connections disabled',
    (role) => {
      const policy = directives(pluginHostContentSecurityPolicy(role, response));
      expect(policy['script-src']).toEqual(role === 'product' ? ["'self'", 'seed-plugin:'] : ["'self'"]);
      expect(policy['connect-src']).toEqual(role === 'product' ? ['seed-plugin:'] : ["'none'"]);
      expect(policy['script-src']).not.toContain("'unsafe-inline'");
      expect(policy['script-src']).not.toContain("'unsafe-eval'");
      expect(policy['frame-src']).toEqual(["'none'"]);
      expect(policy['object-src']).toEqual(["'none'"]);
    },
  );

  it.each(['product', 'service'] as const)(
    'authorizes the Vite nonce and only its HTTP/WebSocket origins for %s',
    (role) => {
      const policy = directives(pluginHostContentSecurityPolicy(role, response, development));
      expect(policy['script-src']).toEqual(["'self'", 'seed-plugin:', `'nonce-${nonce}'`]);
      expect(policy['connect-src']).toEqual([
        ...(role === 'product' ? ['seed-plugin:'] : []),
        development,
        'ws://127.0.0.1:5173',
      ]);
      expect(policy['script-src']).not.toContain("'unsafe-inline'");
      expect(policy['script-src']).not.toContain("'unsafe-eval'");
      expect(policy['connect-src']).not.toContain('*');
    },
  );

  it.each(['https://localhost:5443', 'http://[::1]:5173'])('handles loopback TLS and IPv6 (%s)', (origin) => {
    const policy = directives(
      pluginHostContentSecurityPolicy('product', { ...response, url: origin + '/index.html' }, origin),
    );
    expect(policy['script-src']).toContain(`'nonce-${nonce}'`);
    expect(policy['connect-src']).toEqual(['seed-plugin:', origin, origin.replace(/^http/, 'ws')]);
  });

  it.each([
    'https://example.com:5173',
    'http://127.0.0.1.evil.test:5173',
    'http://user:pass@localhost:5173',
    'file:///tmp/index.html',
    'not-a-url',
  ])('does not grant development exceptions to an untrusted server (%s)', (url) => {
    const policy = directives(pluginHostContentSecurityPolicy('product', response, url));
    expect(policy['connect-src']).toEqual(['seed-plugin:']);
    expect(policy['script-src']).not.toContain(`'nonce-${nonce}'`);
  });

  it.each([
    'http://127.0.0.1:5174/index.html',
    'http://localhost:5173/index.html',
    'https://example.com/index.html',
    'seed-plugin://view/plugin/main.js',
  ])('does not trust a nonce from another origin (%s)', (url) => {
    expect(pluginHostContentSecurityPolicy('product', { ...response, url }, development)).not.toContain(
      `'nonce-${nonce}'`,
    );
  });

  it.each(
    [[], ['short'], [nonce, nonce], [nonce + "'; script-src *"], ['x'.repeat(129)]].map((values) => ({ values })),
  )('rejects malformed nonce headers ($values)', ({ values }) => {
    expect(
      pluginHostContentSecurityPolicy(
        'product',
        { ...response, responseHeaders: { 'x-seed-development-nonce': values } },
        development,
      ),
    ).not.toContain("'nonce-");
  });

  it('rejects ambiguous header names and accepts a single case-insensitive header', () => {
    expect(
      pluginHostContentSecurityPolicy(
        'product',
        { ...response, responseHeaders: { 'x-seed-development-nonce': nonce } },
        development,
      ),
    ).toContain(`'nonce-${nonce}'`);
    expect(
      pluginHostContentSecurityPolicy(
        'product',
        { ...response, responseHeaders: { 'x-seed-development-nonce': [nonce], 'X-Seed-Development-Nonce': [nonce] } },
        development,
      ),
    ).not.toContain("'nonce-");
  });
});
