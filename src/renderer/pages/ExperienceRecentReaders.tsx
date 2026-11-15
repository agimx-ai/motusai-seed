import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { prefersReducedMotion } from '@motus-ai/seed-sdk';
import type { ExperienceTipArticle } from '../../shared/experience-tips';
import { UserAvatar } from '../components/UserAvatar';
import { useSeedI18n } from '../i18n';

type Reader = NonNullable<ExperienceTipArticle['recent_readers']>[number];

// Adapted from https://ui.aceternity.com/components/animated-tooltip
function ReaderAvatar({ reader }: { reader: Reader }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const reducedMotion = prefersReducedMotion();
  const offsetX = useMotionValue(0);
  const rotate = useSpring(useTransform(offsetX, [-1, 1], [-12, 12]), { stiffness: 100, damping: 15 });
  const translateX = useSpring(useTransform(offsetX, [-1, 1], [-8, 8]), { stiffness: 100, damping: 15 });

  function followPointer(event: PointerEvent<HTMLSpanElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!reducedMotion && bounds.width > 0) {
      offsetX.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1);
    }
  }

  return (
    <span
      className="experience-reader"
      role="img"
      aria-label={reader.name}
      tabIndex={0}
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return;
        setDismissed(false);
        setHovered(true);
      }}
      onPointerMove={followPointer}
      onPointerLeave={() => { setHovered(false); offsetX.set(0); }}
      onFocus={() => { setDismissed(false); setFocused(true); }}
      onBlur={() => setFocused(false)}
      onKeyDown={(event) => { if (event.key === 'Escape') setDismissed(true); }}
    >
      <UserAvatar name={reader.name} imageUrl={reader.avatar_url} className="experience-reader-avatar" />
      <AnimatePresence>
        {(hovered || focused) && !dismissed && (
          <span className="experience-reader-tooltip" aria-hidden="true">
            <motion.span
              className="experience-reader-tooltip-label"
              initial={reducedMotion ? false : { opacity: 0, y: 12, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: 8, scale: 0.85 }}
              transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 15 }}
              style={reducedMotion ? undefined : { rotate, x: translateX }}
            >
              {reader.name}
            </motion.span>
          </span>
        )}
      </AnimatePresence>
    </span>
  );
}

export function ExperienceRecentReaders({ readers, viewCount }: { readers: Reader[]; viewCount: number }) {
  const { t } = useTranslation();
  const { locale } = useSeedI18n();
  const avatars = readers.filter((reader) => reader.avatar_url);
  const remaining = Math.max(0, viewCount - avatars.length);
  const count = `+${new Intl.NumberFormat(locale, { useGrouping: false }).format(remaining)}`;
  const label = t('experienceTips.otherViews', { count: remaining });
  const badgeRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const badge = badgeRef.current;
    const number = countRef.current;
    if (!badge || !number) return;

    const fit = () => {
      const availableWidth = badge.clientWidth - 2;
      const width = number.offsetWidth;
      const scale = availableWidth > 0 && width > 0 ? Math.min(1, availableWidth / width) : 1;
      number.style.scale = `${scale} 1`;
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    observer.observe(badge);
    observer.observe(number);
    return () => observer.disconnect();
  }, [count]);

  return (
    <div className="experience-reader-stack" role="group" aria-label={t('experienceTips.recentReaders')}>
      {avatars.map((reader, index) => <ReaderAvatar key={index} reader={reader} />)}
      <span ref={badgeRef} className="experience-reader-avatar experience-reader-more" title={label}>
        <span ref={countRef} className="experience-reader-count" aria-hidden="true">{count}</span>
        <span className="sr-only">{label}</span>
      </span>
    </div>
  );
}
