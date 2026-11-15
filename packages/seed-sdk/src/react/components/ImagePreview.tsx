import { useLayoutEffect, useMemo, useRef } from 'react';
import { Download } from 'lucide-react';
import Lightbox, { type SlideImage } from 'yet-another-react-lightbox';
import { usePluginStyleScope } from '../style-scope';
import { useReducedMotion } from '../use-reduced-motion';
import 'yet-another-react-lightbox/styles.css';
import './ImagePreview.css';

export type ImagePreviewImage = Pick<SlideImage, 'src' | 'alt' | 'width' | 'height'>;

export type ImagePreviewProps = {
  title: string;
  labels: {
    close: string;
    loadFailed: string;
    previous?: string;
    next?: string;
    /** @deprecated The basic preview fits the image automatically. */
    fit?: string;
    /** @deprecated The basic preview has no zoom menu. */
    zoom?: string;
  };
  onClose(): void;
  download?: { label: string; onClick(): void };
} & (
  | { src: string; alt: string; images?: never; initialIndex?: never }
  | { images: ImagePreviewImage[]; initialIndex?: number; src?: never; alt?: never }
);

export function ImagePreview({ src, alt, images, initialIndex, title, labels, onClose, download }: ImagePreviewProps) {
  const scope = usePluginStyleScope();
  const focusGeneration = useRef(0);
  const reducedMotion = useReducedMotion();
  const slides = useMemo(() => images ?? (src ? [{ src, alt }] : []), [images, src, alt]);
  const portalScope = scope ? { 'data-plugin-view-portal': scope } : {};

  useLayoutEffect(() => {
    const generation = ++focusGeneration.current;
    let previous = document.activeElement;
    while (previous?.shadowRoot?.activeElement) previous = previous.shadowRoot.activeElement;
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) {
        queueMicrotask(() => {
          if (generation === focusGeneration.current && previous.isConnected) previous.focus({ preventScroll: true });
        });
      }
    };
  }, []);

  return (
    <Lightbox
      open
      close={onClose}
      slides={slides}
      index={initialIndex}
      animation={reducedMotion ? { fade: 0, swipe: 0, navigation: 0 } : undefined}
      carousel={{ finite: true, preload: 1, imageProps: { referrerPolicy: 'no-referrer' } }}
      controller={{ aria: true, closeOnBackdropClick: true }}
      portal={{ container: { className: 'seed-image-preview', ...portalScope } }}
      noScroll={{ disabled: true }}
      labels={{
        Lightbox: title,
        'Photo gallery': title,
        Close: labels.close,
        Previous: labels.previous,
        Next: labels.next,
      }}
      render={{ iconError: () => <span>{labels.loadFailed}</span> }}
      toolbar={download ? { buttons: [
        <button key="download" className="yarl__button" type="button" aria-label={download.label} title={download.label}
          onClick={download.onClick}>
          <Download size={18} aria-hidden="true" />
        </button>,
        'close',
      ] } : undefined}
    />
  );
}
