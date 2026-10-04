import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { SeedCatalogPlugin } from '../../../shared/contracts'
import { resolveSeedLocalizedText } from '../../../shared/plugin-manifest'
import { ActionButton } from '../../components/ActionButton'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { SettingsRow } from '../../components/SettingsControls'
import { useSeedI18n } from '../../i18n'

export function PluginDataResetSetting({ catalog, disabled, onList, onReset }: {
  catalog: SeedCatalogPlugin[]
  disabled: boolean
  onList: () => Promise<string[] | undefined>
  onReset: (ids: string[]) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  const [pending, setPending] = useState<string[]>()
  const [scanning, setScanning] = useState(false)
  const [resetting, setResetting] = useState(false)
  const scan = async () => {
    setScanning(true)
    try {
      const ids = await onList()
      if (!ids) return
      if (!ids.length) toast.info(t('settings.noOrphanedPluginData'), { id: 'seed-plugin-data-empty' })
      else setPending(ids)
    } finally { setScanning(false) }
  }
  const reset = async () => {
    if (!pending || resetting) return
    setResetting(true)
    try {
      if (await onReset(pending)) setPending(undefined)
    } finally { setResetting(false) }
  }
  return <>
    <SettingsRow
      title={t('settings.cleanPluginData')}
      description={t('settings.cleanPluginDataDescription')}
      action={<ActionButton disabled={disabled || resetting} busy={scanning} onClick={() => void scan()}>{t('settings.cleanPluginDataAction')}</ActionButton>}
    />
    <ConfirmDialog
      open={Boolean(pending)}
      icon={<span className="grid h-8 w-8 place-items-center rounded-[10px] bg-danger-soft text-danger"><Trash2 size={17} /></span>}
      title={t('settings.cleanPluginDataConfirmTitle')}
      confirmLabel={t('settings.cleanPluginDataConfirmAction')}
      cancelLabel={t('common.cancel')}
      tone="danger"
      busy={resetting}
      confirmDisabled={disabled && !resetting}
      onCancel={() => setPending(undefined)}
      onConfirm={() => void reset()}
    >
      <ul className="m-0 max-h-40 list-none space-y-1 overflow-auto p-0">
        {pending?.map((id) => {
          const plugin = catalog.find((item) => item.id === id)
          return <li className="break-all" key={id}>{plugin ? resolveSeedLocalizedText(plugin.name, locale) : id}</li>
        })}
      </ul>
    </ConfirmDialog>
  </>
}
