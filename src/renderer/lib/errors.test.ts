import { describe, expect, it } from 'vitest'
import { userFacingErrorMessage } from './errors'

describe('userFacingErrorMessage', () => {
  it('removes Electron remote invocation details', () => {
    expect(userFacingErrorMessage(new Error("Error invoking remote method 'seed:plugins:update-configuration': Error: deepseek-v4-flash 的 API Key 无效或没有访问权限。")))
      .toBe('deepseek-v4-flash 的 API Key 无效或没有访问权限')
  })

  it.each([
    ['网络连接失败。', '网络连接失败'],
    ['原生插件调用已取消。', '原生插件调用已取消'],
    ['插件下载失败（503）。', '插件下载失败（503）'],
    ['Request failed.', 'Request failed'],
    ['网络连接失败', '网络连接失败'],
  ])('formats short feedback: %s', (input, expected) => {
    expect(userFacingErrorMessage(new Error(input))).toBe(expected)
  })

  it.each([
    '确定要清空活动记录吗？此操作无法撤销。',
    '是否重试？',
    'Retry?',
    '插件已停止。请重新启用后重试。',
    'The plugin stopped. Please try again.',
    '连接失败。\n请检查网络。',
    '请检查网络设置并确认当前服务可用，'.repeat(8) + '然后重试。',
  ])('preserves questions and explanations: %s', (message) => {
    expect(userFacingErrorMessage(message)).toBe(message)
  })

  it('uses a fallback without punctuation for empty errors', () => {
    expect(userFacingErrorMessage('')).toBe('操作失败')
  })

  it('does not mutate the original error used for diagnostics', () => {
    const error = new Error('网络连接失败。')
    userFacingErrorMessage(error)
    expect(error.message).toBe('网络连接失败。')
  })
})
