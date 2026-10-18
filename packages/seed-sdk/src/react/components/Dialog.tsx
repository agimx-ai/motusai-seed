import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import { usePluginStyleScope } from '../i18n';

/** Native top-layer dialog; no document-global event handlers or plugin business state. */
export function Dialog({
  open,
  title,
  closeLabel,
  busy = false,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  closeLabel: string;
  busy?: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const scope = usePluginStyleScope();
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current!;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    dialog.showModal();
    return () => {
      dialog.close();
      previousFocus?.focus();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <dialog
      data-plugin-view-portal={scope}
      ref={ref}
      aria-labelledby={titleId}
      className="seed-dialog relative m-auto max-h-[min(720px,calc(100vh-64px))] w-[calc(100%-48px)] max-w-[360px] overflow-auto rounded-[18px] border border-border bg-card px-6 pb-8 pt-6 text-foreground shadow-[0_18px_55px_rgba(0,0,0,.18)] outline-none"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || busy) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <div className="px-8 text-center">
        <h2 id={titleId} className="m-0 text-[17px] font-medium">
          {title}
        </h2>
        <div className="absolute right-4 top-4">
          <IconButton label={closeLabel} icon={<X size={17} />} showTooltip={false} disabled={busy} onClick={onClose} />
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </dialog>,
    document.body,
  );
}
