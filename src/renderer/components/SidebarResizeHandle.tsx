import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export const defaultSidebarWidth = 224;
export const maxSidebarWidth = 360;

export function clampSidebarWidth(width: number): number {
  return Math.min(maxSidebarWidth, Math.max(defaultSidebarWidth, Math.round(width)));
}

export function SidebarResizeHandle({ width, onResize, onDragChange }: {
  width: number;
  onResize(width: number): void;
  onDragChange(dragging: boolean): void;
}) {
  const { t } = useTranslation();
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  useEffect(() => () => {
    if (drag.current) onDragChange(false);
  }, [onDragChange]);

  const finishDrag = (pointerId: number) => {
    if (drag.current?.pointerId !== pointerId) return;
    drag.current = null;
    onDragChange(false);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={t('nav.resizeSidebar')}
      aria-controls="seed-left-sidebar"
      aria-orientation="vertical"
      aria-valuemin={defaultSidebarWidth}
      aria-valuemax={maxSidebarWidth}
      aria-valuenow={width}
      className="absolute inset-y-0 right-0 z-[45] col-start-1 col-end-2 row-start-1 row-end-2 w-2 translate-x-1/2 touch-none cursor-col-resize outline-none [-webkit-app-region:no-drag] after:absolute after:inset-y-0 after:left-1/2 after:w-px hover:after:bg-input focus-visible:after:bg-foreground"
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, x: event.clientX, width };
        onDragChange(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start?.pointerId === event.pointerId)
          onResize(clampSidebarWidth(start.width + event.clientX - start.x));
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        if (start?.pointerId !== event.pointerId) return;
        onResize(clampSidebarWidth(start.width + event.clientX - start.x));
        finishDrag(event.pointerId);
      }}
      onPointerCancel={(event) => finishDrag(event.pointerId)}
      onLostPointerCapture={(event) => finishDrag(event.pointerId)}
      onKeyDown={(event) => {
        const start = drag.current;
        if (event.key === 'Escape' && start) {
          onResize(start.width);
          if (event.currentTarget.hasPointerCapture(start.pointerId)) event.currentTarget.releasePointerCapture(start.pointerId);
          finishDrag(start.pointerId);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          onResize(clampSidebarWidth(width + (event.key === 'ArrowLeft' ? -16 : 16)));
        } else if (event.key === 'Home' || event.key === 'End') {
          onResize(event.key === 'Home' ? defaultSidebarWidth : maxSidebarWidth);
        } else return;
        event.preventDefault();
      }}
    />
  );
}
