export type ValidLocalClientCapabilityApproval = {
  id: string
  authorizationId: string
  expiresAt: number
}

export function validateLocalClientCapabilityApproval(
  argumentsValue: Record<string, unknown>,
  consumedApprovalIds: ReadonlyMap<string, number>,
  now = Date.now(),
): ValidLocalClientCapabilityApproval | null {
  const approval = argumentsValue.approval
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) return null
  const value = approval as Record<string, unknown>
  const id = String(value.id || '')
  const authorizationId = String(value.auth_id || '')
  const requestAuthorizationId = String(argumentsValue.auth_id || '')
  const approvedAt = Date.parse(String(value.approved_at || ''))
  const capabilityVersion = Number(argumentsValue.capability_version)
  const argumentsSha256 = String(argumentsValue.arguments_sha256 || '')
  if (
    value.kind !== 'local_client_human_once'
    || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)
    || consumedApprovalIds.has(id)
    || !authorizationId
    || authorizationId !== requestAuthorizationId
    || String(value.provider_plugin_id || '') !== String(argumentsValue.provider_plugin_id || '')
    || String(value.capability || '') !== String(argumentsValue.capability || '')
    || Number(value.capability_version) !== capabilityVersion
    || String(value.method || '') !== String(argumentsValue.method || '')
    || String(value.arguments_sha256 || '') !== argumentsSha256
    || !/^[0-9a-f]{64}$/i.test(argumentsSha256)
    || !Number.isFinite(approvedAt)
    || approvedAt > now + 30_000
    || now - approvedAt > 5 * 60_000
  ) return null
  return { id, authorizationId, expiresAt: now + 5 * 60_000 }
}
