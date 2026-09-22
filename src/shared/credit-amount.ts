/** Cloud credit amounts have two decimal places, including settlement diagnostics. */
export function isCreditAmount(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  const cents = Math.round(value * 100)
  return Number.isSafeInteger(cents) && Math.abs(value * 100 - cents) <= 1e-7
}
