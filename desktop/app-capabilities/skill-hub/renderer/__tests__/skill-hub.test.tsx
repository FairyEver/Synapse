/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EmbeddedSystemAppShell } from "@/modules/apps/components/embedded-system-app-shell"
import { SkillHubModule } from "../index"

const mocks = vi.hoisted(() => ({
  account: { id: "first", online: true },
  list: vi.fn(),
  detail: vi.fn(),
  icon: vi.fn(),
  openInstaller: vi.fn(),
}))

vi.mock("@/app-shell/account", () => ({
  useAccount: () => ({
    state: { status: "authenticated", connectivity: mocks.account.online ? "online" : "offline", profile: { user: { id: mocks.account.id } } },
  }),
}))

const skill = {
  id: "sample", iconUrl: null, revision: 1,
  displayName: "团队技能", displayDescription: "示例简介",
  package: { name: "sample-skill" }, team: { id: "team", name: "产品组" },
  createdBy: { id: "creator", displayName: "李杨" }, currentVersion: { number: 2 },
}
const success = <T,>(value: T) => ({ ok: true, value })

let root: Root
let container: HTMLElement
let pageObservers: Array<(entries: { isIntersecting: boolean }[]) => void>

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  pageObservers = []
  vi.stubGlobal("IntersectionObserver", class {
    constructor(notify: (entries: { isIntersecting: boolean }[]) => void) { pageObservers.push(notify) }
    observe() {}
    disconnect() {}
  })
  mocks.account.id = "first"
  mocks.account.online = true
  mocks.list.mockReset().mockResolvedValue(success({ items: [skill], nextCursor: null }))
  mocks.detail.mockReset().mockResolvedValue(success({
    skill, content: "![remote](https://example.invalid/track)\n<script>fixture</script>",
  }))
  mocks.openInstaller.mockReset().mockResolvedValue(success(null))
  mocks.icon.mockReset()
  vi.stubGlobal("synapse", { skillHub: {
    catalogList: mocks.list, catalogDetail: mocks.detail,
    catalogOpenInstaller: mocks.openInstaller, catalogIcon: mocks.icon,
  } })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(host: "window" | "launcher" | "dock" = "window") {
  const module = <SkillHubModule />
  await act(async () => root.render(host === "window" ? module : (
    <EmbeddedSystemAppShell appName="SkillHub" mode={host}>{module}</EmbeddedSystemAppShell>
  )))
}

function button(name: string) {
  const found = Array.from(document.querySelectorAll("button")).find(
    (node) => (node.getAttribute("aria-label") ?? node.textContent?.trim()) === name,
  )
  if (!found) throw new Error(`Button not found: ${name}`)
  return found
}

async function click(node: HTMLElement) {
  await act(async () => node.click())
}

describe("SkillHub", () => {
  it.each(["window", "launcher", "dock"] as const)("uses one app header in the %s host", async (host) => {
    await render(host)
    expect(container.querySelectorAll("[data-system-app-window-toolbar], [data-embedded-system-app-header]")).toHaveLength(1)
    expect(container.querySelector("aside, footer, [role='tablist']")).toBeNull()
    const card = button("查看 团队技能")
    expect(card.textContent).toContain("李杨·v2")
    expect(card.textContent).not.toContain(skill.package.name)
    expect(container.querySelector('[aria-label="筛选团队"]')).toBeNull()
    expect(container.textContent).not.toContain(skill.team.name)
  })

  it("uses the installer from both entry points and shows main file content as text", async () => {
    await render()
    expect(container.textContent).toContain("李杨")
    expect(container.textContent).not.toContain("@李杨")
    await click(button("安装 团队技能"))
    expect(mocks.openInstaller).toHaveBeenCalledWith({ skillId: "sample" })

    const trigger = button("查看 团队技能")
    trigger.focus()
    await click(trigger)
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain("李杨")
    expect(dialog.textContent).not.toContain("@李杨")
    expect(dialog.textContent).toContain(skill.package.name)
    expect(dialog.textContent).toContain("<script>fixture</script>")
    expect(dialog.textContent).not.toContain(skill.team.name)
    expect(dialog.querySelector("script, img[src^='https:']")).toBeNull()
    await click(button("安装"))
    expect(mocks.openInstaller).toHaveBeenCalledTimes(2)
    await click(button("关闭"))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(document.activeElement).toBe(trigger)
  })

  it.each([
    { id: "creator", displayName: "1711467488" },
    { id: "creator", displayName: "creator" },
  ])("omits an account identifier from the catalog and detail", async (createdBy) => {
    const legacy = { ...skill, createdBy }
    mocks.list.mockResolvedValue(success({ items: [legacy], nextCursor: null }))
    mocks.detail.mockResolvedValue(success({ skill: legacy, content: "说明" }))
    await render()
    expect(container.textContent).not.toContain(createdBy.displayName)
    await click(button("查看 团队技能"))
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain("说明")
    expect(dialog.textContent).not.toContain(createdBy.displayName)
  })

  it("loads successive pages as the bottom approaches without a load-more button", async () => {
    let resolveNext!: (value: unknown) => void
    const next = { ...skill, id: "next", displayName: "第二页技能" }
    const last = { ...skill, id: "last", displayName: "最后一页技能" }
    mocks.list.mockResolvedValueOnce(success({ items: [skill], nextCursor: "page-2" }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve }))
      .mockResolvedValueOnce(success({ items: [last], nextCursor: null }))

    await render()
    expect(container.textContent).not.toContain("加载更多")
    expect(pageObservers).toHaveLength(1)
    await act(async () => pageObservers[0]([{ isIntersecting: false }]))
    expect(mocks.list).toHaveBeenCalledTimes(1)

    await act(async () => {
      pageObservers[0]([{ isIntersecting: true }])
      pageObservers[0]([{ isIntersecting: true }])
    })
    expect(mocks.list).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain("团队技能")
    expect(container.textContent).toContain("加载中…")

    await act(async () => resolveNext(success({ items: [next], nextCursor: "page-3" })))
    expect(pageObservers).toHaveLength(2)
    await act(async () => pageObservers[1]([{ isIntersecting: true }]))
    expect(mocks.list.mock.calls.map(([input]) => input.cursor)).toEqual([undefined, "page-2", "page-3"])
    expect(container.querySelector("ul")?.textContent).toContain("团队技能")
    expect(container.querySelector("ul")?.textContent).toContain("第二页技能")
    expect(container.querySelector("ul")?.textContent).toContain("最后一页技能")
    expect(pageObservers).toHaveLength(2)
  })

  it("keeps the current page and retries the same cursor after a failed next page", async () => {
    mocks.list.mockResolvedValueOnce(success({ items: [skill], nextCursor: "page-2" }))
      .mockResolvedValueOnce({ ok: false, code: "HUB_CONNECTION_ERROR", message: "连接失败" })
      .mockResolvedValueOnce(success({ items: [{ ...skill, id: "next", displayName: "更多技能" }], nextCursor: null }))
    await render()
    expect(pageObservers).toHaveLength(1)
    await act(async () => pageObservers[0]([{ isIntersecting: true }]))
    expect(container.textContent).toContain("团队技能")
    expect(container.textContent).toContain("连接失败")
    expect(pageObservers).toHaveLength(1)
    await click(button("重试"))
    expect(container.textContent).toContain("更多技能")
    expect(mocks.list.mock.calls.slice(1).map(([input]) => input.cursor)).toEqual(["page-2", "page-2"])
  })

  it("shows the empty state when the account cannot see any skills", async () => {
    mocks.list.mockResolvedValue(success({ items: [], nextCursor: null }))
    await render()
    expect(container.textContent).toContain("暂无技能")
  })

  it("searches the server and shows the search empty state", async () => {
    vi.useFakeTimers()
    try {
      mocks.list.mockResolvedValueOnce(success({ items: [skill], nextCursor: null }))
        .mockResolvedValueOnce(success({ items: [], nextCursor: null }))
      await render()
      const field = container.querySelector<HTMLInputElement>('input[type="search"]')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "不存在")
        field.dispatchEvent(new Event("input", { bubbles: true }))
      })
      await act(async () => vi.advanceTimersByTimeAsync(250))
      expect(mocks.list).toHaveBeenLastCalledWith({ query: "不存在" })
      expect(container.textContent).toContain("没有匹配的技能")
    } finally {
      vi.useRealTimers()
    }
  })

  it("leaves a detail unavailable until it can read the current version", async () => {
    mocks.detail.mockResolvedValueOnce({ ok: false, code: "HUB_LATEST_CHANGED", message: "最新版已变化，请重新读取。" })
    await render()
    await click(button("查看 团队技能"))
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain("最新版已变化")
    expect(dialog.textContent).not.toContain("SKILL.md")
    await click(button("重试"))
    expect(dialog.textContent).toContain("SKILL.md")
  })

  it("discards a late directory result from the previous account and hides offline data", async () => {
    let finish!: (value: unknown) => void
    mocks.list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      .mockResolvedValueOnce(success({ items: [{ ...skill, displayName: "新账号技能" }], nextCursor: null }))
    await render()
    mocks.account.id = "second"
    await render()
    await act(async () => finish(success({ items: [skill], nextCursor: null })))
    expect(container.textContent).toContain("新账号技能")
    expect(container.textContent).not.toContain("团队技能")
    mocks.account.online = false
    await render()
    expect(container.textContent).not.toContain("新账号技能")
  })

  it("limits simultaneous icon reads and skips queued icons after going offline", async () => {
    const finish: Array<() => void> = []
    mocks.icon.mockImplementation(() => new Promise((resolve) => { finish.push(() => resolve(success("iVBORw0KGgo="))) }))
    mocks.list.mockResolvedValue(success({
      items: Array.from({ length: 8 }, (_, index) => ({
        ...skill, id: `skill-${index}`, iconUrl: `/api/skill-hub/skills/skill-${index}/icon`,
      })),
      nextCursor: null,
    }))
    await render()
    expect(mocks.icon).toHaveBeenCalledTimes(4)
    mocks.account.online = false
    await render()
    await act(async () => finish.forEach((resolve) => resolve()))
    expect(mocks.icon).toHaveBeenCalledTimes(4)
  })
})
