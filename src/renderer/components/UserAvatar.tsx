import { useEffect, useState } from 'react';
import { initials } from '../lib/display';

const RETRY_DELAYS = [2_000, 5_000, 10_000, 20_000, 40_000, 60_000];

function AvatarImage({ imageUrl, name }: { imageUrl: string; name: string }) {
  const [attempt, setAttempt] = useState(0);
  const [generation, setGeneration] = useState(0);
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!failed || retrying || attempt >= RETRY_DELAYS.length) return;
    const timer = window.setTimeout(() => {
      setRetrying(true);
      setAttempt((current) => current + 1);
      setGeneration((current) => current + 1);
    }, RETRY_DELAYS[attempt]);
    return () => window.clearTimeout(timer);
  }, [attempt, failed, retrying]);

  useEffect(() => {
    if (!failed || retrying) return;
    const retryOnOnline = () => {
      setRetrying(true);
      setGeneration((current) => current + 1);
    };
    window.addEventListener('online', retryOnOnline);
    return () => window.removeEventListener('online', retryOnOnline);
  }, [failed, retrying]);

  return <>
    {failed && initials(name)}
    <img
      key={generation}
      className={failed ? 'hidden' : 'h-full w-full object-cover'}
      src={imageUrl}
      alt=""
      onError={() => { setFailed(true); setRetrying(false); }}
      onLoad={() => { setFailed(false); setRetrying(false); setAttempt(0); }}
    />
  </>;
}

export function UserAvatar({ name, imageUrl, className }: { name: string; imageUrl?: string; className: string }) {
  return <span className={className} aria-hidden="true">
    {imageUrl ? <AvatarImage key={imageUrl} imageUrl={imageUrl} name={name} /> : initials(name)}
  </span>;
}
