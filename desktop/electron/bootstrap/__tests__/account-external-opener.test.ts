import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp"),
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}))

import { createAccountExternalUrlOpener } from "../account-external-opener"
import type { AuditSink, PermissionGuard } from "../../runtime/security"

function createDeps(input: {
  allowed?: boolean
  reason?: string
  record?: AuditSink["record"]
} = {}) {
  const permissionGuard = {
    check: vi.fn().mockResolvedValue(
      input.allowed === false
        ? { allowed: false, reason: input.reason ?? "denied", policyId: "test-policy" }
        : { allowed: true },
    ),
  } as unknown as PermissionGuard
  const auditSink = {
    record: vi.fn(input.record),
  } as unknown as AuditSink
  const openExternal = vi.fn().mockResolvedValue(undefined)

  return { auditSink, openExternal, permissionGuard }
}

describe("createAccountExternalUrlOpener", () => {
  it("opens login links through permission guard and audit sink", async () => {
    const deps = createDeps()
    const openExternal = createAccountExternalUrlOpener(deps)

    await openExternal("https://synapse.d2.pub/dashboard/auth/desktop?state=secret-state&code_challenge=secret-challenge&code_challenge_method=S256")

    expect(deps.permissionGuard.check).toHaveBeenCalledWith({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: "https://synapse.d2.pub/dashboard/auth/desktop?state=%5Bredacted%5D&code_challenge=%5Bredacted%5D&code_challenge_method=S256",
      context: { source: "account.startLogin" },
    })
    expect(deps.openExternal).toHaveBeenCalledWith("https://synapse.d2.pub/dashboard/auth/desktop?state=secret-state&code_challenge=secret-challenge&code_challenge_method=S256")
    expect(deps.auditSink.record).toHaveBeenCalledWith({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: "https://synapse.d2.pub/dashboard/auth/desktop?state=%5Bredacted%5D&code_challenge=%5Bredacted%5D&code_challenge_method=S256",
      outcome: "allowed",
      metadata: { source: "account.startLogin" },
    })
    expect(JSON.stringify(vi.mocked(deps.permissionGuard.check).mock.calls)).not.toContain("secret-state")
    expect(JSON.stringify(vi.mocked(deps.permissionGuard.check).mock.calls)).not.toContain("secret-challenge")
    expect(JSON.stringify(vi.mocked(deps.auditSink.record).mock.calls)).not.toContain("secret-state")
    expect(JSON.stringify(vi.mocked(deps.auditSink.record).mock.calls)).not.toContain("secret-challenge")
  })

  it("does not fail login opening when allowed audit recording fails", async () => {
    const deps = createDeps({
      record: () => {
        throw new Error("disk full")
      },
    })
    const openExternal = createAccountExternalUrlOpener(deps)

    await expect(openExternal("https://synapse.d2.pub/dashboard/auth/desktop"))
      .resolves
      .toBeUndefined()

    expect(deps.openExternal).toHaveBeenCalledWith("https://synapse.d2.pub/dashboard/auth/desktop")
    expect(deps.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      outcome: "allowed",
      metadata: { source: "account.startLogin" },
    }))
  })

  it("does not open denied login links", async () => {
    const deps = createDeps({ allowed: false, reason: "blocked" })
    const openExternal = createAccountExternalUrlOpener(deps)

    await expect(openExternal("https://synapse.d2.pub/dashboard/auth/desktop"))
      .rejects
      .toThrow("blocked")

    expect(deps.openExternal).not.toHaveBeenCalled()
    expect(deps.auditSink.record).toHaveBeenCalledWith({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: "https://synapse.d2.pub/dashboard/auth/desktop",
      outcome: "denied",
      metadata: {
        source: "account.startLogin",
        reason: "blocked",
        policyId: "test-policy",
      },
    })
  })
})
