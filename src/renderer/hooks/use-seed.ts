import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@motus-ai/seed-sdk'
import type { PluginInstallProgress, SeedApi, SeedSnapshot, TerminalLogUploadProgress } from '../../shared/contracts'
import { resolveSeedLocalizedText } from '../../shared/plugin-manifest'
import { userFacingErrorMessage } from '../lib/errors'

function api(): SeedApi | null {
  return window.motusSeed || null
}

export function useSeed() {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<SeedSnapshot | null>(null)
  const snapshotVersion = useRef(0)
  const handledPluginUpdateResult = useRef('')
  const [busy, setBusy] = useState('')
  const [logUploadProgress, setLogUploadProgress] = useState<TerminalLogUploadProgress | null>(null)
  const [pluginInstallProgress, setPluginInstallProgress] = useState<Record<string, PluginInstallProgress>>({})

  useEffect(() => {
    const result = snapshot?.pluginUpdates?.result;
    if (!result || handledPluginUpdateResult.current === result.id) return;
    handledPluginUpdateResult.current = result.id;
    const id = 'seed-plugin-update-all-result';
    if (result.error) {
      toast.error(userFacingErrorMessage(result.error), { id });
      return;
    }
    const summary = t('plugins.bulkUpdateResult', {
      updated: result.updated, failed: result.failed.length, cancelled: result.cancelled,
    });
    if (result.failed.length) {
      toast.error(summary, {
        id,
        description: result.failed.map(({ name, reason }) =>
          `${resolveSeedLocalizedText(name, snapshot?.locale ?? 'en-US')}: ${userFacingErrorMessage(reason)}`,
        ).join('\n'),
      });
    } else if (result.cancelled) {
      toast.info(summary, { id });
    } else if (result.updated) {
      toast.success(t('plugins.bulkUpdateComplete', { count: result.updated }), { id });
    } else {
      toast.info(t('plugins.updateNotificationEmpty'), { id });
    }
  }, [snapshot?.pluginUpdates?.result, snapshot?.locale, t]);

  const refresh = useCallback(async () => {
    const bridge = api()
    if (!bridge) throw new Error(t('errors.appUnavailable'))
    const version = ++snapshotVersion.current
    const next = await bridge.snapshot()
    if (version === snapshotVersion.current) setSnapshot(next)
  }, [t])

  useEffect(() => {
    void refresh().catch((reason) => toast.error(userFacingErrorMessage(reason), { id: 'seed-refresh-error' }))
    return api()?.subscribe((event) => {
      if (event.type === 'snapshot.changed') {
        snapshotVersion.current++
        setSnapshot(event.snapshot)
      }
      if (event.type === 'logs.upload.progress') setLogUploadProgress(event.progress)
      if (event.type === 'plugin.install.progress') setPluginInstallProgress((current) => {
        if (event.progress) return { ...current, [event.pluginId]: event.progress }
        if (current[event.pluginId]?.operationId !== event.operationId) return current
        const next = { ...current }
        delete next[event.pluginId]
        return next
      })
    })
  }, [refresh])

  const run = useCallback(async <T,>(name: string, action: (bridge: SeedApi) => Promise<T>, successMessage?: string) => {
    setBusy(name)
    try {
      const bridge = api()
      if (!bridge) throw new Error(t('errors.appUnavailable'))
      const result = await action(bridge)
      await refresh()
      if (successMessage && result !== false) toast.success(successMessage, { id: `seed-${name}-success` })
      return result
    } catch (reason) {
      toast.error(userFacingErrorMessage(reason), { id: `seed-${name}-error` })
      return undefined
    } finally {
      setBusy('')
    }
  }, [refresh, t])

  const cancelLogUpload = useCallback(async () => {
    try {
      const bridge = api()
      if (!bridge) throw new Error(t('errors.appUnavailable'))
      return await bridge.cancelLogUpload()
    } catch (reason) {
      toast.error(userFacingErrorMessage(reason), { id: 'seed-cancel-log-upload-error' })
      return false
    }
  }, [t])

  const cancelPluginInstall = useCallback(async (pluginId: string) => {
    try {
      const bridge = api()
      if (!bridge) throw new Error(t('errors.appUnavailable'))
      return await bridge.cancelPluginInstall(pluginId)
    } catch (reason) {
      toast.error(userFacingErrorMessage(reason), { id: `seed-plugin-install-${pluginId}-cancel-error` })
      return false
    }
  }, [t])

  return { snapshot, busy, run, refresh, logUploadProgress, cancelLogUpload, pluginInstallProgress, cancelPluginInstall }
}
