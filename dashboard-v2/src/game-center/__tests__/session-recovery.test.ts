/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const api = vi.hoisted(() => ({ getSession: vi.fn(), getMe: vi.fn() }))
const event = vi.hoisted(() => ({ changed: () => {} }))
vi.mock("@/lib/api", () => ({ dashboardApi: api }))
vi.mock("@/lib/user-session-events", () => ({ subscribeUserSessionChange: (callback: () => void) => { event.changed = callback; return () => {} } }))
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); api.getSession.mockReset(); api.getMe.mockReset() })
afterEach(() => vi.useRealTimers())

describe("浏览器账号请求恢复", () => {
  it("初次会话请求永不完成时30秒结束等待，下一次可重新登录验证", async () => {
    api.getSession.mockImplementation(() => new Promise(() => {}))
    const account = await import("../runtime/account")
    let finished = false
    void account.revalidateGameSession().then(() => { finished = true })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(finished).toBe(true)
    api.getSession.mockResolvedValue({ userId: "alice" })
    api.getMe.mockResolvedValue({ user: { id: "alice" } })
    await account.revalidateGameSession()
    expect(account.getGameIdentity()).toBe("alice")
  })
  it("切账号会中止挂起的旧验证，不等待它完成便开始读取新账号", async () => {
    api.getSession.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue({ userId: "bob" })
    api.getMe.mockResolvedValue({ user: { id: "bob" } })
    const account = await import("../runtime/account")
    const dispose = account.installGameSessionListeners()
    void account.revalidateGameSession()
    event.changed()
    await vi.advanceTimersByTimeAsync(1)
    expect(api.getSession).toHaveBeenCalledTimes(2)
    expect(account.getGameIdentity()).toBe("bob")
    dispose()
  })
})
