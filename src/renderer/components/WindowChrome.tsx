import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WindowDragRegion } from './AppBrand'
import { Tooltip } from './Tooltip'

export function WindowChrome() {
  const { t } = useTranslation()
  const isWindows = window.motusWindow.platform === 'win32'
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!isWindows) return
    void window.motusWindow.isMaximized().then(setMaximized)
    return window.motusWindow.subscribeMaximized(setMaximized)
  }, [isWindows])

  if (!isWindows) return <WindowDragRegion />

  const toggleMaximize = () => {
    void window.motusWindow.toggleMaximize().then(setMaximized)
  }

  return <div className={`seed-window-chrome${maximized ? ' is-maximized' : ''}`} aria-label={t('window.titleBar')}>
    <div className="seed-window-controls">
      <Tooltip content={t('window.minimize')} placement="bottom">
        <button className="seed-window-control seed-window-control--minimize" type="button" onClick={() => void window.motusWindow.minimize()} aria-label={t('window.minimize')}>
          <span aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip content={t(maximized ? 'window.restore' : 'window.maximize')} placement="bottom">
        <button className="seed-window-control seed-window-control--maximize" type="button" onClick={toggleMaximize} aria-label={t(maximized ? 'window.restore' : 'window.maximize')}>
          <span className={maximized ? 'is-restore' : ''} aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip content={t('window.close')} placement="bottom">
        <button className="seed-window-control seed-window-control--close" type="button" onClick={() => void window.motusWindow.close()} aria-label={t('window.close')}>
          <span aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  </div>
}
