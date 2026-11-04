import { useEffect, useRef, type ComponentPropsWithoutRef } from 'react';
import type { ExtraProps } from 'streamdown';

export function MarkdownTableHeader({ className, node: _node, ...props }: ComponentPropsWithoutRef<'thead'> & ExtraProps) {
  const ref = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    const header = ref.current!;
    const table = header.closest('table');
    const win = header.ownerDocument.defaultView;
    if (!win || !table) return;

    // The immediate wrapper scrolls horizontally. Pin against the surrounding vertical viewport.
    const scrollport = table.parentElement!;
    const clips: HTMLElement[] = [];
    for (let parent = scrollport.parentElement; parent; parent = parent.parentElement) {
      if (/^(auto|scroll|hidden|clip)$/.test(win.getComputedStyle(parent).overflowY)) clips.push(parent);
    }

    let frame = 0;
    let offset = 0;
    let visible = !win.IntersectionObserver;
    const update = () => {
      frame = 0;
      const bounds = table.getBoundingClientRect();
      const head = header.getBoundingClientRect();
      // Keep the original row in the table so column widths and horizontal scrolling stay in sync.
      const naturalTop = head.top - offset;
      const top = clips.reduce((edge, clip) => Math.max(edge, clip.getBoundingClientRect().top + clip.clientTop), 0);
      const next = Math.max(0, Math.min(top - naturalTop, bounds.bottom - naturalTop - head.height));
      if (next === offset) return;
      offset = next;
      header.style.translate = offset ? `0 ${offset}px` : '';
    };
    const schedule = () => {
      if (visible && !frame) frame = win.requestAnimationFrame(update);
    };
    const intersection = win.IntersectionObserver && new win.IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      schedule();
    });
    intersection?.observe(table);
    const resize = win.ResizeObserver && new win.ResizeObserver(schedule);
    resize?.observe(table);
    win.addEventListener('scroll', schedule, { capture: true, passive: true });
    win.addEventListener('resize', schedule);
    schedule();
    return () => {
      if (frame) win.cancelAnimationFrame(frame);
      intersection?.disconnect();
      resize?.disconnect();
      win.removeEventListener('scroll', schedule, true);
      win.removeEventListener('resize', schedule);
      header.style.translate = '';
    };
  }, []);

  return <thead {...props} data-streamdown="table-header" ref={ref} className={['seed-markdown-table-head', className].filter(Boolean).join(' ')} />;
}
