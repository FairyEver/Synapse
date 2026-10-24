import { expect, it, vi } from "vitest"
import { ManagedAssetStore } from "../../../../electron/runtime/data-repo/assets"
import { InMemoryAuditSink } from "../../../../electron/runtime/security"
import { createMailTestRig } from "./helpers"
import { MailService } from "../service"
import { aliyunConfig } from "../protocol/aliyun-policy"
it("isolates server users and invalidates old contexts/events without emitting stale events", async () => {
  const r = await createMailTestRig()
  let owner: string | null = "test-owner"
  const event = vi.fn(), open = vi.fn(), show = vi.fn()
  const service = new MailService({ storage: r.storage, files: new ManagedAssetStore(`${r.root}/assets`), permissionGuard: { registerPolicy: vi.fn(() => () => undefined), check: vi.fn(async () => ({ allowed: true as const })) }, auditSink: new InMemoryAuditSink(), resolveOwner: () => owner, events: event, open, notifications: { show }, diagnostic: vi.fn(), protocols: r.protocols })
  try {
    const ctx = service.context("ui")
    expect(await service.execute(ctx, "account.list", { limit: 50 })).toEqual({ items: [], nextCursor: null })
    await service.beforeIdentityChange(); owner = "other-user"; service.identityChanged()
    await expect(service.execute(ctx, "account.list", { limit: 50 })).rejects.toMatchObject({ code: "IDENTITY_CHANGED" })
    expect((await service.execute(service.context("ui"), "account.list", { limit: 50 })).items).toEqual([])
    expect(event).not.toHaveBeenCalled()
  } finally { await service.dispose(); await r.close() }
})

it.each(["ui", "mcp"] as const)("does not emit mailbox changes when %s polls message counts, while still notifying account edits", async actor => {
  const r = await createMailTestRig()
  const account = await r.accounts.configure(r.ctx, { ...aliyunConfig("me@example.com", "Work"), credential: "test-only" })
  const events = vi.fn()
  const service = new MailService({ storage: r.storage, files: new ManagedAssetStore(`${r.root}/assets`), permissionGuard: { registerPolicy: vi.fn(() => () => undefined), check: vi.fn(async () => ({ allowed: true as const })) }, auditSink: new InMemoryAuditSink(), resolveOwner: () => "test-owner", events, open: vi.fn(), notifications: { show: vi.fn() }, diagnostic: vi.fn(), protocols: r.protocols })
  try {
    service.scope({ id: 42, isDestroyed: () => false, onDestroyed: () => () => undefined })
    const ctx = service.context(actor)
    for (let i = 0; i < 3; i++) {
      expect(await service.execute(ctx, "message.count", { accountId: account.id })).toMatchObject({ indexed: 0, unread: 0, serverReported: 0 })
    }
    expect(events).not.toHaveBeenCalled()

    const updated = await service.execute(ctx, "account.update", { accountId: account.id, expectedRevision: account.revision, patch: { name: "Renamed" } })
    expect(updated.name).toBe("Renamed")
    expect(events).toHaveBeenCalledExactlyOnceWith({ ownerId: "test-owner", generation: ctx.generation, accountId: account.id, ids: [], revision: 1 }, [42])
    await service.execute(ctx, "message.count", { accountId: account.id })
    expect(events).toHaveBeenCalledTimes(1)
  } finally { await service.dispose(); await r.close() }
})
