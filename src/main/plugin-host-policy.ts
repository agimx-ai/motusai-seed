type ResponseHeaders = Record<string, string | string[] | undefined>;

/** Development grants are restricted to the configured loopback Vite origin. Production stays offline. */
export function pluginHostContentSecurityPolicy(
  role: 'product' | 'service',
  response: { url: string; responseHeaders?: ResponseHeaders },
  developmentServerUrl?: string,
): string {
  let development: URL | undefined;
  try {
    const url = new URL(developmentServerUrl ?? '');
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      !url.username &&
      !url.password
    )
      development = url;
  } catch {
    /* No development server: keep the production policy. */
  }

  let nonce = '';
  if (development && URL.canParse(response.url) && new URL(response.url).origin === development.origin) {
    const entries = Object.entries(response.responseHeaders ?? {}).filter(
      ([key]) => key.toLowerCase() === 'x-seed-development-nonce',
    );
    const values = entries.length === 1 ? entries.flatMap(([, value]) => (value === undefined ? [] : value)) : [];
    if (values.length === 1 && /^[a-zA-Z0-9+/_-]{22,128}={0,2}$/.test(values[0]!)) nonce = ` 'nonce-${values[0]}'`;
  }
  const script = "'self'" + (role === 'product' || development ? ' seed-plugin:' : '') + nonce;
  const style = "'self'" + (role === 'product' ? " 'unsafe-inline' seed-plugin:" : nonce);
  const websocket = development ? new URL(development.origin) : undefined;
  if (websocket) websocket.protocol = websocket.protocol === 'https:' ? 'wss:' : 'ws:';
  const connect =
    [role === 'product' ? 'seed-plugin:' : '', development ? `${development.origin} ${websocket!.origin}` : '']
      .filter(Boolean)
      .join(' ') || "'none'";
  return `default-src 'none'; script-src ${script}; style-src ${style}; img-src 'self' data:${role === 'product' ? ' seed-plugin: https:' : ''}; ${role === 'product' ? "font-src 'self' seed-plugin:; " : ''}connect-src ${connect}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
}
