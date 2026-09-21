import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalJson, discoverDistribution } from './distribution-discovery'

function fixture() {
  const keys = generateKeyPairSync('ed25519')
  const cloudUrl = 'https://cloud.example.com'
  const payload = {
    ver: 3 as const,
    dist_id: 'motusai',
    auth: {
      issuer: cloudUrl,
      client_id: 'motusai-seed',
      redirect_uri: 'com.motusai.seed:/oauth/callback',
      authorization_endpoint: `${cloudUrl}/api/v1/oauth2/authorize`,
      token_endpoint: `${cloudUrl}/api/v1/oauth2/token`,
      userinfo_endpoint: `${cloudUrl}/api/v1/oauth2/userinfo`,
      revocation_endpoint: `${cloudUrl}/api/v1/oauth2/revoke`,
    },
    market_url: `${cloudUrl}/api/v1/catalog/motusai/plugins`,
    update_url: null,
    events_url: `${cloudUrl}/api/v1/distributions/motusai/events`,
    exp: Math.floor(Date.now() / 1000) + 300,
  }
  const sig = sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString('base64url')
  const trust = {
    seedCloudUrl: cloudUrl,
    distributionId: 'motusai',
    distributionKeyId: 'test-key',
    distributionPublicKey: keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  }
  return { payload, sig, trust }
}

describe('distribution discovery', () => {
  it('accepts a current document signed by the pinned key', async () => {
    const { payload, sig, trust } = fixture()
    const request = async (input: string | URL | Request) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/api/v1/distributions/motusai')
      expect(url.searchParams.get('platform')).toBe(process.platform)
      expect(url.searchParams.get('architecture')).toBe(process.arch)
      return Response.json({ alg: 'EdDSA', kid: 'test-key', payload, sig })
    }
    await expect(discoverDistribution(request as typeof fetch, trust)).resolves.toEqual(payload)
  })

  it('rejects a document changed after signing', async () => {
    const { payload, sig, trust } = fixture()
    const request = async () => Response.json({
      alg: 'EdDSA',
      kid: 'test-key',
      payload: { ...payload, market_url: 'https://attacker.example.com/plugins' },
      sig,
    })
    await expect(discoverDistribution(request as typeof fetch, trust)).rejects.toThrow('签名无效')
  })
})
