import { describe, expect, it } from 'vitest'
import type { SeedDistribution } from '../shared/contracts'
import { CloudAuthHttpError, cloudSessionWasRejected, createCloudAuthorization, parseCloudAuthorizationCallback, stateMatches } from './cloud-auth'

const distribution: SeedDistribution = {
  ver: 3,
  dist_id: 'motusai',
  auth: {
    issuer: 'https://cloud.example.com',
    client_id: 'seed-desktop',
    redirect_uri: 'com.motusai.seed:/oauth/callback',
    authorization_endpoint: 'https://cloud.example.com/api/v1/oauth2/authorize',
    token_endpoint: 'https://cloud.example.com/api/v1/oauth2/token',
    userinfo_endpoint: 'https://cloud.example.com/api/v1/oauth2/userinfo',
    revocation_endpoint: 'https://cloud.example.com/api/v1/oauth2/revoke',
  },
  market_url: null,
  update_url: null,
  events_url: 'https://cloud.example.com/api/v1/distributions/motusai/events',
  exp: Math.floor(Date.now() / 1000) + 300,
}

describe('Seed Cloud native authorization', () => {
  it('creates an authorization code request with PKCE and the registered callback', () => {
    const start = createCloudAuthorization(distribution)
    const url = new URL(start.authorizationUrl)
    expect(url.origin).toBe('https://cloud.example.com')
    expect(url.pathname).toBe('/api/v1/oauth2/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('seed-desktop')
    expect(url.searchParams.get('redirect_uri')).toBe('com.motusai.seed:/oauth/callback')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe(start.state)
    expect(url.searchParams.get('code_challenge')).toHaveLength(43)
    expect(start.verifier.length).toBeGreaterThanOrEqual(43)
  })

  it('accepts only the exact custom-protocol callback and matching state', () => {
    const parsed = parseCloudAuthorizationCallback(
      'com.motusai.seed:/oauth/callback?code=one-time-code&state=expected',
      distribution.auth.redirect_uri,
    )
    expect(parsed).toEqual({ code: 'one-time-code', state: 'expected', error: '' })
    expect(stateMatches(parsed!.state, 'expected')).toBe(true)
    expect(stateMatches(parsed!.state, 'different')).toBe(false)
    expect(parseCloudAuthorizationCallback(
      'com.attacker.seed:/oauth/callback?code=one-time-code&state=expected',
      distribution.auth.redirect_uri,
    )).toBeNull()
  })

  it('distinguishes a rejected Cloud session from a temporary outage', () => {
    expect(cloudSessionWasRejected(new CloudAuthHttpError('invalid grant', 400))).toBe(true)
    expect(cloudSessionWasRejected(new CloudAuthHttpError('unauthorized', 401))).toBe(true)
    expect(cloudSessionWasRejected(new CloudAuthHttpError('unavailable', 503))).toBe(false)
    expect(cloudSessionWasRejected(new TypeError('fetch failed'))).toBe(false)
  })
})
