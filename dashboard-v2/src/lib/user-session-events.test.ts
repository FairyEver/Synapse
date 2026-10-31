/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { broadcastUserSessionChange, subscribeUserSessionChange } from './user-session-events'
afterEach(() => vi.unstubAllGlobals())
describe('跨标签会话通知兼容', () => {
  it('浏览器拒绝BroadcastChannel时不阻断登录，并使用storage通知', () => {
    vi.stubGlobal('BroadcastChannel', class { constructor() { throw new DOMException('blocked', 'SecurityError') } })
    const write = vi.spyOn(Storage.prototype, 'setItem')
    expect(() => broadcastUserSessionChange()).not.toThrow()
    expect(write).toHaveBeenCalledWith('synapse.user-session.changed', expect.any(String))
    write.mockRestore()
  })
  it('无BroadcastChannel仍监听并清理storage事件', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const listener = vi.fn(), stop = subscribeUserSessionChange(listener)
    window.dispatchEvent(new StorageEvent('storage', { key:'synapse.user-session.changed' }))
    expect(listener).toHaveBeenCalledOnce()
    stop()
    window.dispatchEvent(new StorageEvent('storage', { key:'synapse.user-session.changed' }))
    expect(listener).toHaveBeenCalledOnce()
  })
})
