import { useCallback, useEffect, useRef, useState } from 'react';
import { experienceTipActivitySeenSchema, type ExperienceTipActivitySeen, type ExperienceTipActivityTab, type ExperienceTipCounts } from '../../shared/experience-tips';

function readSeen(key: string): ExperienceTipActivitySeen {
  try {
    return experienceTipActivitySeenSchema.safeParse(JSON.parse(window.localStorage.getItem(key) ?? '{}')).data ?? {};
  } catch {
    return {};
  }
}

function saveSeen(key: string, seen: ExperienceTipActivitySeen) {
  try {
    window.localStorage.setItem(key, JSON.stringify(seen));
  } catch {
    // Continue tracking the current session when local storage is unavailable.
  }
}

export function useExperienceTipCounts(userId: string | undefined) {
  const [result, setResult] = useState<{ userId: string; counts: ExperienceTipCounts }>();
  const activity = useRef<{ refresh: () => void; markSeen: (tab: ExperienceTipActivityTab) => void }>(undefined);
  const refreshCounts = useCallback(() => activity.current?.refresh(), []);
  const markSeen = useCallback((tab: ExperienceTipActivityTab) => activity.current?.markSeen(tab), []);

  useEffect(() => {
    if (!userId) {
      setResult(undefined);
      return;
    }
    let active = true;
    let generation = 0;
    const storageKey = 'seed.experienceTipActivitySeen:' + userId;
    let seen = readSeen(storageKey);
    let latest: ExperienceTipCounts | undefined;
    const refresh = async () => {
      const request = ++generation;
      try {
        const counts = await window.motusSeed.readExperienceTips({ kind: 'activity-counts', ...seen });
        if (!active || request !== generation || !('my_submissions' in counts)) return;
        latest = counts;
        if (!seen.articlesSince || !seen.submissionsSince) {
          seen = {
            articlesSince: seen.articlesSince ?? counts.as_of,
            submissionsSince: seen.submissionsSince ?? counts.as_of,
          };
          saveSeen(storageKey, seen);
        }
        setResult({ userId, counts });
      } catch {
        // Keep the last counts for this account while the Cloud request is unavailable.
      }
    };
    activity.current = {
      refresh,
      markSeen(tab) {
        const cursor = tab === 'articles' ? 'articlesSince' : 'submissionsSince';
        const count = tab === 'articles' ? 'articles' : 'my_submissions';
        if (!latest || seen[cursor] === latest.as_of) return;
        seen = { ...seen, [cursor]: latest.as_of };
        saveSeen(storageKey, seen);
        latest = { ...latest, [count]: 0 };
        setResult({ userId, counts: latest });
        void refresh();
      },
    };
    const unsubscribe = window.motusSeed.subscribe((event) => {
      if (event.type === 'experience.articles.changed' || event.type === 'experience.review.changed') void refresh();
    });
    void refresh();
    return () => {
      active = false;
      activity.current = undefined;
      unsubscribe();
    };
  }, [userId]);

  return { counts: result && result.userId === userId ? result.counts : undefined, refreshCounts, markSeen };
}
