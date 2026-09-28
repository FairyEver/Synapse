/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MailCompose } from "../compose"

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock("@/lib/mail-api", () => ({ mailRequest: mocks.request }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const people = [
  { userId: "a", nickname: "甲", handle: "person-a", matchKind: "browse", similarity: 1, sharedTeamIds: ["team"] },
  { userId: "b", nickname: "乙", handle: "person-b", matchKind: "browse", similarity: 1, sharedTeamIds: ["team"] },
]

let root: Root | null = null

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function renderCompose() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<MailCompose start={{}} onClose={() => {}} onSent={() => {}} />)
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
  mocks.request.mockReset()
})

describe("MailCompose recipients", () => {
  it("lists members before searching and keeps multiple selections visible", async () => {
    mocks.request.mockResolvedValue({ items: people, nextCursor: null })
    await renderCompose()

    expect(mocks.request).toHaveBeenCalledWith({ kind: "recipientSearch", query: "" })
    expect(document.activeElement?.id).toBe("mail-recipient-search")
    const list = document.querySelector('[aria-label="可选收件人"]')
    const choices = list?.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')
    expect(choices).toHaveLength(2)

    await act(async () => { choices?.[0].click(); choices?.[1].click() })
    expect(Array.from(list?.querySelectorAll('button[aria-pressed="true"]') ?? [])).toHaveLength(2)
    expect(document.querySelector('[aria-label="已选收件人"]')?.textContent).toContain("甲")
    expect(document.querySelector('[aria-label="已选收件人"]')?.textContent).toContain("乙")
    expect(document.body.textContent).toContain("已选 2/50")

    await act(async () => { list?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.click() })
    expect(Array.from(list?.querySelectorAll('button[aria-pressed="true"]') ?? [])).toHaveLength(1)
    expect(document.body.textContent).toContain("已选 1/50")
  })

  it("loads the next page without losing the existing selection", async () => {
    mocks.request.mockImplementation(({ cursor }: { cursor?: string }) => Promise.resolve(cursor ? { items: [people[1]], nextCursor: null } : { items: [people[0]], nextCursor: "a" }))
    await renderCompose()
    const list = document.querySelector('[aria-label="可选收件人"]')
    await act(async () => { list?.querySelector<HTMLButtonElement>('button[aria-pressed]')?.click() })
    const more = Array.from(list?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((button) => button.textContent === "加载更多")
    await act(async () => { more?.click(); await Promise.resolve() })

    expect(mocks.request).toHaveBeenCalledWith({ kind: "recipientSearch", query: "", cursor: "a" })
    expect(list?.querySelectorAll('button[aria-pressed]')).toHaveLength(2)
    expect(list?.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1)
  })

  it("shows only the newest search results when an older request finishes late", async () => {
    const stale = deferred<{ items: typeof people; nextCursor: null }>()
    mocks.request.mockImplementation(({ query }: { query: string }) => query === "乙" ? stale.promise : Promise.resolve({ items: query ? [people[0]] : people, nextCursor: null }))
    await renderCompose()

    const input = document.querySelector<HTMLInputElement>("#mail-recipient-search")!
    const changeSearch = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
        input.dispatchEvent(new Event("input", { bubbles: true }))
      })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 260)) })
    }

    await changeSearch("乙")
    expect(mocks.request).toHaveBeenCalledWith({ kind: "recipientSearch", query: "乙" })
    await changeSearch("甲")
    const list = document.querySelector('[aria-label="可选收件人"]')
    expect(list?.querySelectorAll('button[aria-pressed]')).toHaveLength(1)
    expect(list?.textContent).toContain("甲")

    await act(async () => { stale.resolve({ items: [people[1]], nextCursor: null }); await stale.promise })
    expect(list?.textContent).toContain("甲")
    expect(list?.textContent).not.toContain("乙")
  })

  it("offers a retry when the member list fails to load", async () => {
    mocks.request.mockRejectedValueOnce(new Error("成员加载失败")).mockResolvedValue({ items: people, nextCursor: null })
    await renderCompose()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("成员加载失败")

    const retry = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "重试")
    await act(async () => { retry?.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(document.querySelector('[aria-label="可选收件人"]')?.querySelectorAll('button[aria-pressed]')).toHaveLength(2)
  })
})
