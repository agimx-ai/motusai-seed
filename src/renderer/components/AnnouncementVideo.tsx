import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, RotateCcw } from 'lucide-react';
import { useReducedMotion } from '../hooks/use-reduced-motion';

export const announcementMediaControlClass =
  'inline-grid size-10 shrink-0 place-items-center rounded-full border-0 bg-card/65 p-0 text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-50';

/** Original audio, click-to-play, and one playback that holds its final frame. */
export function AnnouncementVideo({
  src,
  className,
  poster,
  active = true,
}: {
  src: string;
  className: string;
  poster?: string | undefined;
  active?: boolean;
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [playRequest, setPlayRequest] = useState(0);
  const [visible, setVisible] = useState(!document.hidden);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (reducedMotion) setPaused(true);
  }, [reducedMotion]);
  useEffect(() => {
    const visibility = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let current = true;
    if (active && visible && !paused && !failed && !ended) {
      void element.play().catch(() => {
        if (current) setPlaying(false);
      });
    } else element.pause();
    return () => {
      current = false;
      element.pause();
    };
  }, [active, visible, paused, failed, ended, attempt, playRequest]);
  const label = t(
    failed
      ? 'announcements.retryVideo'
      : ended
        ? 'announcements.replayVideo'
        : playing
          ? 'announcements.pauseVideo'
          : 'announcements.playVideo',
  );
  return (
    <>
      <video
        ref={video}
        key={attempt}
        src={src}
        poster={poster}
        muted={false}
        playsInline
        preload="none"
        aria-label={t('announcements.videoLabel')}
        className={className}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setEnded(true);
          setPlaying(false);
        }}
        onError={() => {
          setFailed(true);
          setPlaying(false);
        }}
      />
      <button
        type="button"
        aria-label={label}
        className="absolute inset-0 z-0 grid cursor-pointer place-items-center rounded-[inherit] border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-foreground/35"
        onClick={() => {
          if (failed) {
            setFailed(false);
            setEnded(false);
            setPaused(false);
            setAttempt((value) => value + 1);
          } else if (playing) setPaused(true);
          else {
            if (ended) {
              if (video.current) video.current.currentTime = 0;
              setEnded(false);
            }
            setPaused(false);
            setPlayRequest((value) => value + 1);
          }
        }}
      >
        {!playing && (
          <span className={`${announcementMediaControlClass} size-14!`} aria-hidden="true">
            {failed || ended ? <RotateCcw size={26} /> : <Play size={26} />}
          </span>
        )}
      </button>
    </>
  );
}
