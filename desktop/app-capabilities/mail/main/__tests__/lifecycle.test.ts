import { expect, it, vi } from "vitest"
import { ManagedAssetStore } from "../../../../electron/runtime/data-repo/assets"
import { InMemoryAuditSink } from "../../../../electron/runtime/security"
import { createMailTestRig } from "./helpers"
import { MailService } from "../service"
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
