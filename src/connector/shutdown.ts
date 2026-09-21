export async function waitForSettlement(work: PromiseLike<unknown>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(work).then(() => true),
      new Promise<false>((resolve) => { timeout = setTimeout(() => resolve(false), timeoutMs) }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
