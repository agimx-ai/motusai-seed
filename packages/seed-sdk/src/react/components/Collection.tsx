import { createPortal } from 'react-dom';
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import './Collection.css';
import { usePluginStyleScope } from '../i18n';

const dialogs: HTMLElement[] = [];

export function Collection({ children }: { children: ReactNode }) {
  return <div className="seed-collection">{children}</div>;
}
export function CollectionCard({
  icon,
  title,
  description,
  onOpen,
  disabled,
  actions,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  onOpen(): void;
  disabled?: boolean;
  actions?: ReactNode;
}) {
  return (
    <article className="seed-collection-card">
      <button className="seed-collection-open" onClick={onOpen} disabled={disabled}>
        <span className="seed-collection-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="seed-collection-text">
          <strong>{title}</strong>
          {description && <span>{description}</span>}
        </span>
      </button>
      {actions && <div className="seed-collection-actions">{actions}</div>}
    </article>
  );
}

export function PreviewDialog({
  title,
  description,
  icon,
  onClose,
  children,
  actions,
  closeLabel,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  onClose(): void;
  children: ReactNode;
  actions?: ReactNode;
  closeLabel: string;
}) {
  const scope = usePluginStyleScope();
  const container = useRef<HTMLElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const current = container.current!;
    dialogs.push(current);
    container.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (dialogs.at(-1) !== current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const elements = [
        ...(container.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]',
        ) ?? []),
      ];
      const target = event.shiftKey ? elements.at(-1) : elements[0];
      if (
        !elements.length ||
        document.activeElement === container.current ||
        document.activeElement === (event.shiftKey ? elements[0] : elements.at(-1))
      ) {
        event.preventDefault();
        target?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      const index = dialogs.indexOf(current);
      if (index >= 0) dialogs.splice(index, 1);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      data-plugin-view-portal={scope}
      className="seed-preview-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="seed-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={container}
      >
        <header>
          {icon && <span className="seed-collection-icon">{icon}</span>}
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button aria-label={closeLabel} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="seed-preview-content">{children}</div>
        {actions && <footer>{actions}</footer>}
      </section>
    </div>,
    document.body,
  );
}
