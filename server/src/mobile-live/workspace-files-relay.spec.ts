import { afterEach, describe, expect, it, vi } from "vitest"
import { LIVE_MESSAGE_TYPES, type MobileIntentResultPayload, type MobileWorkspaceFilesIntent } from "@synapse/shared"
import { MobileLiveRelayService } from "./mobile-live-relay.service"
import { MobileLiveController } from "./mobile-live.controller"

const time = "2026-10-03T08:00:00.000Z"
const request: MobileWorkspaceFilesIntent = { v: 1, intentId: "file-1", kind: "workspaceFiles", filesVersion: 1, sessionId: "session-1", operation: "open", scopeMode: "currentDirectory" }
const input = { userId: "user-1", desktopClientInstanceId: "desktop-1", mobileClientInstanceId: "phone-1", intent: request }
function harness(supported = true, owned = true) {
  const sendToClientInstance = vi.fn(() => "sent" as const)
  const sendWorkspaceFilesResult = vi.fn((_input: { readonly userId: string; readonly clientInstanceId: string; readonly message: unknown }) => "sent" as const)
  const sendToMobileClients = vi.fn()
  const service = new MobileLiveRelayService({ sendToClientInstance, listOnlineDesktops: () => [] } as never, {} as never)
  service.setFanout({ sendToMobile: vi.fn(() => "sent" as const), sendToMobileClients, sendWorkspaceFilesResult, ownsMobileClient: (userId, phoneId) => owned && userId === "user-1" && phoneId === "phone-1" })
  service.handleSummary("user-1", { desktopClientInstanceId: "desktop-1", desktopName: "Mac", revision: 1, groups: [], sessions: [], ...(supported ? { workspaceFilesVersion: 1 } : {}) })
  const response: MobileIntentResultPayload = { desktopClientInstanceId: "desktop-1", mobileClientInstanceId: "phone-1", result: { intentId: "file-1", sessionId: "session-1", outcome: "accepted", workspaceFiles: { filesVersion: 1, operation: "open", sessionId: "session-1", scopeId: "scope-1", contextVersion: "context-1", readAt: time, data: { scopeId: "scope-1", contextVersion: "context-1", rootEntryId: "root-1", rootDisplayName: "workspace", scopeMode: "currentDirectory", gitAvailable: true, expiresAt: time } } } }
  return { service, sendToClientInstance, sendWorkspaceFilesResult, sendToMobileClients, response }
}
afterEach(() => vi.useRealTimers())
describe("workspace files WS/HTTP relay", () => {
  it("does not send a new kind to an old desktop or an unbound phone instance", async () => {
    const old = harness(false)
    expect((await old.service.deliverIntent(input)).result?.code).toBe("unsupported_version")
    expect(old.sendToClientInstance).not.toHaveBeenCalled()
    const unbound = harness(true, false)
    expect((await unbound.service.deliverIntent(input)).result?.code).toBe("permission_denied")
    expect(unbound.sendToClientInstance).not.toHaveBeenCalled()
  })
  it("forwards only matched replies through the file-specific reliable path and never caches them", async () => {
    const h = harness()
    await h.service.deliverIntent(input)
    h.service.handleIntentResult("user-1", h.response, "other-desktop")
    expect(h.sendWorkspaceFilesResult).not.toHaveBeenCalled()
    h.service.handleIntentResult("user-1", h.response, "desktop-1")
    expect(h.sendWorkspaceFilesResult).toHaveBeenCalledTimes(1)
    expect(h.sendWorkspaceFilesResult.mock.calls[0]?.[0]).toMatchObject({ userId: "user-1", clientInstanceId: "phone-1", message: { type: LIVE_MESSAGE_TYPES.mobileIntentResult, payload: h.response } })
    expect(h.service.cachedSummary("user-1", "desktop-1")).not.toHaveProperty("workspaceFiles")
    h.service.handleIntentResult("user-1", h.response, "desktop-1")
    expect(h.sendWorkspaceFilesResult).toHaveBeenCalledTimes(1)
  })
  it("returns the same verified result plus desktop context in HTTP fallback", async () => {
    const h = harness()
    const controller = new MobileLiveController({} as never, h.service)
    const waiting = controller.submitIntent({ user: { id: "user-1" } } as never, { clientInstanceId: "phone-1", desktopClientInstanceId: "desktop-1", intent: request, waitForResult: true })
    h.service.handleIntentResult("another-user", h.response, "desktop-1")
    h.service.handleIntentResult("user-1", h.response, "desktop-1")
    expect(await waiting).toEqual({ delivered: true, desktopClientInstanceId: "desktop-1", result: h.response.result })
  })
  it("merges WS duplicates with HTTP waits without routing another command", async () => {
    const h = harness()
    await h.service.deliverIntent(input)
    const wait = h.service.deliverIntent({ ...input, waitForResultMs: 15000 })
    expect(h.sendToClientInstance).toHaveBeenCalledTimes(1)
    h.service.handleIntentResult("user-1", h.response, "desktop-1")
    expect((await wait).result).toEqual(h.response.result)
  })
  it("expires a dropped reply with typed context and clears stale desktop capability on offline", async () => {
    vi.useFakeTimers()
    const h = harness()
    await h.service.deliverIntent(input)
    await vi.advanceTimersByTimeAsync(15000)
    expect(h.sendWorkspaceFilesResult.mock.calls[0]?.[0]).toMatchObject({ message: { payload: { desktopClientInstanceId: "desktop-1", result: { code: "deadline_exceeded" } } } })
    h.service.handleDesktopPresence("user-1", [])
    expect(h.service.cachedSummary("user-1", "desktop-1")?.workspaceFilesVersion).toBeUndefined()
    expect((await h.service.deliverIntent(input)).result?.code).toBe("unsupported_version")
  })
})
