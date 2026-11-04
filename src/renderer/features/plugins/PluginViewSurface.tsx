import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mountPluginDom } from './plugin-dom-host';
import type { PluginHeaderNavigation } from './plugin-navigation';
import type { PluginPageTarget } from './plugin-sidebar';

/** A normal document child: the browser owns its height, clipping and scrolling. */
export function PluginViewSurface({ pluginId, revision, target, onNavigationChange }: {
  pluginId: string;
  revision?: string;
  target?: PluginPageTarget;
  onNavigationChange?: (navigation: PluginHeaderNavigation | undefined) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!ref.current) return;
    return mountPluginDom(
      pluginId,
      ref.current,
      (cause) => setError(cause instanceof Error ? cause.message : String(cause)),
      (value) => {
        setLoading(value);
        if (value) setError('');
      },
      onNavigationChange,
      target,
    );
  }, [pluginId, revision, target, onNavigationChange]);
  return (
    <div data-plugin-view-surface aria-busy={loading} className="flex min-h-full min-w-0 flex-col">
      {loading && (
        <div role="status" className="flex items-center justify-center gap-2 py-8 text-[13px] text-muted-foreground">
          <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" />
          {t('plugins.loadingView')}
        </div>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-muted-foreground">
          {error}
        </p>
      )}
      <div ref={ref} className="flex flex-1 flex-col" />
    </div>
  );
}
