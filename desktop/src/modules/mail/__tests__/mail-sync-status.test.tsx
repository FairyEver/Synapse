/** @vitest-environment jsdom */
import { account, coverage, deferred, flush, mocks, mount } from "./harness"
import { act } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { useMail } from "../use-mail"
import { MailListToolbar } from "../list-toolbar"

let current: ReturnType<typeof useMail>
function Harness() {
  current = useMail()
  return <MailListToolbar count={0} all={false} disabled={false} onToggle={vi.fn()} onBatch={vi.fn()} onMove={vi.fn()} folders={[]} canPermanentlyDelete={false} coverage={current.coverage} syncStatus={current.syncStatus} />
}
const job = { jobId: "mj_sync", accountId: account.id, state: "running", coverage: { ...coverage, metadataComplete: false, indexedCount: 50 }, errorCode: null }
const counts = { indexed: 50, unread: 0, serverReported: 251, coverage: job.coverage }
function prepare() {
  mocks.api.syncGet = vi.fn().mockResolvedValue(job)
  mocks.api.messageCount = vi.fn().mockResolvedValue(counts)
  mocks.api.messageList.mockResolvedValue({ items: [], nextCursor: null, coverage: job.coverage })
}
afterEach(() => vi.useRealTimers())

it("reads the active job on open, shows progress without text or a spinner, and preserves failures and pauses", async () => {
  vi.useFakeTimers(); prepare()
  mount(<Harness />); await flush()
  expect(mocks.api.syncStart).not.toHaveBeenCalled()
  expect(mocks.api.syncGet).toHaveBeenCalledWith({ accountId: account.id })
  expect(document.body.textContent).not.toContain("索引中")
  expect(document.body.textContent).not.toContain("50/251")
  expect(document.querySelector('[role="progressbar"]')?.getAttribute("aria-label")).toBe("索引中，已索引 50 / 251 封")
  expect(Number(document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"))).toBeCloseTo(50 / 251 * 100)
  expect(document.querySelector(".animate-spin")).toBeNull()
  mocks.api.syncGet.mockResolvedValue({ ...job, state: "failed", errorCode: "NETWORK_ERROR" })
  await act(async () => { await vi.advanceTimersByTimeAsync(2100) }); await flush()
  expect(document.body.textContent).toContain("同步失败")
  expect(document.querySelector(".animate-spin")).toBeNull()
  mocks.api.syncGet.mockResolvedValue(null)
  mocks.api.accountList.mockResolvedValue({ items: [{ ...account, paused: true, state: "paused" }], nextCursor: null })
  await act(async () => { await current.loadAccounts() })
  await act(async () => { await vi.advanceTimersByTimeAsync(2100) }); await flush()
  expect(document.body.textContent).toContain("同步已暂停")
  expect(document.body.textContent).toContain("50/251")
  expect(document.querySelector(".animate-spin")).toBeNull()
})

it("shows unknown totals, cancellation, completion and status read errors without pretending to run", async () => {
  vi.useFakeTimers(); prepare()
  mocks.api.messageCount.mockResolvedValue({ ...counts, serverReported: null })
  mocks.api.syncGet.mockResolvedValue({ ...job, state: "cancelled" })
  mount(<Harness />); await flush()
  expect(document.body.textContent).toContain("历史同步已取消")
  expect(document.body.textContent).toContain("50")
  expect(document.body.textContent).not.toContain("/251")
  expect(document.querySelector(".animate-spin")).toBeNull()
  mocks.api.syncGet.mockResolvedValue({ ...job, state: "completed" })
  await act(async () => { await vi.advanceTimersByTimeAsync(2100) }); await flush()
  expect(document.body.textContent).not.toContain("同步已完成")
  expect(document.querySelector('button[aria-label^="同步已完成"]')).toBeNull()
  expect(document.body.textContent).not.toContain("50")
  mocks.api.syncGet.mockRejectedValue(new Error("读取失败"))
  await act(async () => { await vi.advanceTimersByTimeAsync(2100) }); await flush()
  expect(document.body.textContent).toContain("同步状态不可用")
  expect(document.querySelector(".animate-spin")).toBeNull()
})

it("discards late sync snapshots after an account switch", async () => {
  prepare()
  const pending = deferred<typeof job>()
  mocks.api.syncGet.mockReturnValueOnce(pending.promise).mockResolvedValue(null)
  mount(<Harness />); await flush()
  act(() => current.selectAccount("ma_two")); await flush()
  await act(async () => { pending.resolve(job) }); await flush()
  expect(document.body.textContent).not.toContain("索引中")
  expect(document.querySelector(".animate-spin")).toBeNull()
})

it("refreshes on job events and exposes the failure reason without spinning", async () => {
  vi.useFakeTimers(); prepare()
  mount(<Harness />); await flush()
  mocks.api.syncGet.mockResolvedValue({ ...job, state: "paused", errorCode: "AUTH_FAILED" })
  act(() => mocks.changed({ ownerId: "user", generation: 1, accountId: account.id, ids: [job.jobId], revision: 2 }))
  await act(async () => { await vi.advanceTimersByTimeAsync(130) }); await flush()
  expect(document.body.textContent).toContain("同步已暂停")
  expect(document.querySelector(".animate-spin")).toBeNull()
  act(() => document.querySelector<HTMLButtonElement>('button[aria-label^="同步已暂停"]')!.click())
  await flush()
  expect(document.body.textContent).toContain("邮箱认证失败")
})

it("keeps updating progress during a continuous stream of indexing events", async () => {
  vi.useFakeTimers(); prepare()
  mount(<Harness />); await flush()
  for (let i = 0; i < 20; i++) {
    act(() => mocks.changed({ ownerId: "user", generation: 1, accountId: account.id, ids: ["em_new"], revision: i }))
    await act(async () => { await vi.advanceTimersByTimeAsync(20) })
  }
  expect(mocks.api.syncGet.mock.calls.length).toBeGreaterThan(2)
})

it("rejects old generation results and never spins for an account requiring reauthentication", async () => {
  prepare()
  const pending = deferred<typeof job>()
  mocks.api.syncGet.mockReturnValueOnce(pending.promise).mockResolvedValue(null)
  mount(<Harness />); await flush()
  mocks.api.uiScope.mockResolvedValue({ ownerId: "user", generation: 2, notificationsSupported: true, notificationError: null })
  mocks.api.accountList.mockResolvedValue({ items: [{ ...account, state: "auth_failed", errorCode: "AUTH_FAILED" }], nextCursor: null })
  act(() => mocks.identityChanged()); await flush()
  await act(async () => { pending.resolve(job) }); await flush()
  expect(document.body.textContent).toContain("同步失败")
  expect(document.querySelector(".animate-spin")).toBeNull()
})

it("switches from indexing to actual reconciliation progress and hides completed work", async () => {
  vi.useFakeTimers(); prepare()
  mocks.api.syncGet.mockResolvedValue({ ...job, syncProgress: { phase: "indexing", completed: 50, total: 251 } })
  mount(<Harness />); await flush()
  expect(document.body.textContent).not.toContain("索引中")
  expect(document.body.textContent).not.toContain("50/251")
  expect(document.querySelector('[role="progressbar"]')?.getAttribute("aria-label")).toBe("索引中，已索引 50 / 251 封")
  expect(Number(document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"))).toBeCloseTo(50 / 251 * 100)
  mocks.api.messageCount.mockResolvedValue({ ...counts, indexed: 251 })
  const reconciling = { ...job, syncProgress: { phase: "reconciling", completed: 100, total: 251 } }
  mocks.api.syncGet.mockResolvedValue(reconciling)
  await act(async () => { await vi.advanceTimersByTimeAsync(2100) }); await flush()
  expect(document.body.textContent).not.toContain("校对状态中")
  expect(document.querySelector('[role="progressbar"]')?.getAttribute("aria-label")).toBe("校对状态中，已校对 100 / 251 封")
  expect(Number(document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"))).toBeCloseTo(100 / 251 * 100)
  expect(document.body.textContent).not.toContain("251/251")
  act(() => document.querySelector<HTMLElement>('[role="progressbar"]')!.parentElement!.focus()); await flush()
  expect(document.body.textContent).toContain("已校对 100 / 251 封")
  mocks.api.syncGet.mockResolvedValue({ ...reconciling, state: "failed", errorCode: "NETWORK_ERROR" })
  await act(async () => { await vi.advanceTimersByTimeAsync(2100) }); await flush()
  expect(document.body.textContent).toContain("同步失败")
  expect(document.body.textContent).toContain("100/251")
  expect(document.querySelector(".animate-spin")).toBeNull()
  mocks.api.syncGet.mockResolvedValue({ ...reconciling, state: "completed" })
  await act(async () => { await vi.advanceTimersByTimeAsync(2100) }); await flush()
  expect(document.querySelector('button[aria-label^="同步已完成"]')).toBeNull()
  expect(document.body.textContent).not.toContain("100/251")
})
