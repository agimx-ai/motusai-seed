import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { shell } from 'electron'
import { z } from 'zod'
import type { SeedDistribution, TerminalUserProfile, UpdateProfileInput } from '../shared/contracts'

const tokenResponseSchema = z.object({
  access_token: z.string().min(43),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(43),
  refresh_expires_in: z.number().int().positive(),
  scope: z.string().min(1),
}).strict()

const userResponseSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(1),
  name: z.string().min(1),
  avatar: z.string().url().nullable(),
  role: z.enum(['user', 'admin']),
}).strict()

export type CloudSessionCredential = {
  accessToken: string
  refreshToken: string
  accessExpiresAt: string
  refreshExpiresAt: string
  user: TerminalUserProfile
}

export type CloudAuthorizationStart = {
  state: string
  verifier: string
  authorizationUrl: string
}

export class CloudAuthHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'CloudAuthHttpError'
  }
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

function equalText(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

async function responseJson(response: Response) {
  const value = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok) {
    throw new CloudAuthHttpError(
      String(value?.message || value?.error_description || `登录请求失败（${response.status}）。`),
      response.status,
    )
  }
  return value
}

export function cloudSessionWasRejected(error: unknown) {
  return error instanceof CloudAuthHttpError && (error.status === 400 || error.status === 401)
}

function userProfile(value: z.infer<typeof userResponseSchema>): TerminalUserProfile {
  return {
    id: value.id,
    displayName: value.name,
    username: value.username,
    ...(value.avatar ? { avatarDataUrl: value.avatar } : {}),
  }
}

export function createCloudAuthorization(distribution: SeedDistribution): CloudAuthorizationStart {
  const state = randomToken()
  const verifier = randomToken(48)
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url')
  const url = new URL(distribution.auth.authorization_endpoint)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: distribution.auth.client_id,
    redirect_uri: distribution.auth.redirect_uri,
    scope: 'openid profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }).toString()
  return { state, verifier, authorizationUrl: url.toString() }
}

export function parseCloudAuthorizationCallback(value: string, redirectUri: string) {
  try {
    const actual = new URL(value)
    const expected = new URL(redirectUri)
    if (actual.protocol !== expected.protocol || actual.hostname !== expected.hostname || actual.pathname !== expected.pathname) return null
    return {
      code: actual.searchParams.get('code') || '',
      state: actual.searchParams.get('state') || '',
      error: actual.searchParams.get('error') || '',
    }
  } catch {
    return null
  }
}

export function stateMatches(actual: string, expected: string) {
  return Boolean(actual && expected && equalText(actual, expected))
}

export async function openCloudAuthorization(start: CloudAuthorizationStart) {
  await shell.openExternal(start.authorizationUrl)
}

async function cloudUserRequest(distribution: SeedDistribution, accessToken: string, body?: string): Promise<TerminalUserProfile> {
  const response = await fetch(distribution.auth.userinfo_endpoint, {
    method: body ? 'PATCH' : 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body } : {}),
    redirect: 'error',
  })
  return userProfile(userResponseSchema.parse(await responseJson(response)))
}

export function readCloudUser(distribution: SeedDistribution, accessToken: string): Promise<TerminalUserProfile> {
  return cloudUserRequest(distribution, accessToken)
}

export async function updateCloudUser(
  distribution: SeedDistribution,
  accessToken: string,
  input: UpdateProfileInput,
): Promise<TerminalUserProfile> {
  return cloudUserRequest(distribution, accessToken, JSON.stringify({
    name: input.displayName,
    username: input.username,
    ...(input.avatarDataUrl ? { avatar_data_url: input.avatarDataUrl } : {}),
  }))
}

async function tokenRequest(distribution: SeedDistribution, body: URLSearchParams) {
  const response = await fetch(distribution.auth.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    redirect: 'error',
  })
  return tokenResponseSchema.parse(await responseJson(response))
}

async function credentialFromToken(
  distribution: SeedDistribution,
  token: z.infer<typeof tokenResponseSchema>,
  cachedUser?: TerminalUserProfile,
) {
  let user = cachedUser
  try {
    user = await readCloudUser(distribution, token.access_token)
  } catch (error) {
    if (!user || cloudSessionWasRejected(error)) throw error
  }
  if (!user) throw new Error('Seed Cloud 未返回登录账号。')
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    accessExpiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + token.refresh_expires_in * 1000).toISOString(),
    user,
  }
}

export async function exchangeCloudAuthorizationCode(
  distribution: SeedDistribution,
  code: string,
  verifier: string,
): Promise<CloudSessionCredential> {
  const token = await tokenRequest(distribution, new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: distribution.auth.client_id,
    code,
    redirect_uri: distribution.auth.redirect_uri,
    code_verifier: verifier,
  }))
  return credentialFromToken(distribution, token)
}

export async function refreshCloudCredential(
  distribution: SeedDistribution,
  refreshToken: string,
  cachedUser: TerminalUserProfile,
): Promise<CloudSessionCredential> {
  const token = await tokenRequest(distribution, new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: distribution.auth.client_id,
    refresh_token: refreshToken,
  }))
  return credentialFromToken(distribution, token, cachedUser)
}

export async function revokeCloudCredential(distribution: SeedDistribution, token: string) {
  const response = await fetch(distribution.auth.revocation_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ token }),
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`无法注销云端登录（${response.status}）。`)
}
