import type { PluginInstallProgress } from '../../../shared/contracts'
import { PluginActionButton } from './PluginActionButton'

const detailActions = ['install', 'update', 'uninstall'] as const

type Props = {
  installed: boolean
  updateAvailable: boolean
  installable: boolean
  progress?: PluginInstallProgress
  installing: boolean
  uninstalling: boolean
  updatesBusy: boolean
  onInstall: () => void
  onUpdate: () => void
  onUninstall: () => void
  onCancel: () => void
}

export function PluginDetailActions({ installed, updateAvailable, installable, progress, installing, uninstalling, updatesBusy, onInstall, onUpdate, onUninstall, onCancel }: Props) {
  const active = installing || Boolean(progress)
  const action = installed ? active || updateAvailable ? 'update' : 'uninstall' : 'install'

  return <div className="seed-plugin-detail-actions flex items-center gap-2">
    {installed && updateAvailable && !active && <PluginActionButton
      key="secondary-uninstall"
      action="uninstall"
      busy={uninstalling}
      disabled={updatesBusy}
      onStart={onUninstall}
    />}
    {/* Keep the primary button mounted and right-anchored as the installed
        snapshot arrives, through completion, and into the next idle action. */}
    <PluginActionButton
      key="primary"
      action={action}
      reserveActions={detailActions}
      progress={progress}
      busy={active ? installing : action === 'uninstall' && uninstalling}
      disabled={!active && (updatesBusy || (action !== 'uninstall' && uninstalling) || (!installed && !installable))}
      onStart={action === 'install' ? onInstall : action === 'update' ? onUpdate : onUninstall}
      onCancel={onCancel}
    />
  </div>
}
