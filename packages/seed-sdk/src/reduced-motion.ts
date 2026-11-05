export const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(query?: MediaQueryList): boolean {
  if (typeof window === 'undefined') return false;
  const override = document.documentElement.dataset.reducedMotion;
  return override === undefined
    ? Boolean((query ?? window.matchMedia?.(reducedMotionQuery))?.matches)
    : override === 'true';
}
