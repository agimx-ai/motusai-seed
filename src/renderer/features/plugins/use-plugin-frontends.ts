import { useEffect, useRef } from 'react';
import { toast } from '@motus-ai/seed-sdk';
import type { SeedSnapshot } from '../../../shared/contracts';
import { userFacingErrorMessage } from '../../lib/errors';
import { retainPluginDom } from './plugin-dom-host';

/** The same frontend instance owns navigation registrations and visible pages. */
export function usePluginFrontends(snapshot: SeedSnapshot | null | undefined) {
  const retained = useRef(new Map<string, { identity: string; release(): void }>());
  const account = snapshot?.startup.status === 'ready' ? snapshot.user?.id : undefined;
  const plugins = snapshot?.plugins;
  useEffect(() => {
    const current = retained.current;
    const enabled = new Map(
      (account ? (plugins ?? []) : [])
        .filter((plugin) => plugin.enabled && plugin.status === 'ready' && plugin.publisherType === 'official')
        .map((plugin) => [plugin.id, JSON.stringify([account, plugin.version, plugin.source, plugin.manifestDigest])]),
    );
    for (const [id, owner] of current)
      if (enabled.get(id) !== owner.identity) {
        owner.release();
        current.delete(id);
      }
    for (const [id, identity] of enabled)
      if (!current.has(id))
        current.set(id, {
          identity,
          release: retainPluginDom(id, (error) =>
            toast.error(userFacingErrorMessage(error), { id: 'plugin-frontend-' + id }),
          ),
        });
  }, [account, plugins]);
  useEffect(
    () => () => {
      for (const owner of retained.current.values()) owner.release();
      retained.current.clear();
    },
    [],
  );
}
