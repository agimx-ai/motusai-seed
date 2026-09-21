import { createHash, randomBytes } from 'node:crypto'
import type { SeedBrowserAuthorizationRequest, SeedBrowserAuthorizationResult, SeedNetworkPermission } from '@motusai/seed-sdk'

type Pending = {
  packageId: string
  requestId: string
  verifier: string
  resolve(result: SeedBrowserAuthorizationResult): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
}

const reservedParameters = new Set([
  'response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method',
])

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

export function authorizationEndpointPermission(value: string): SeedNetworkPermission {
  const url = new URL(value)
  if (url.username || url.password || url.hash) throw new Error('授权地址不能包含凭据或片段。')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('授权地址协议无效。')
    return 'network.connect.loopback'
  }
  const octets = host.split('.').map(Number)
  const privateIp = octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && (octets[0] === 10 || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
      || (octets[0] === 192 && octets[1] === 168))
  if (privateIp) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('授权地址协议无效。')
    return 'network.connect.lan'
  }
  if (url.protocol !== 'https:') throw new Error('公网授权地址必须使用 HTTPS。')
  return 'network.connect.internet'
}

function authorizationUrl(request: SeedBrowserAuthorizationRequest, redirectUri: string, state: string, verifier: string) {
  if (typeof request.authorization_endpoint !== 'string' || request.authorization_endpoint.length > 2048) throw new Error('授权地址无效。')
  if (typeof request.client_id !== 'string' || !request.client_id || request.client_id.length > 512) throw new Error('OAuth 客户端 ID 无效。')
  if (typeof request.scope !== 'string' || request.scope.length > 1024) throw new Error('OAuth scope 无效。')
  if (request.standard === 'openid_connect.authorization_code.pkce' && !request.scope.split(/\s+/).includes('openid')) {
    throw new Error('OIDC 授权必须包含 openid scope。')
  }
  const url = new URL(request.authorization_endpoint)
  const parameters = request.parameters ?? {}
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters) || Object.keys(parameters).length > 16) {
    throw new Error('额外授权参数无效。')
  }
  for (const [key, value] of Object.entries(parameters)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/i.test(key) || reservedParameters.has(key.toLowerCase())
      || typeof value !== 'string' || value.length > 2048) throw new Error('额外授权参数无效。')
    url.searchParams.set(key, value)
  }
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', request.client_id)
  url.searchParams.set('redirect_uri', redirectUri)
  if (request.scope) url.searchParams.set('scope', request.scope)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', createHash('sha256').update(verifier, 'ascii').digest('base64url'))
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

/** Owns only the short-lived browser round trip. Plugins own token exchange and storage. */
export class PluginBrowserAuthorization {
  private readonly pending = new Map<string, Pending>()
  readonly redirectUri: string

  constructor(appId: string, private readonly openExternal: (url: string) => Promise<void>) {
    this.redirectUri = `${appId}:/plugin/oauth/callback`
  }

  start(packageId: string, requestId: string, request: SeedBrowserAuthorizationRequest) {
    if (!packageId || !/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error('插件授权请求无效。')
    if ([...this.pending.values()].some((entry) => entry.packageId === packageId && entry.requestId === requestId)) {
      throw new Error('重复的插件授权请求。')
    }
    const verifier = randomToken(48)
    const state = randomToken()
    const url = authorizationUrl(request, this.redirectUri, state, verifier)
    return new Promise<SeedBrowserAuthorizationResult>((resolve, reject) => {
      const timeout = setTimeout(() => this.finish(state, new Error('插件授权已超时。')), 10 * 60_000)
      this.pending.set(state, { packageId, requestId, verifier, resolve, reject, timeout })
      void Promise.resolve().then(() => this.pending.has(state) ? this.openExternal(url) : undefined).catch((error: unknown) => {
        this.finish(state, error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  handleCallback(value: string): boolean {
    let actual: URL
    try { actual = new URL(value) } catch { return false }
    const expected = new URL(this.redirectUri)
    if (actual.protocol !== expected.protocol || actual.host !== expected.host || actual.pathname !== expected.pathname) return false
    const state = actual.searchParams.get('state') || ''
    const pending = this.pending.get(state)
    if (!pending) return true
    const error = actual.searchParams.get('error')
    if (error) this.finish(state, new Error(`授权未完成：${error.slice(0, 100)}`))
    else {
      const code = actual.searchParams.get('code') || ''
      if (!code || code.length > 4096) this.finish(state, new Error('授权回调缺少有效的授权码。'))
      else this.finish(state, undefined, { code, code_verifier: pending.verifier, redirect_uri: this.redirectUri })
    }
    return true
  }

  cancel(packageId: string, requestId: string) {
    for (const [state, pending] of this.pending) {
      if (pending.packageId === packageId && pending.requestId === requestId) this.finish(state, new Error('插件授权已取消。'))
    }
  }

  cancelPlugin(packageId: string) {
    for (const [state, pending] of this.pending) {
      if (pending.packageId === packageId) this.finish(state, new Error('插件授权已取消。'))
    }
  }

  cancelAll() {
    for (const state of this.pending.keys()) this.finish(state, new Error('插件授权已取消。'))
  }

  private finish(state: string, error?: Error, result?: SeedBrowserAuthorizationResult) {
    const pending = this.pending.get(state)
    if (!pending) return
    this.pending.delete(state)
    clearTimeout(pending.timeout)
    if (error) pending.reject(error)
    else if (result) pending.resolve(result)
  }
}
