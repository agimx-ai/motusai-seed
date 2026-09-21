export function userFacingErrorMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason)
  const readable = message
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  return readable || '操作失败。'
}
