import { afterEach, describe, expect, it, vi } from "vitest"
import { ServiceUnavailableException } from "@nestjs/common"
import type { PokerActionService } from "../poker-action.service"
import { PokerWaitService } from "../poker-wait.service"

function fixture() {
  const unsubscribe = vi.fn()
  const withRoom = vi.fn(async (_code: string, read: (context: unknown) => Promise<unknown>) =>
    read({
      room: { id: "room", status: "running" },
      seats: [{ id: "seat", userId: "user" }],
      tx: {
        gamePokerSeat: { update: vi.fn() },
        gameSession: { findUnique: vi.fn(async () => null) },
      },
    }),
  )
  const view = vi.fn(async () => ({ mySeatNo: 0, actionOnSeat: 1, cursor: "1:0" }))
  const service = new PokerWaitService({
    poker: { subscribe: () => unsubscribe, withRoom },
    view,
  } as unknown as PokerActionService)
  return { service, withRoom, view, unsubscribe }
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe("扑克长轮询生命周期", () => {
  afterEach(() => vi.useRealTimers())

  it("关闭服务立即结束各房间等待，不再读取或注册计时器", async () => {
    vi.useFakeTimers()
    const { service, withRoom, unsubscribe } = fixture()
    const completed = vi.fn<(value: unknown) => void>()
    const pending = ["a", "a", "b"].map((code) =>
      service.wait("user", code).then(completed, completed),
    )
    await flush()
    expect(vi.getTimerCount()).toBe(3)
    service.onModuleDestroy()
    service.onModuleDestroy()
    await flush()
    expect(completed).toHaveBeenCalledTimes(3)
    for (const [error] of completed.mock.calls)
      expect(error).toBeInstanceOf(ServiceUnavailableException)
    expect(withRoom).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    await Promise.all(pending)
  })

  it("关闭期间在途读取结束后不创建下一次等待", async () => {
    vi.useFakeTimers()
    const { service, view } = fixture()
    let release!: () => void
    view.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ mySeatNo: 0, actionOnSeat: 1, cursor: "1:0" })
        }),
    )
    const completed = vi.fn()
    const pending = service.wait("user", "a").then(completed, completed)
    await flush()
    service.onModuleDestroy()
    release()
    await flush()
    expect(completed).toHaveBeenCalledWith(expect.any(ServiceUnavailableException))
    expect(vi.getTimerCount()).toBe(0)
    await pending
  })

  it("关闭后拒绝新请求，不再访问数据库", async () => {
    const { service, withRoom } = fixture()
    service.onModuleDestroy()
    await expect(service.wait("user", "a", "", 0)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
    expect(withRoom).not.toHaveBeenCalled()
  })

  it("取消发生在最后一次读取期间也必须拒绝，不返回过期结果", async () => {
    const { service, view } = fixture(),
      controller = new AbortController()
    const reason = new Error("请求取消")
    view.mockImplementationOnce(async () => {
      controller.abort(reason)
      return { mySeatNo: 0, actionOnSeat: 1, cursor: "1:0" }
    })
    try {
      await expect(service.wait("user", "a", "", 0, controller.signal)).rejects.toBe(reason)
    } finally {
      service.onModuleDestroy()
    }
  })

  it("等待截止同时取消时拒绝并释放计时器，取消请求不占满房间限额", async () => {
    vi.useFakeTimers()
    const { service, withRoom } = fixture()
    try {
      for (let i = 0; i < 11; i++) {
        const controller = new AbortController(),
          reason = new Error("请求取消")
        const completed = vi.fn()
        const pending = service
          .wait("user", "a", "", 25000, controller.signal)
          .then(completed, completed)
        await flush()
        vi.setSystemTime(Date.now() + 25001)
        controller.abort(reason)
        await flush()
        expect(completed).toHaveBeenCalledWith(reason)
        expect(vi.getTimerCount()).toBe(0)
        await pending
      }
      expect(withRoom).toHaveBeenCalledTimes(11)
    } finally {
      service.onModuleDestroy()
    }
  })
})
