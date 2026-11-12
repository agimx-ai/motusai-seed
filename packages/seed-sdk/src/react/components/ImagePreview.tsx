import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { usePluginStyleScope } from '../style-scope';
import { IconButton } from './IconButton';
import './ImagePreview.css';

const origin = { x: 0, y: 0 };
const zoomLevels = [25, 50, 75, 100, 125, 150, 200, 300, 400, 800];
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

export type ImagePreviewProps = {
  src: string;
  alt: string;
  title: string;
  labels: { close: string; fit: string; zoom: string; loadFailed: string };
  onClose(): void;
  download?: { label: string; onClick(): void };
};

export function ImagePreview({ src, alt, title, labels, onClose, download }: ImagePreviewProps) {
  const scope = usePluginStyleScope();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pan = useRef<{ id: number; x: number; y: number } | null>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [offset, setOffset] = useState(origin);
  const [dragging, setDragging] = useState(false);
  const [failed, setFailed] = useState(false);

  const fit = natural.width && natural.height && bounds.width && bounds.height
    ? Math.min(1, bounds.width / natural.width, bounds.height / natural.height)
    : 1;
  const scale = zoom ?? fit;
  const width = natural.width * scale;
  const height = natural.height * scale;
  const maxX = Math.max(0, (width - bounds.width) / 2);
  const maxY = Math.max(0, (height - bounds.height) / 2);
  const x = clamp(offset.x, maxX);
  const y = clamp(offset.y, maxY);
  const canPan = maxX > 0 || maxY > 0;
  const percentage = Math.round(scale * 100);
  const options = zoom !== null && !zoomLevels.includes(percentage)
    ? [...zoomLevels, percentage].sort((a, b) => a - b)
    : zoomLevels;

  useLayoutEffect(() => {
    const element = dialog.current!;
    let previous = document.activeElement;
    while (previous?.shadowRoot?.activeElement) previous = previous.shadowRoot.activeElement;
    element.showModal();
    element.querySelector<HTMLButtonElement>('[data-image-preview-close]')?.focus({ preventScroll: true });
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    const element = viewport.current!;
    const measure = () => setBounds({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = viewport.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!(event.target instanceof HTMLImageElement) || !event.deltaY) return;
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      const delta = clamp(event.deltaY * units, 100);
      const next = Math.max(0.1, Math.min(8, scale * Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.002))));
      const rect = element.getBoundingClientRect();
      const anchorX = event.clientX - rect.left - rect.width / 2;
      const anchorY = event.clientY - rect.top - rect.height / 2;
      setOffset({ x: anchorX - (anchorX - x) * next / scale, y: anchorY - (anchorY - y) * next / scale });
      setZoom(next);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [scale, x, y]);

  return createPortal(
    <dialog
      ref={dialog}
      className="seed-dialog seed-image-preview"
      data-plugin-view-portal={scope}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <header className="seed-image-preview-toolbar">
        <h2 id={titleId}>{title}</h2>
        <div className="seed-image-preview-controls">
          <select
            aria-label={labels.zoom}
            disabled={!natural.width || failed}
            value={zoom === null ? 'fit' : String(percentage)}
            onChange={(event) => {
              setZoom(event.target.value === 'fit' ? null : Number(event.target.value) / 100);
              setOffset(origin);
            }}
          >
            <option value="fit">{labels.fit} ({Math.round(fit * 100)}%)</option>
            {options.map((option) => <option key={option} value={option}>{option}%</option>)}
          </select>
          {download && (
            <IconButton icon={<Download size={16} />} label={download.label} showTooltip={false} onClick={download.onClick} />
          )}
          <IconButton
            icon={<X size={17} />}
            label={labels.close}
            showTooltip={false}
            onClick={onClose}
            data-image-preview-close=""
          />
        </div>
      </header>
      <div
        ref={viewport}
        className="seed-image-preview-viewport"
        data-pannable={canPan || undefined}
        data-dragging={dragging || undefined}
        onPointerDown={(event) => {
          if (!canPan || pan.current || event.button !== 0 || !(event.target instanceof HTMLImageElement)) return;
          pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          const gesture = pan.current;
          if (!gesture || gesture.id !== event.pointerId) return;
          const dx = event.clientX - gesture.x;
          const dy = event.clientY - gesture.y;
          gesture.x = event.clientX;
          gesture.y = event.clientY;
          setOffset((point) => ({ x: clamp(clamp(point.x, maxX) + dx, maxX), y: clamp(clamp(point.y, maxY) + dy, maxY) }));
        }}
        onLostPointerCapture={(event) => {
          if (pan.current?.id !== event.pointerId) return;
          pan.current = null;
          setDragging(false);
        }}
      >
        {failed ? <p role="status">{labels.loadFailed}</p> : (
          <img
            src={src}
            alt={alt}
            draggable={false}
            referrerPolicy="no-referrer"
            onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            onError={() => setFailed(true)}
            style={{ width, height, transform: `translate(${x}px, ${y}px)` }}
          />
        )}
      </div>
    </dialog>,
    document.body,
  );
}
