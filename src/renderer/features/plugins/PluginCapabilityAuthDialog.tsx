import { useTranslation } from 'react-i18next'
import type { PluginCapabilityApprovalRequest } from '../../../shared/contracts'
import { ConfirmDialog } from '../../components/ConfirmDialog'

type PluginCapabilityAuthDialogProps = {
  request?: PluginCapabilityApprovalRequest
  consumerName: string
  providerName: string
  busy?: boolean
  onRespond: (allowed: boolean) => void
}

export function PluginCapabilityAuthDialog({ request, consumerName, providerName, busy = false, onRespond }: PluginCapabilityAuthDialogProps) {
  const { t } = useTranslation()
  return <ConfirmDialog
    open={Boolean(request)}
    title={t('plugins.capabilityAuthTitle', { consumer: consumerName })}
    description={t('plugins.capabilityAuthDescription', {
      provider: providerName,
      method: request?.method,
    })}
    confirmLabel={t('plugins.allowOnce')}
    cancelLabel={t('common.cancel')}
    busy={busy}
    onConfirm={() => onRespond(true)}
    onCancel={() => onRespond(false)}
  />
}
