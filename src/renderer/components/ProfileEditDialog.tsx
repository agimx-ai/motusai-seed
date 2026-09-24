import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Pencil } from 'lucide-react'
import type { TerminalUserProfile } from '../../shared/contracts'
import { userFacingErrorMessage } from '../lib/errors'
import { ActionButton } from './ActionButton'
import { UserAvatar } from './UserAvatar'

type Props = {
  user: TerminalUserProfile
  onClose: () => void
}

export function ProfileEditDialog({ user, onClose }: Props) {
  const { t } = useTranslation()
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const [displayName, setDisplayName] = useState(user.displayName)
  const [username, setUsername] = useState(user.username || '')
  const [busy, setBusy] = useState(false)
  const [processingAvatar, setProcessingAvatar] = useState(false)
  const [pendingAvatarDataUrl, setPendingAvatarDataUrl] = useState<string>()
  const [error, setError] = useState('')
  const unchanged = displayName.trim() === user.displayName && username.trim() === user.username && !pendingAvatarDataUrl
  busyRef.current = busy

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLInputElement>('#profile-display-name')?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
        onClose()
      }
      if (event.key !== 'Tab') return
      const controls = [...(panelRef.current?.querySelectorAll<HTMLElement>('input:not([type="file"]):not(:disabled), button:not(:disabled)') || [])]
      if (!controls.length) return
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault()
        controls.at(-1)?.focus()
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault()
        controls[0]?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [onClose])

  async function chooseAvatar(file: File | undefined) {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setError(t('profile.avatarInvalid'))
    if (file.size > 10 * 1024 * 1024) return setError(t('profile.avatarTooLarge'))
    setProcessingAvatar(true)
    setError('')
    try {
      const image = await createImageBitmap(file)
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 256
        canvas.height = 256
        const context = canvas.getContext('2d')
        if (!context) throw new Error(t('profile.avatarInvalid'))
        const side = Math.min(image.width, image.height)
        context.fillStyle = '#fff'
        context.fillRect(0, 0, 256, 256)
        context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 256, 256)
        const dataUrl = canvas.toDataURL('image/webp', 0.85)
        if (!dataUrl.startsWith('data:image/webp;base64,') || dataUrl.length > 512_000) throw new Error(t('profile.avatarInvalid'))
        setPendingAvatarDataUrl(dataUrl)
      } finally {
        image.close()
      }
    } catch {
      setError(t('profile.avatarInvalid'))
    } finally {
      setProcessingAvatar(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = displayName.trim()
    const handle = username.trim()
    if (!name || name.length > 120) return setError(t('profile.displayNameInvalid'))
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,79}$/.test(handle)) return setError(t('profile.usernameInvalid'))
    setBusy(true)
    setError('')
    try {
      await window.motusSeed.updateProfile({ displayName: name, username: handle, ...(pendingAvatarDataUrl ? { avatarDataUrl: pendingAvatarDataUrl } : {}) })
      onClose()
      toast.success(t('profile.saved'))
    } catch (reason) {
      setError(userFacingErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(<div
    className="fixed inset-0 z-[100] grid place-items-center bg-black/30 px-6 backdrop-blur-[2px]"
    onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}
  >
    <div ref={panelRef} className="w-full max-w-[460px] rounded-[18px] border border-border bg-card p-6 text-foreground shadow-[0_18px_55px_rgba(0,0,0,.18)]" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <h2 id={titleId} className="m-0 text-[18px] font-medium">{t('profile.edit')}</h2>
      <input ref={avatarInputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" tabIndex={-1} onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        void chooseAvatar(file)
      }} />
      <button className="group relative mx-auto mt-6 block size-20 overflow-hidden rounded-full bg-muted p-0 text-[24px] text-foreground" type="button" disabled={busy || processingAvatar} aria-label={t('profile.changeAvatar')} onClick={() => avatarInputRef.current?.click()}>
        <UserAvatar className="grid size-full place-items-center" imageUrl={pendingAvatarDataUrl || user.avatarDataUrl} name={displayName} />
        <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true">
          <Pencil size={20} />
        </span>
      </button>
      <form className="mt-6" onSubmit={(event) => void save(event)}>
        <label className="block text-[13px] font-medium" htmlFor="profile-display-name">{t('profile.displayName')}</label>
        <input id="profile-display-name" className="seed-text-input mt-2 w-full" value={displayName} maxLength={120} disabled={busy} onChange={(event) => setDisplayName(event.target.value)} />
        <label className="mt-5 block text-[13px] font-medium" htmlFor="profile-username">{t('profile.username')}</label>
        <div className="seed-text-input mt-2 w-full">
          <span aria-hidden="true">@</span>
          <input id="profile-username" value={username} maxLength={80} disabled={busy} onChange={(event) => setUsername(event.target.value)} />
        </div>
        <p className="mb-0 mt-2 text-[11px] text-muted-foreground">{t('profile.usernameHint')}</p>
        {error && <p className="mb-0 mt-3 text-[12px] text-danger" role="alert">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <ActionButton type="button" disabled={busy} onClick={onClose}>{t('common.cancel')}</ActionButton>
          <ActionButton type="submit" tone="primary" busy={busy || processingAvatar} disabled={unchanged}>{t('profile.save')}</ActionButton>
        </div>
      </form>
    </div>
  </div>, document.body)
}
