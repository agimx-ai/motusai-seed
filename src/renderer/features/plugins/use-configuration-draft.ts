import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { UpdatePluginConfigurationInput } from '../../../shared/contracts'

export type SavePluginConfiguration = (input: UpdatePluginConfigurationInput) => Promise<boolean>
type Values = Record<string, string>
type Status = 'idle' | 'pending' | 'saving' | 'error'

/** Serializes form saves and coalesces edits without replacing a newer draft with an older snapshot. */
export function useConfigurationDraft(source: Values, automatic: boolean, onSave: (values: Values) => Promise<boolean>) {
  const [values, setValues] = useState(source)
  const [status, setStatus] = useState<Status>('idle')
  const draft = useRef(source)
  const pending = useRef<Values | null>(null)
  const inFlight = useRef(false)
  const failed = useRef(false)
  const composing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const due = useRef(0)
  const mounted = useRef(true)
  const latest = useRef({ source, automatic, onSave })
  const sourceRevision = JSON.stringify(source)
  const appliedRevision = useRef(sourceRevision)
  const flushRef = useRef<() => Promise<void>>(async () => undefined)

  const updateStatus = (next: Status) => { if (mounted.current) setStatus(next) }
  const apply = (next: Values) => { draft.current = next; if (mounted.current) setValues(next) }
  const clearTimer = () => { clearTimeout(timer.current); timer.current = undefined }
  const schedule = () => {
    clearTimer()
    if (!pending.current || inFlight.current || composing.current || failed.current) return
    if (!mounted.current || due.current <= Date.now()) { void flushRef.current(); return }
    timer.current = setTimeout(() => void flushRef.current(), due.current - Date.now())
  }

  flushRef.current = async () => {
    clearTimer()
    if (!latest.current.automatic || inFlight.current || composing.current || !pending.current) return
    const submitted = pending.current
    const previousSource = appliedRevision.current
    pending.current = null
    failed.current = false
    inFlight.current = true
    updateStatus('saving')
    let succeeded = false
    try { succeeded = await latest.current.onSave(submitted) === true } catch { /* Keep the draft for an explicit retry. */ }
    inFlight.current = false
    if (!succeeded) {
      failed.current = true
      pending.current ??= submitted
      clearTimer()
      updateStatus('error')
      return
    }
    if (pending.current) {
      updateStatus('pending')
      schedule()
    } else {
      if (appliedRevision.current !== previousSource) apply(latest.current.source)
      updateStatus('idle')
    }
  }

  useLayoutEffect(() => {
    latest.current = { source, automatic, onSave }
    if (sourceRevision === appliedRevision.current) return
    appliedRevision.current = sourceRevision
    if (!automatic || (!inFlight.current && !pending.current)) apply(source)
  }, [sourceRevision, automatic, onSave])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      composing.current = false
      clearTimer()
      // Finish the user's last edit on navigation; no timer or UI update survives the form.
      if (pending.current && !inFlight.current && !failed.current) void flushRef.current()
    }
  }, [])

  return {
    values, status,
    update(next: Values) {
      if (JSON.stringify(next) === JSON.stringify(draft.current)) return
      apply(next)
      if (!automatic) return
      pending.current = next
      failed.current = false
      due.current = Date.now() + 300
      updateStatus(inFlight.current ? 'saving' : 'pending')
      schedule()
    },
    flush() { due.current = 0; return flushRef.current() },
    composition(active: boolean) {
      composing.current = active
      clearTimer()
      if (!active) { due.current = Date.now() + 300; schedule() }
    },
  }
}
