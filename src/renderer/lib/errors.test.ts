import { describe, expect, it } from 'vitest'
import { userFacingErrorMessage } from './errors'

describe('userFacingErrorMessage', () => {
  it('removes Electron remote invocation details', () => {
    expect(userFacingErrorMessage(new Error("Error invoking remote method 'seed:plugins:update-configuration': Error: deepseek-v4-flash 的 API Key 无效或没有访问权限。")))
      .toBe('deepseek-v4-flash 的 API Key 无效或没有访问权限。')
  })

  it('keeps an already readable error unchanged', () => {
    expect(userFacingErrorMessage(new Error('网络连接失败。'))).toBe('网络连接失败。')
  })
})
