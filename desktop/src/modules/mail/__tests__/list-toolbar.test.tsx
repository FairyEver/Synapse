/** @vitest-environment jsdom */
import { mount, summary } from "./harness"
import { act } from "react"
import { expect, it, vi } from "vitest"
import { MailList } from "../message-list"
it("opens search on demand and keeps selection controls in one toolbar", () => {
  const search = vi.fn()
  mount(<MailList items={[summary]} drafts={[]} loading={false} more={false} onSelect={vi.fn()} onDraft={vi.fn()} onMore={vi.fn()} onBatch={vi.fn()} folders={[]} onMove={vi.fn()} onSearch={search} />)
  expect(document.querySelector('input[aria-label="搜索邮件"]')).toBeNull()
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="搜索邮件"]')
  expect(trigger).not.toBeNull(); act(() => trigger!.click())
  expect(document.querySelector('input[aria-label="搜索邮件"]')).not.toBeNull()
  act(() => document.querySelector('form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  expect(search).toHaveBeenCalledWith("")
  act(() => document.querySelector<HTMLButtonElement>('button[aria-label="退出搜索"]')!.click())
  act(() => document.querySelector<HTMLButtonElement>('[aria-label="选择当前页邮件"]')!.click())
  expect(document.querySelectorAll('select')).toHaveLength(0)
  expect(document.querySelector('[aria-label="已选 1 封邮件"]')?.textContent).toBe("1")
})
it("labels consumed drafts as sent instead of merely synced", () => {
  const draft = { id: "md_sent", accountId: "ma_one", revision: 1, to: [], cc: [], bcc: [], subject: "已发送测试信", assetIds: [], inlineImages: [], state: "consumed" as const, mode: "new" as const, sourceMessageId: null, remoteLocator: null, localSaved: true, syncState: "synced" as const, updatedAt: "2026-10-24T00:00:00Z" }
  mount(<MailList items={[]} drafts={[draft]} draftView loading={false} more={false} onSelect={vi.fn()} onDraft={vi.fn()} onMore={vi.fn()} onBatch={vi.fn()} folders={[]} onMove={vi.fn()} />)
  const row = [...document.querySelectorAll("button")].find(node => node.textContent?.includes("已发送测试信"))
  expect(row?.textContent).toContain("已发送（只读）")
  expect(row?.textContent).not.toContain("已同步")
})
