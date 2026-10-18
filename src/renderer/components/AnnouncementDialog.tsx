import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { ActionButton, IconButton } from '@motus-ai/seed-sdk/react';
import type { SeedAnnouncement } from '../../shared/announcements';
import type { SeedLocale } from '../../shared/contracts';
import logoUrl from '../../../resources/app/app-light.svg?url';

type Background = { url: string; failed: boolean };

function backgroundKey(announcement: SeedAnnouncement) {
  return `${announcement.id}:${announcement.background_url}`;
}

export function AnnouncementDialog(props: { announcements: SeedAnnouncement[]; locale: SeedLocale }) {
  return props.announcements.length ? <AnnouncementDeck {...props} /> : null;
}

function AnnouncementDeck({ announcements, locale }: { announcements: SeedAnnouncement[]; locale: SeedLocale }) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState({ id: announcements[0]!.id, index: 0 });
  const selectedIndex = announcements.findIndex((item) => item.id === selection.id);
  const requestedIndex = selectedIndex >= 0 ? selectedIndex : Math.min(selection.index, announcements.length - 1);
  const requested = announcements[requestedIndex]!;
  const [displayed, setDisplayed] = useState({ announcement: requested, url: '', failed: false });
  const announcement =
    backgroundKey(displayed.announcement) === backgroundKey(requested) ? requested : displayed.announcement;
  const displayedIndex = announcements.findIndex((item) => item.id === announcement.id);
  const index = displayedIndex >= 0 ? displayedIndex : requestedIndex;
  const multiple = announcements.length > 1;
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const images = useRef(new Map<string, Promise<Background>>());
  const background = displayed.url;
  const imageFailed = displayed.failed;
  const [imageAttempt, setImageAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [acting, setActing] = useState(false);
  const [loading, setLoading] = useState(true);
  const busy = acting || loading || backgroundKey(requested) !== backgroundKey(announcement);
  const inFlight = useRef(false);
  const [error, setError] = useState({ id: '', message: '' });
  const imageAbove = announcement.template === 'image-above';

  const loadBackground = useCallback((item: SeedAnnouncement) => {
    const key = backgroundKey(item);
    let pending = images.current.get(key);
    if (!pending) {
      pending = window.motusSeed
        .announcementBackground(item.id)
        .then(async (url) => {
          const decoded = new Image();
          decoded.src = url;
          await decoded.decode();
          return { url, failed: false };
        })
        .catch(() => {
          if (images.current.get(key) === pending) images.current.delete(key);
          return { url: '', failed: true };
        });
      images.current.set(key, pending);
    }
    return pending;
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    // Keep the complete current card visible until the next image is decoded.
    void loadBackground(requested).then((image) => {
      if (!active) return;
      setDisplayed({ announcement: requested, ...image });
      setLoading(false);
      setReady(true);
      if (dialog.current) dialog.current.scrollTop = 0;
    });
    return () => {
      active = false;
    };
  }, [requested.id, requested.background_url, imageAttempt, loadBackground]);

  useEffect(() => {
    if (!ready) return;
    // Retain only the visible card and its neighbours; revisiting uses decoded images.
    const neighbours = announcements.slice(Math.max(0, requestedIndex - 1), requestedIndex + 2);
    const keys = new Set([...neighbours.map(backgroundKey), backgroundKey(displayed.announcement)]);
    for (const key of images.current.keys()) {
      if (!keys.has(key)) images.current.delete(key);
    }
    for (const item of neighbours) {
      if (item.id !== requested.id) void loadBackground(item);
    }
  }, [announcements, requestedIndex, ready, displayed.announcement, loadBackground]);

  useEffect(() => {
    if (!ready) return;
    const element = dialog.current;
    if (!element) return;
    // Do not interrupt an existing approval, edit form or plugin modal.
    const show = () => {
      if (element.open) return;
      const other = [...document.querySelectorAll('dialog[open], [aria-modal="true"]')].some(
        (node) => node !== element,
      );
      if (!other) {
        element.showModal();
        element.focus({ preventScroll: true });
      }
    };
    const observer = new MutationObserver(show);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open', 'aria-modal'],
    });
    show();
    return () => {
      observer.disconnect();
      element.close();
    };
  }, [ready]);

  function navigate(direction: number) {
    if (inFlight.current || busy) return;
    const next = index + direction;
    if (next < 0 || next >= announcements.length) return;
    setSelection({ id: announcements[next]!.id, index: next });
    dialog.current?.focus({ preventScroll: true });
  }

  async function finish(action: boolean) {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setActing(true);
    setError({ id: '', message: '' });
    try {
      if (action) await window.motusSeed.activateAnnouncement(announcement.id);
      else await window.motusSeed.dismissAnnouncement(announcement.id);
    } catch {
      setError({ id: announcement.id, message: t('announcements.failed') });
    } finally {
      inFlight.current = false;
      setActing(false);
    }
  }

  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-template={announcement.template}
      className={`m-auto max-h-[calc(100dvh-104px)] max-w-none overflow-y-auto rounded-[24px] border-0 bg-[#f5f4ee] p-0 text-[#0a0a0c] shadow-2xl outline-none [container-type:inline-size] backdrop:bg-black/25 backdrop:backdrop-blur-md ${imageAbove ? 'w-[min(820px,calc(100vw-64px),calc((100dvh-104px)*1.128))]' : 'w-[min(1000px,calc(100vw-64px),calc((100dvh-104px)*1.508))]'}`}
      onCancel={(event) => {
        event.preventDefault();
        void finish(false);
      }}
      onKeyDown={(event) => {
        if (!multiple || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if ((event.target as Element).closest('input, textarea, select, [contenteditable]')) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          navigate(event.key === 'ArrowLeft' ? -1 : 1);
        }
      }}
    >
      <div
        className={`relative isolate flex flex-col overflow-hidden rounded-[inherit] ${imageAbove ? 'min-h-[88.6cqw]' : 'min-h-[66.3cqw]'}`}
      >
        {background && (
          <img
            src={background}
            alt=""
            className={`pointer-events-none absolute inset-x-0 top-0 -z-20 w-full object-cover object-center ${imageAbove ? 'h-[56cqw]' : 'h-full'}`}
          />
        )}
        <div
          className={
            imageAbove
              ? 'pointer-events-none absolute inset-x-0 top-0 -z-10 h-[56cqw] bg-[linear-gradient(180deg,transparent_55%,#f5f4ee)]'
              : 'pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(250,249,244,0.86),rgba(250,249,244,0.58)_46%,transparent_78%)]'
          }
        />
        <header
          className={`flex items-center justify-between gap-5 p-[27px] pl-8 ${imageAbove ? 'absolute inset-x-0 top-0' : ''}`}
        >
          <span className="flex items-center gap-2 text-[17px] font-medium">
            <img src={logoUrl} alt="" className="size-10" />
            MotusAI Seed
          </span>
          <button
            type="button"
            disabled={busy}
            aria-label={t('announcements.close')}
            onClick={() => void finish(false)}
            className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/65 text-[#4d514a] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </header>
        {imageAbove && <div aria-hidden="true" className="h-[44cqw] shrink-0" />}
        <section
          className={
            imageAbove
              ? 'flex flex-1 flex-col justify-center px-10 pb-4 pt-4 text-center'
              : 'mt-auto px-[65px] pb-[90px] pt-12'
          }
        >
          <h1
            id={titleId}
            className={`break-words tracking-normal ${imageAbove ? 'mx-auto max-w-[680px] text-[clamp(28px,3.9cqw,32px)] font-semibold leading-[1.3]' : 'max-w-[580px] text-[clamp(34px,4.2cqw,42px)] font-medium leading-[1.25]'}`}
          >
            {announcement.title[locale]}
          </h1>
          <p
            id={descriptionId}
            className={`whitespace-pre-line break-words text-[#717175] ${imageAbove ? 'mx-auto mt-3 max-w-[660px] text-[clamp(16px,2.1cqw,17px)] leading-[1.6]' : 'mt-4 max-w-[560px] text-[clamp(18px,2cqw,20px)] leading-[1.55]'}`}
          >
            {announcement.description[locale]}
          </p>
          <div className={`flex flex-wrap items-center gap-2 ${imageAbove ? 'mt-12 justify-center' : '-ml-[13px] mt-[42px]'}`}>
            {announcement.action && (
              <ActionButton
                type="button"
                tone="primary"
                disabled={busy}
                className="h-9! border-transparent! bg-[#202022]! px-3! text-[15px]! text-white! hover:bg-[#353537]! disabled:opacity-50!"
                onClick={() => void finish(true)}
              >
                {announcement.button_label[locale]}
              </ActionButton>
            )}
            <ActionButton
              type="button"
              disabled={busy}
              className="h-9! border-transparent! bg-[#ecebe6]! px-3! text-[15px]! text-[#262629]! hover:bg-[#e2e1dc]! disabled:opacity-50!"
              onClick={() => void finish(false)}
            >
              {announcement.dismiss_label[locale]}
            </ActionButton>
          </div>
          {imageFailed && (
            <button
              type="button"
              className="mt-3 cursor-pointer text-sm underline"
              onClick={() => setImageAttempt((value) => value + 1)}
            >
              {t('announcements.retryImage')}
            </button>
          )}
          {error.id === announcement.id && error.message && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error.message}
            </p>
          )}
        </section>
        {multiple && (
          <footer
            role="group"
            aria-label={t('announcements.navigation')}
            className="flex shrink-0 items-center justify-end gap-2 px-[27px] pb-[27px]"
          >
            <IconButton
              icon={<ChevronLeft size={18} />}
              label={t('announcements.previous')}
              showTooltip={false}
              className="h-10! w-10! rounded-full! bg-white/65! text-[#4d514a]! hover:bg-white! hover:text-[#0a0a0c]! disabled:opacity-60!"
              disabled={busy || index === 0}
              onClick={() => navigate(-1)}
            />
            <span
              role="status"
              aria-label={t('announcements.position', { current: index + 1, total: announcements.length })}
              className="flex h-10 min-w-14 items-center justify-center rounded-full bg-white/65 px-3 text-center text-sm font-medium tabular-nums text-[#4d514a]"
            >
              {index + 1} / {announcements.length}
            </span>
            <IconButton
              icon={<ChevronRight size={18} />}
              label={t('announcements.next')}
              showTooltip={false}
              className="h-10! w-10! rounded-full! bg-white/65! text-[#4d514a]! hover:bg-white! hover:text-[#0a0a0c]! disabled:opacity-60!"
              disabled={busy || index === announcements.length - 1}
              onClick={() => navigate(1)}
            />
          </footer>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
