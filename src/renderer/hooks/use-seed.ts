import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { PluginInstallProgress, SeedApi, SeedSnapshot, TerminalLogUploadProgress } from '../../shared/contracts'
import { userFacingErrorMessage } from '../lib/errors'

function api(): SeedApi | null {
  return window.motusSeed || null
}

export function useSeed() {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<SeedSnapshot | null>(null)
  const [busy, setBusy] = useState('')
  const [logUploadProgress, setLogUploadProgress] = useState<TerminalLogUploadProgress | null>(null)
  const [pluginInstallProgress, setPluginInstallProgress] = useState<Record<string, PluginInstallProgress>>({})

  const refresh = useCallback(async () => {
    const bridge = api()
    if (!bridge) throw new Error(t('errors.appUnavailable'))
    setSnapshot(await bridge.snapshot())
  }, [t])

  useEffect(() => {
    void refresh().catch((reason) => toast.error(userFacingErrorMessage(reason), { id: 'seed-refresh-error' }))
    return api()?.subscribe((event) => {
      if (event.type === 'snapshot.changed') setSnapshot(event.snapshot)
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
