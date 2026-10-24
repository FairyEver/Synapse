/** @vitest-environment jsdom */
import { coverage, mount, summary } from "./harness"
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
it("does not treat incomplete search coverage as an active synchronization job", () => {
  const resume = vi.fn()
  mount(<MailList items={[]} drafts={[]} loading={false} more={false} onSelect={vi.fn()} onDraft={vi.fn()} onMore={vi.fn()} onBatch={vi.fn()} folders={[]} onMove={vi.fn()} coverage={{ ...coverage, metadataComplete: false }} canContinue onContinue={resume} />)
  expect(document.querySelector(".animate-spin")).toBeNull()
  act(() => document.querySelector<HTMLButtonElement>('button[aria-label="部分邮件尚未检索"]')!.click())
  act(() => [...document.querySelectorAll("button")].find(button => button.textContent === "继续检索")!.click())
  expect(resume).toHaveBeenCalledTimes(1)
})

it("keeps search and selection available throughout list loading", () => {
  const props = { items: [summary], drafts: [], loading: false, more: false, onSelect: vi.fn(), onDraft: vi.fn(), onMore: vi.fn(), onBatch: vi.fn(), folders: [], onMove: vi.fn(), onSearch: vi.fn(), coverage: { ...coverage, metadataComplete: false }, canContinue: true, onContinue: vi.fn() }
  const pending = { loading: true }
  const toolbar = () => document.querySelector('[aria-label="邮件列表工具栏"]')!
  mount(<MailList {...props} {...pending} />)
  expect(toolbar().querySelector('[role="progressbar"]')).toBeNull()
  act(() => toolbar().querySelector<HTMLButtonElement>('button[aria-label="搜索邮件"]')!.click())
  const input = toolbar().querySelector<HTMLInputElement>('input[aria-label="搜索邮件"]')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "季度报告")
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  act(() => toolbar().querySelector('form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  expect(props.onSearch).toHaveBeenLastCalledWith("季度报告")

  for (let refresh = 0; refresh < 3; refresh++) {
    mount(<MailList {...props} {...pending} />)
    expect(toolbar().querySelector('input[aria-label="搜索邮件"]')).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe("季度报告")
    expect(toolbar().querySelector('[role="progressbar"]')).toBeNull()
    mount(<MailList {...props} />)
  }

  mount(<MailList {...props} />)
  expect(toolbar().querySelector('input[aria-label="搜索邮件"]')).not.toBeNull()
  act(() => toolbar().querySelector<HTMLButtonElement>('button[aria-label="退出搜索"]')!.click())
  act(() => toolbar().querySelector<HTMLButtonElement>('[aria-label="选择当前页邮件"]')!.click())
  expect(toolbar().textContent).toContain("操作")

  mount(<MailList {...props} {...pending} />)
  expect(toolbar().textContent).toContain("操作")
  expect(toolbar().querySelector('[aria-label="已选 1 封邮件"]')).not.toBeNull()
  expect(toolbar().querySelector('[role="progressbar"]')).toBeNull()
  mount(<MailList {...props} />)
  expect(toolbar().textContent).toContain("操作")
  expect(toolbar().querySelector('[aria-label="已选 1 封邮件"]')).not.toBeNull()
  expect(toolbar().querySelector('[role="progressbar"]')).toBeNull()
})
