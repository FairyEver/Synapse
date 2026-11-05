import { expect, it, vi } from "vitest"
vi.mock("../../log-store", () => ({ createMainLogger: () => ({ warn: () => undefined, info: () => undefined }) }))
import { engineRig } from "./engine-fixture"
import { AutomationMailTriggerService } from "../service"

it("backfills letters from a closed enabled period but excludes the disabled period", async () => {
  const rig = await engineRig(); let current = 20
  rig.source.prepare = async () => [{ kind: "mail-internal", sourceKey: "inbox", receiptSequence: String(current), serverTime: "2026-11-05T00:00:00Z" }]
  rig.source.scan = async (_ctx, boundary, cursor) => {
    const position = cursor.startsWith("{") ? JSON.parse(cursor) as { after: string; through: string } : { after: cursor, through: String(current) }
    const receipts = Array.from({ length: current - 20 }, (_, i) => i + 21).filter(seq => seq > Number(position.after) && seq <= Number(position.through)).map(seq => ({ sourceKey: boundary.sourceKey, receiptKey: `letter-${seq}`, messageId: `letter-${seq}`, sequence: String(seq), receivedAt: `2026-11-05T01:${seq}:00Z` }))
    return { receipts, nextCursor: position.through, complete: true }
  }
  const hydrate = rig.source.hydrate
  rig.source.hydrate = async (ctx, receipt) => ({ ...await hydrate(ctx, receipt), body: receipt.messageId! })
  const worker = new AutomationMailTriggerService({ repository: rig.repo, activation: rig.activation, context: rig.context, sourceFor: () => rig.source, items: rig.items, automation: rig.automation, runs: rig.runs, logger: { warn: () => undefined } })
  try {
    const item = await rig.items.create({ ...rig.input, enabled: true })
    current = 21 // received offline while still enabled, not yet discovered
    await rig.items.setEnabled(item.id, false)
    current = 22 // received while disabled
    await rig.items.setEnabled(item.id, true)
    current = 23 // received after reenable
    await worker.reconcile("reconnected")
    expect(rig.bodies).toEqual(["letter-21", "letter-23"])
    await worker.reconcile("duplicate")
    expect(rig.bodies).toEqual(["letter-21", "letter-23"])
  } finally { await worker.stop(); await rig.close() }
})
