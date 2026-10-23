/** @vitest-environment jsdom */
import { mocks, mount, flush, detail, deferred, summary, coverage } from "./harness"
import { act } from "react"
import { expect, it } from "vitest"
import { useMail } from "../use-mail"
let current: ReturnType<typeof useMail>
function Harness() { current = useMail(); return null }
it("selects mail through an explicit read mutation and discards details from an old account", async () => {
  mount(<Harness />); await flush()
  const pending = deferred<typeof detail>(); mocks.api.messageGet.mockReturnValueOnce(pending.promise)
  let selecting!: Promise<void>
  act(() => { selecting = current.selectMessage(summary.id) })
  act(() => current.selectAccount("ma_two")); await flush()
  await act(async () => { pending.resolve(detail); await selecting })
  expect(current.detail).toBeNull()
  expect(mocks.api.messageUpdate).not.toHaveBeenCalled()
  act(() => current.selectAccount("ma_one")); await flush()
  await act(async () => { await current.selectMessage(summary.id) })
  expect(current.detail?.id).toBe(summary.id)
  expect(mocks.api.messageUpdate).toHaveBeenCalledWith({ accountId: "ma_one", messageIds: [summary.id], patch: { read: true } })
})
it("reports incomplete search coverage and refuses a batch larger than 100", async () => {
  mocks.api.searchStart.mockResolvedValue({ jobId: "mj_job" }); mocks.api.searchGet.mockResolvedValue({ items: [], nextCursor: null, canContinue: true, coverage: { ...coverage, metadataComplete: false, reason: "body_not_scanned" } })
  mount(<Harness />); await flush()
  await act(async () => { await current.search("正文", "body") })
  expect(current.coverage?.reason).toBe("body_not_scanned"); expect(current.canContinue).toBe(true)
  await expect(current.mutate("delete", Array.from({ length: 101 }, (_, i) => `em_${i}`))).rejects.toThrow("100")
  expect(mocks.api.messageDelete).not.toHaveBeenCalled()
})
it("keeps the newest search when an older search start finishes late", async () => {
  mount(<Harness />); await flush()
  const old = deferred<{ jobId: string }>(); mocks.api.searchStart.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ jobId: "mj_new" })
  mocks.api.searchGet.mockImplementation(async ({ jobId }: { jobId: string }) => ({ items: [{ ...summary, subject: jobId }], nextCursor: null, coverage, canContinue: false }))
  let first!: Promise<void>
  act(() => { first = current.search("old") })
  await act(async () => { await current.search("new") })
  await act(async () => { old.resolve({ jobId: "mj_old" }); await first })
  expect(current.items[0]?.subject).toBe("mj_new")
})

it("invalidates old reads when the same SY user starts a new identity generation", async () => {
  mount(<Harness />); await flush()
  const pending = deferred<typeof detail>(); mocks.api.messageGet.mockReturnValueOnce(pending.promise)
  let selecting!: Promise<void>; act(() => { selecting = current.selectMessage(summary.id) })
  mocks.api.uiScope.mockResolvedValue({ ownerId: "user", generation: 2, notificationsSupported: true, notificationError: null })
  act(() => mocks.identityChanged()); await flush()
  await act(async () => { pending.resolve(detail); await selecting })
  expect(current.detail).toBeNull(); expect(mocks.api.messageUpdate).not.toHaveBeenCalled()
  expect(current.scope?.generation).toBe(2)
})
