import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import type { ClientReleaseNotes } from '../../shared/contracts'

export function useClientReleaseNotes(ready: boolean) {
  const { t } = useTranslation()
  const [notes, setNotes] = useState<ClientReleaseNotes>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!ready) return
    let disposed = false
    void window.motusSeed.clientReleaseNotes().then((value) => {
      if (disposed) return
      setNotes(value.unread ? value : undefined)
    }).catch(() => {
      if (!disposed) toast.error(t('releaseNotes.loadFailed'), { id: 'client-release-notes' })
    })
    return () => { disposed = true }
  }, [ready, t])

  const close = useCallback(async () => {
    if (!notes || busy) return
    setBusy(true)
    try {
      await window.motusSeed.acknowledgeClientReleaseNotes(notes.version)
      setNotes(undefined)
    } catch {
      toast.error(t('releaseNotes.saveFailed'), { id: 'client-release-notes' })
    } finally { setBusy(false) }
  }, [notes, busy, t])
  return { notes, busy, close }
}
