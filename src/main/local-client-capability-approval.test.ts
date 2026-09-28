import { describe, expect, it } from 'vitest'
import { validateLocalClientCapabilityApproval } from './local-client-capability-approval'

const now = Date.parse('2026-09-02T10:00:00.000Z')
const request = {
  provider_plugin_id: 'com.example.files',
  capability: 'files',
  capability_version: 1,
  method: 'write_file',
  auth_id: 'authorization-1',
  arguments_sha256: 'a'.repeat(64),
  approval: {
    kind: 'local_client_human_once',
    id: '2cc7ec41-e00a-41dd-8de7-21193f013ead',
    auth_id: 'authorization-1',
    provider_plugin_id: 'com.example.files',
    capability: 'files',
    capability_version: 1,
    method: 'write_file',
    arguments_sha256: 'a'.repeat(64),
    approved_at: new Date(now).toISOString(),
  },
}

describe('local client capability approval', () => {
  it('accepts an exact fresh one-time approval', () => {
    expect(validateLocalClientCapabilityApproval(request, new Map(), now)).toEqual({
      id: request.approval.id,
      authorizationId: 'authorization-1',
      expiresAt: now + 5 * 60_000,
    })
  })

  it('rejects replayed, stale, or argument-mismatched approvals', () => {
    expect(validateLocalClientCapabilityApproval(request, new Map([[request.approval.id, now + 1]]), now)).toBeNull()
    expect(validateLocalClientCapabilityApproval({ ...request, arguments_sha256: 'b'.repeat(64) }, new Map(), now)).toBeNull()
    expect(validateLocalClientCapabilityApproval({ ...request, auth_id: 'authorization-2' }, new Map(), now)).toBeNull()
    expect(validateLocalClientCapabilityApproval({ ...request, provider_plugin_id: 'com.example.other' }, new Map(), now)).toBeNull()
    expect(validateLocalClientCapabilityApproval({
      ...request,
      approval: { ...request.approval, approved_at: new Date(now - 5 * 60_000 - 1).toISOString() },
    }, new Map(), now)).toBeNull()
  })
})
