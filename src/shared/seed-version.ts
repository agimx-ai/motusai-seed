export const seedVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export function compareSeedVersions(left: string, right: string): number {
  if (!seedVersionPattern.test(left) || !seedVersionPattern.test(right)) throw new Error('无效的 Seed 版本号。')
  const leftHyphen = left.indexOf('-')
  const rightHyphen = right.indexOf('-')
  const leftCore = leftHyphen < 0 ? left : left.slice(0, leftHyphen)
  const rightCore = rightHyphen < 0 ? right : right.slice(0, rightHyphen)
  const leftPrerelease = leftHyphen < 0 ? undefined : left.slice(leftHyphen + 1)
  const rightPrerelease = rightHyphen < 0 ? undefined : right.slice(rightHyphen + 1)
  const leftParts = leftCore!.split('.')
  const rightParts = rightCore!.split('.')
  for (let index = 0; index < 3; index += 1) {
    const a = BigInt(leftParts[index]!)
    const b = BigInt(rightParts[index]!)
    if (a !== b) return a > b ? 1 : -1
  }
  if (!leftPrerelease && !rightPrerelease) return 0
  if (!leftPrerelease) return 1
  if (!rightPrerelease) return -1
  const aParts = leftPrerelease.split('.')
  const bParts = rightPrerelease.split('.')
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
    const a = aParts[index]
    const b = bParts[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue
    const aNumeric = /^\d+$/.test(a)
    const bNumeric = /^\d+$/.test(b)
    if (aNumeric && bNumeric) return BigInt(a) > BigInt(b) ? 1 : -1
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    return a > b ? 1 : -1
  }
  return 0
}
