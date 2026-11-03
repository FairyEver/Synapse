import { describe, expect, it, vi } from "vitest"
import { runPokerCardE2e } from "./run-poker-card-e2e.mjs"

describe("卡牌隔离测试入口", () => {
  it.each([undefined, "", "postgresql://user:secret@remote.example/test_e2e", "postgresql://localhost/synapse", "https://localhost/test_e2e"])("非法配置在任何子进程前拒绝：%s", value => {
    const spawn = vi.fn()
    expect(() => runPokerCardE2e({ GAME_E2E_DATABASE_URL: value, DATABASE_URL: "postgresql://business/prod" }, spawn)).toThrow(/GAME_E2E_DATABASE_URL/)
    expect(spawn).not.toHaveBeenCalled()
  })
  it("仅把已验证地址放入子进程env，失败即停，不拼shell", () => {
    const url = "postgresql://localhost/card_e2e", spawn = vi.fn().mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 2 })
    expect(runPokerCardE2e({ GAME_E2E_DATABASE_URL: url }, spawn)).toBe(2)
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(spawn.mock.calls[0]).toMatchObject(["pnpm", ["--filter", "@synapse/shared", "run", "build"], { env: { DATABASE_URL: url }, stdio: "inherit" }])
    expect(spawn.mock.calls.every(call => !call[2].shell)).toBe(true)
  })
  it("只运行指定真实PG测试", () => {
    const spawn = vi.fn().mockReturnValue({ status: 0 })
    expect(runPokerCardE2e({ GAME_E2E_DATABASE_URL: "postgresql://127.0.0.1/card_e2e" }, spawn)).toBe(0)
    expect(spawn.mock.calls.at(-1)?.[1]).toEqual(["exec", "vitest", "run", "--config", "vitest.e2e.config.ts", "test/poker-card.e2e.spec.ts"])
  })
})
