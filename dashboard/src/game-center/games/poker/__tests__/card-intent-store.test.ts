/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest"
const scope = { identityKey: "card-store-a", roomCode: "1234" }
const input = { roomCode: "1234", handId: "old-hand", street: "flop" as const, expectedActionSeq: 7, controlVersion: 3, actionId: "8529bfca-a8e8-4de4-89da-162f516d2f01", instanceId: "instance-01", selections: { hole: "0", player: "1" }, expectedPaymentVersion: "original-payment" }
afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); vi.resetModules() })
it.each(["play", "choose"])("%s硬刷新保留原UUID和全参数，账号/房间隔离", async operation => {
  const { cardIntentStore } = await import("../lib/card-intent-store")
  const { instanceId: _id, selections: _selections, ...common } = input
  const intent = operation === "play" ? { operation: "play" as const, input } : { operation: "choose" as const, input: { ...common, choiceId: "original-choice", candidateIndex: 2 } }
  cardIntentStore.save(scope, intent); vi.resetModules()
  const { cardIntentStore: fresh } = await import("../lib/card-intent-store")
  expect(fresh.getSnapshot(scope).intent).toEqual(intent)
  expect(fresh.getSnapshot({ ...scope, identityKey: "another" }).intent).toBeNull()
  expect(fresh.getSnapshot({ ...scope, roomCode: "5678" }).intent).toBeNull()
})
it.each(["scope", "room", "caller", "effectCode", "uuid", "payment", "json"])("%s损坏时保留原记录并禁止新卡写", async kind => {
  const { cardIntentStore: store } = await import("../lib/card-intent-store")
  store.save(scope, { operation: "play", input })
  const key = sessionStorage.key(0)!, raw = JSON.parse(sessionStorage.getItem(key)!)
  if (kind === "scope") raw.identityKey = "other"
  if (kind === "room") raw.intent.input.roomCode = "5678"
  if (kind === "caller" || kind === "effectCode") raw.intent.input[kind] = "injected"
  if (kind === "uuid") raw.intent.input.actionId = "bad"
  if (kind === "payment") delete raw.intent.input.expectedPaymentVersion
  const corrupt = kind === "json" ? "{broken" : JSON.stringify(raw)
  sessionStorage.setItem(key, corrupt); vi.resetModules()
  const { cardIntentStore: fresh } = await import("../lib/card-intent-store")
  expect(fresh.getSnapshot(scope).intent).toBeNull(); expect(fresh.getSnapshot(scope).error).toContain("恢复记录")
  expect(sessionStorage.getItem(key)).toBe(corrupt)
})
it("写入须读回确认；清理失败保留原意图；不能覆盖另一个UUID", async () => {
  const { cardIntentStore: store } = await import("../lib/card-intent-store"), intent = { operation: "play" as const, input }
  const deny = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {})
  expect(() => store.save(scope, intent)).toThrow(/恢复记录/); deny.mockRestore(); store.reload(scope)
  store.save(scope, intent)
  expect(() => store.save(scope, { ...intent, input: { ...input, actionId: "8529bfca-a8e8-4de4-89da-162f516d2f02" } })).toThrow(/恢复记录/)
  const removal = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("denied") })
  store.clear(scope, intent); expect(store.getSnapshot(scope).intent).toEqual(intent); expect(store.getSnapshot(scope).error).toContain("清理失败")
  removal.mockRestore(); store.clear(scope, intent); expect(store.getSnapshot(scope).intent).toBeNull()
})
