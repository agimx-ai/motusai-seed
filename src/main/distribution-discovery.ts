import { createPublicKey, verify } from 'node:crypto'
import { buildConfig } from '../shared/build-config.generated'
import type { SeedDistribution } from '../shared/contracts'
import { signedSeedDistributionSchema } from '../shared/validation'

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

type DistributionTrust = {
  seedCloudUrl: string
  distributionId: string
  distributionKeyId: string
  distributionPublicKey: string
}

export async function discoverDistribution(
  request: typeof fetch = fetch,
  trust: DistributionTrust = buildConfig,
): Promise<SeedDistribution> {
  const url = new URL(`/api/v1/distributions/${encodeURIComponent(trust.distributionId)}`, trust.seedCloudUrl)
  url.searchParams.set('platform', process.platform)
  url.searchParams.set('architecture', process.arch)
  const response = await request(
    url,
    { headers: { Accept: 'application/json' }, redirect: 'error' },
  )
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`无法读取 Seed Cloud 客户端配置（${response.status}）。`)
  const document = signedSeedDistributionSchema.parse(body)
  if (document.kid !== trust.distributionKeyId) throw new Error('Seed Cloud 客户端配置使用了未知签名密钥。')
  const publicKey = createPublicKey({
    key: Buffer.from(trust.distributionPublicKey, 'base64'),
    format: 'der',
    type: 'spki',
  })
  if (!verify(null, Buffer.from(canonicalJson(document.payload)), publicKey, Buffer.from(document.sig, 'base64url'))) {
    throw new Error('Seed Cloud 客户端配置签名无效。')
  }
  if (document.payload.dist_id !== trust.distributionId) throw new Error('Seed Cloud 返回了错误的客户端配置。')
  if (document.payload.exp <= Math.floor(Date.now() / 1000)) throw new Error('Seed Cloud 客户端配置已经过期。')
  return document.payload
}
