import { useEffect, useRef, useState } from 'react';
import { mountPluginDom } from './plugin-dom-host';

/** A normal document child: the browser owns its height, clipping and scrolling. */
export function PluginViewSurface({ pluginId, revision }: { pluginId: string; revision?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!ref.current) return;
    setError('');
    return mountPluginDom(pluginId, ref.current, (cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [pluginId, revision]);
  return (
    <div ref={ref} data-plugin-view-surface className="min-w-0 shrink-0">
      {error && (
        <p role="alert" className="text-[13px] text-muted-foreground">
          {error}
        </p>
      )}
    </div>
  );
}
