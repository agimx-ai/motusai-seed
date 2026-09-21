import { createHash, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorizationEndpointPermission, PluginBrowserAuthorization } from './plugin-browser-authorization'

const request = {
  standard: 'oauth2.authorization_code.pkce' as const,
  authorization_endpoint: 'https://accounts.example.com/authorize',
  client_id: 'public-client',
  scope: 'openid profile',
}

afterEach(() => vi.useRealTimers())

describe('plugin browser authorization', () => {
  it('opens a standard PKCE request and returns the code only to the matching session', async () => {
    const openExternal = vi.fn(async (_url: string) => undefined)
    const auth = new PluginBrowserAuthorization('com.motusai.seed', openExternal)
    const pending = auth.start('com.example.one', randomUUID(), request)
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledOnce())
    const url = new URL(openExternal.mock.calls[0]![0])
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe('com.motusai.seed:/plugin/oauth/callback')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(auth.handleCallback('com.motusai.seed:/oauth/callback?code=wrong')).toBe(false)
    expect(auth.handleCallback(`${auth.redirectUri}?code=wrong&state=not-this-request`)).toBe(true)
    expect(auth.handleCallback(`${auth.redirectUri}?code=valid-code&state=${url.searchParams.get('state')}`)).toBe(true)
    const result = await pending
    expect(result).toEqual({ code: 'valid-code', code_verifier: expect.any(String), redirect_uri: auth.redirectUri })
    expect(createHash('sha256').update(result.code_verifier, 'ascii').digest('base64url')).toBe(url.searchParams.get('code_challenge'))
  })

  it('isolates cancellation by plugin', async () => {
    const auth = new PluginBrowserAuthorization('com.motusai.seed', async () => undefined)
    const first = auth.start('com.example.one', randomUUID(), request)
    const second = auth.start('com.example.two', randomUUID(), request)
    const rejected = expect(first).rejects.toThrow('已取消')
    auth.cancelPlugin('com.example.one')
    await rejected
    auth.cancelPlugin('com.example.one')
    const rejectedSecond = expect(second).rejects.toThrow('已取消')
    auth.cancelPlugin('com.example.two')
    await rejectedSecond
  })

  it('rejects provider errors and consumes callbacks only once', async () => {
    const openExternal = vi.fn(async (_url: string) => undefined)
    const auth = new PluginBrowserAuthorization('com.motusai.seed', openExternal)
    const pending = auth.start('com.example.one', randomUUID(), request)
    const rejected = expect(pending).rejects.toThrow('access_denied')
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledOnce())
    const state = new URL(openExternal.mock.calls[0]![0]).searchParams.get('state')
    expect(auth.handleCallback(`${auth.redirectUri}?error=access_denied&state=${state}`)).toBe(true)
    await rejected
    expect(auth.handleCallback(`${auth.redirectUri}?code=replayed&state=${state}`)).toBe(true)
  })

  it('rejects reserved parameters, unsafe URLs, and failed browser opening', async () => {
    expect(() => authorizationEndpointPermission('http://github.com/login/oauth/authorize')).toThrow('HTTPS')
    expect(authorizationEndpointPermission('http://192.168.2.58:18192/oauth2/authorize')).toBe('network.connect.lan')
    const auth = new PluginBrowserAuthorization('com.motusai.seed', async () => { throw new Error('browser unavailable') })
    expect(() => auth.start('com.example.one', randomUUID(), { ...request, parameters: { state: 'attacker' } })).toThrow('额外授权参数无效')
    expect(() => auth.start('com.example.one', randomUUID(), {
      ...request, standard: 'openid_connect.authorization_code.pkce', scope: 'profile',
    })).toThrow('openid scope')
    await expect(auth.start('com.example.one', randomUUID(), request)).rejects.toThrow('browser unavailable')
  })

  it('expires unanswered authorization requests', async () => {
    vi.useFakeTimers()
    const auth = new PluginBrowserAuthorization('com.motusai.seed', async () => undefined)
    const pending = auth.start('com.example.one', randomUUID(), request)
    const rejected = expect(pending).rejects.toThrow('已超时')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    await rejected
  })
})
