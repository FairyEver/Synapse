import { describe, expect, it } from "vitest"
import { assertController, changeControl, claimControl } from "../poker-control"

const seat = () => ({ controller: "ai", controlVersion: 0, handoffPending: false, pauseReason: null, sitPending: false, checkpoint: null })
describe("座位控制版本", () => {
  it("初始AI允许旧MCP，接管后旧AI的所有座位写入均被拒绝", () => {
    const original = seat()
    expect(() => assertController(original, "mcp")).not.toThrow()
    const human = { ...original, ...changeControl(original, "takeover", 0) }
    expect(human).toMatchObject({ controller: "human", controlVersion: 1 })
    expect(() => assertController(human, "mcp", 0)).toThrow()
    expect(() => assertController(human, "mcp", 1)).toThrow()
    expect(() => assertController(human, "human", 1)).not.toThrow()
    expect(() => assertController(human, "human", 0)).toThrow()
  })
  it("交接被AI接受前仍由真人控制；取消后迟到接受不能抢权", () => {
    const human = { ...seat(), controller: "human", controlVersion: 1 }
    const pending = { ...human, ...changeControl(human, "request_ai", 1) }
    expect(pending).toMatchObject({ controller: "human", handoffPending: true })
    const accepted = { ...pending, ...claimControl(pending, pending.controlVersion) }
    expect(accepted).toMatchObject({ controller: "ai", handoffPending: false })
    expect(() => assertController(accepted, "mcp")).toThrow()
    expect(() => assertController(accepted, "mcp", accepted.controlVersion)).not.toThrow()
    const cancelled = { ...pending, ...changeControl(pending, "cancel_ai", pending.controlVersion) }
    expect(() => claimControl(cancelled, pending.controlVersion)).toThrow()
  })
  it("接管仅撤销维护暂停，保留用户暂停", () => {
    const maintenance = { ...seat(), pauseReason: "context_maintenance", sitPending: true, checkpoint: { continueIntent: true } }
    expect(changeControl(maintenance, "takeover", 0)).toMatchObject({ sitPending: false, pauseReason: null, checkpoint: null })
    const userPause = { ...seat(), pauseReason: "user", sitPending: true }
    expect(changeControl(userPause, "takeover", 0)).not.toHaveProperty("sitPending")
  })
})
