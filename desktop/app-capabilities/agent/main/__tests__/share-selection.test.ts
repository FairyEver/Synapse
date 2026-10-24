import { describe, expect, it } from "vitest"
import { buildShareSnapshot, selectShareMessages } from "../share-selection"
import type { ConversationEntryV1 } from "../../../../electron/runtime/data-repo"

const history = [
  { role: "user", content: "部署问题", timestamp: "2026-10-24T00:00:00Z" },
  { role: "assistant", content: "过程", timestamp: "2026-10-24T00:00:01Z", metadata: { agentEventType: "thinking" } },
  { role: "assistant", content: "部署回复", timestamp: "2026-10-24T00:00:02Z" },
  { role: "user", content: "第二个问题", timestamp: "2026-10-24T00:00:03Z" },
  { role: "assistant", content: "第二个回复", timestamp: "2026-10-24T00:00:04Z" },
  { role: "user", content: "把上面全部分享", timestamp: "2026-10-24T00:00:05Z" },
] as ConversationEntryV1["history"]
const conversation = { id: "c", projectId: "p", history } as ConversationEntryV1
describe("share snapshot selection", () => {
  it("freezes the boundary before the share instruction and excludes process", () => {
    const snapshot = buildShareSnapshot(conversation, 5)
    expect(snapshot.map(m => m.content)).toEqual(["部署问题", "部署回复", "第二个问题", "第二个回复"])
    history[5]!.content = "新的分享指令"
    expect(snapshot.map(m => m.content)).not.toContain("新的分享指令")
  })
  it("selects latest complete turn, only assistant and explicit non-contiguous messages", () => {
    const snapshot = buildShareSnapshot(conversation, 5)
    expect(selectShareMessages(snapshot, "latest_turn").map(m => m.content)).toEqual(["第二个问题", "第二个回复"])
    expect(selectShareMessages(snapshot, "assistant").map(m => m.content)).toEqual(["第二个回复"])
    expect(selectShareMessages(snapshot, "messages", [snapshot[3]!.messageRef, snapshot[0]!.messageRef]).map(m => m.content)).toEqual(["部署问题", "第二个回复"])
    expect(() => selectShareMessages(snapshot, "messages", ["invented"])).toThrow()
  })
  it("changes message references if source content changes and rejects incomplete last turn as latest", () => {
    const snapshot = buildShareSnapshot(conversation, 4)
    expect(selectShareMessages(snapshot, "latest_turn").map(m => m.content)).toEqual(["部署问题", "部署回复"])
    const changed = structuredClone(conversation); changed.history[0]!.content = "已编辑"
    expect(buildShareSnapshot(changed, 5)[0]!.messageRef).not.toBe(snapshot[0]!.messageRef)
  })
  it("does not silently truncate oversized messages", () => {
    const changed = structuredClone(conversation); changed.history[0]!.content = "x".repeat(2 * 1024 * 1024 + 1)
    expect(() => buildShareSnapshot(changed, 5)).toThrow("过长")
  })
})
