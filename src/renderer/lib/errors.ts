export function userFacingErrorMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason)
  const readable = message
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  // Only compact, single-sentence feedback drops its final period.
  // Keep paragraphs, longer explanations and internal sentence punctuation intact.
  if (readable.length <= 80 && /[。.]$/.test(readable) && !/[。.!?！？\r\n]/.test(readable.slice(0, -1))) {
    return readable.slice(0, -1)
  }
  return readable || '操作失败'
}
