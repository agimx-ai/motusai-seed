import { useEffect, useState } from 'react';
import { prefersReducedMotion, reducedMotionQuery } from '../reduced-motion.js';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => prefersReducedMotion());

  useEffect(() => {
    const query = window.matchMedia?.(reducedMotionQuery);
    const update = () => setReduced(prefersReducedMotion(query));
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion'] });
    query?.addEventListener('change', update);
    update();
    return () => {
      observer.disconnect();
      query?.removeEventListener('change', update);
    };
  }, []);

  return reduced;
}
