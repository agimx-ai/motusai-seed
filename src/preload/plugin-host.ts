import { contextBridge, ipcRenderer } from 'electron'

const channelSuffix = process.argv.find((value) => value.startsWith('--seed-plugin-channel-suffix='))?.slice('--seed-plugin-channel-suffix='.length) || ''
const channels = {
  ready: `seed-plugin-host:ready${channelSuffix}`,
  configure: `seed-plugin-host:configure${channelSuffix}`,
  configured: `seed-plugin-host:configured${channelSuffix}`,
  invoke: `seed-plugin-host:invoke${channelSuffix}`,
  result: `seed-plugin-host:result${channelSuffix}`,
  broker: `seed-plugin-host:broker${channelSuffix}`,
} as const

contextBridge.exposeInMainWorld('seedPluginRuntime', {
  ready: () => ipcRenderer.send(channels.ready),
  configured: (configuration_id: string, ok: boolean, error?: string) => {
    ipcRenderer.send(channels.configured, { configuration_id, ok, error })
  },
  result: (request_id: string, ok: boolean, result?: unknown, error?: string, error_code?: string, error_params?: Record<string, string | number | boolean>) => {
    ipcRenderer.send(channels.result, { request_id, ok, result, error, error_code, error_params })
  },
  invokeBroker: (broker_token: string, service: string, arguments_value: Record<string, unknown>) => (
    ipcRenderer.invoke(channels.broker, { broker_token, service, arguments: arguments_value })
  ),
  onConfigure: (listener: (message: unknown) => void) => {
    ipcRenderer.on(channels.configure, (_event, message) => listener(message))
  },
  onInvoke: (listener: (message: unknown) => void) => {
    ipcRenderer.on(channels.invoke, (_event, message) => listener(message))
  },
})
