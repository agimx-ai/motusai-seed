/** Keep Sonner's height variables in sync with the SDK's responsive action footer. */
export function observeToastLayout(root: HTMLElement): () => void {
  const view = root.ownerDocument.defaultView!;
  const observed = new Set<Element>();
  let frame = 0;
  const schedule = () => {
    if (!frame) frame = view.requestAnimationFrame(layout);
  };
  const resize = new view.ResizeObserver(schedule);
  const mutations = new view.MutationObserver(schedule);
  const watch = () => mutations.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['style', 'data-removed'],
  });
  function layout() {
    frame = 0;
    mutations.disconnect();
    const current = new Set<Element>();
    for (const list of root.querySelectorAll<HTMLElement>(':scope > [data-sonner-toaster]')) {
      let offset = 0;
      const configuredGap = Number.parseFloat(view.getComputedStyle(list).getPropertyValue('--gap'));
      const gap = Number.isFinite(configuredGap) ? configuredGap : 8;
      const toasts = [...list.querySelectorAll<HTMLElement>(':scope > [data-sonner-toast]')]
        .filter((toast) => toast.dataset.removed !== 'true');
      for (const toast of toasts) {
        const content = toast.querySelector<HTMLElement>('.seed-toast-content');
        const title = content?.querySelector<HTMLElement>('[data-title]');
        current.add(toast);
        if (content) current.add(content);
        const height = toast.style.height;
        toast.style.height = 'auto';
        toast.removeAttribute('data-multiline');
        if (content && title && toast.dataset.styled === 'true' &&
          toast.querySelector('.seed-toast-action, .seed-toast-cancel')) {
          const lineHeight = Number.parseFloat(view.getComputedStyle(title).lineHeight);
          if (title.offsetHeight > lineHeight + 1 || content.querySelector('[data-description]')) {
            toast.dataset.multiline = 'true';
          }
        }
        const measuredHeight = toast.offsetHeight;
        toast.style.height = height;
        // Sonner caches heights; refresh its CSS variables after the footer reflows.
        toast.style.setProperty('--initial-height', `${measuredHeight}px`);
        toast.style.setProperty('--offset', `${offset}px`);
        if (toast === toasts[0]) list.style.setProperty('--front-toast-height', `${measuredHeight}px`);
        offset += measuredHeight + gap;
      }
    }
    for (const element of observed) if (!current.has(element)) {
      resize.unobserve(element);
      observed.delete(element);
    }
    for (const element of current) if (!observed.has(element)) {
      resize.observe(element);
      observed.add(element);
    }
    watch();
  }
  watch();
  schedule();
  return () => {
    view.cancelAnimationFrame(frame);
    mutations.disconnect();
    resize.disconnect();
  };
}
