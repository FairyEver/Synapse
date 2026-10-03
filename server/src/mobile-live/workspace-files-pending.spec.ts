import { afterEach, describe, expect, it, vi } from "vitest"
import type { MobileIntentResultPayload, MobileWorkspaceFilesIntent } from "@synapse/shared"
import { WorkspaceFilesPending } from "./workspace-files-pending"

const owner = { userId: "user-1", desktopClientInstanceId: "desktop-1", mobileClientInstanceId: "phone-1" }
const intent: MobileWorkspaceFilesIntent = { v: 1, intentId: "same-id", kind: "workspaceFiles", filesVersion: 1, sessionId: "session-1", operation: "open", scopeMode: "currentDirectory" }
const payload: MobileIntentResultPayload = { desktopClientInstanceId: "desktop-1", mobileClientInstanceId: "phone-1", result: { intentId: "same-id", outcome: "accepted", sessionId: "session-1", workspaceFiles: { filesVersion: 1, operation: "open", sessionId: "session-1", scopeId: "scope-1", contextVersion: "context-1", readAt: "2026-10-03T08:00:00.000Z", data: { scopeId: "scope-1", contextVersion: "context-1", rootEntryId: "root-1", rootDisplayName: "workspace", scopeMode: "currentDirectory", gitAvailable: true, expiresAt: "2026-10-03T08:10:00.000Z" } } } }
afterEach(() => vi.useRealTimers())
describe("WorkspaceFilesPending trusted correlation", () => {
  it("does not let another account, desktop, mobile or session complete a waiter", async () => {
    const failed = vi.fn()
    const pending = new WorkspaceFilesPending(failed)
    const registration = pending.register({ ...owner, intent }, true)
    expect(pending.accept("user-2", "desktop-1", payload)).toBe(false)
    expect(pending.accept("user-1", "desktop-2", payload)).toBe(false)
    expect(pending.accept("user-1", "desktop-1", { ...payload, mobileClientInstanceId: "phone-2" })).toBe(false)
    expect(pending.accept("user-1", "desktop-1", { ...payload, result: { ...payload.result, workspaceFiles: { ...payload.result.workspaceFiles!, sessionId: "session-2" } } })).toBe(false)
    expect(pending.accept("user-1", "desktop-1", payload)).toBe(true)
    expect(await registration.result).toEqual(payload.result)
    expect(failed).not.toHaveBeenCalled()
    expect(pending.accept("user-1", "desktop-1", payload)).toBe(false)
  })
  it("correlates reused ids independently and rejects mismatched parameters in one owner", async () => {
    const pending = new WorkspaceFilesPending(vi.fn())
    const first = pending.register({ ...owner, intent }, true)
    expect(pending.register({ ...owner, intent }, false).fresh).toBe(false)
    expect(pending.register({ ...owner, intent: { ...intent, scopeMode: "repository" } }, false).rejection?.code).toBe("request_conflict")
    const second = pending.register({ ...owner, userId: "user-2", intent }, true)
    expect(second.fresh).toBe(true)
    pending.accept("user-1", "desktop-1", payload)
    expect(await first.result).toEqual(payload.result)
    pending.accept("user-2", "desktop-1", payload)
    expect(await second.result).toEqual(payload.result)
  })
  it("requires matching scope and operation, but accepts attributed relay-style failures", async () => {
    const pending = new WorkspaceFilesPending(vi.fn())
    const request: MobileWorkspaceFilesIntent = { ...intent, operation: "close", scopeId: "scope-1" }
    const registered = pending.register({ ...owner, intent: request }, true)
    expect(pending.accept("user-1", "desktop-1", payload)).toBe(false)
    expect(pending.accept("user-1", "desktop-1", { ...payload, result: { intentId: "same-id", outcome: "accepted" } })).toBe(false)
    const failure: MobileIntentResultPayload = { ...payload, result: { intentId: "same-id", sessionId: "session-1", outcome: "rejected", code: "scope_stale" } }
    expect(pending.accept("user-1", "desktop-1", failure)).toBe(true)
    expect(await registered.result).toEqual(failure.result)
  })
  it("expires unresponsive tasks, resolves HTTP waits and never retains their body", async () => {
    vi.useFakeTimers()
    const failed = vi.fn()
    const pending = new WorkspaceFilesPending(failed)
    const wait = pending.register({ ...owner, intent }, true)
    await vi.advanceTimersByTimeAsync(15000)
    expect((await wait.result)?.code).toBe("deadline_exceeded")
    expect(failed).toHaveBeenCalledWith(expect.objectContaining(owner), expect.objectContaining({ intentId: "same-id", code: "deadline_exceeded" }))
    expect(pending.register({ ...owner, intent }, false).fresh).toBe(true)
    pending.disconnect("user-1", "phone-1")
  })
  it("bounds per-mobile pending records and releases them on disconnection", () => {
    vi.useFakeTimers()
    const pending = new WorkspaceFilesPending(vi.fn())
    for (let i = 0; i < 64; i += 1) expect(pending.register({ ...owner, intent: { ...intent, intentId: `i-${i}` } }, false).fresh).toBe(true)
    expect(pending.register({ ...owner, intent }, false).rejection?.code).toBe("busy")
    expect(pending.register({ ...owner, intent: { ...intent, intentId: "close-1", operation: "close", scopeId: "scope-1" } }, false).fresh).toBe(true)
    pending.disconnect("user-1", "phone-1")
    expect(pending.register({ ...owner, intent }, false).fresh).toBe(true)
  })
})
