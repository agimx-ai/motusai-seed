export function scrollEdges({ scrollTop, scrollHeight, clientHeight }: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}) {
  return {
    top: scrollTop > 1,
    bottom: scrollHeight - clientHeight - Math.max(0, scrollTop) > 1,
  }
}
