/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DriveSyncBindingDto, DriveSyncOperationDto, DriveSyncSnapshotDto } from "@synapse/shared"
import { DriveSyncDialog } from "../drive-sync-shell"
import type { DriveSyncController } from "../use-drive-sync"

vi.mock("@/lib/ui-tracking", async (original) => ({
  ...(await original<typeof import("@/lib/ui-tracking")>()),
  track: vi.fn(),
}))
vi.mock("sonner", () => ({ toast: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

const rawError = 'GET [path] HTTP 429: {"error":"TOO_MANY_REQUESTS","message":"ThrottleException"}'
const binding: DriveSyncBindingDto = {
  id: "binding-1",
  driveItemId: "file-1",
  driveItemName: "需求.md",
  kind: "file",
  status: "active",
  drivePathHint: "/项目/需求.md",
  localPath: "/Users/me/Documents/项目/需求.md",
  remoteCursor: null,
  excludeRules: { forced: [], defaults: [], importedGitignore: [], user: [] },
  createdAt: "2026-10-15T01:00:00Z",
  updatedAt: "2026-10-16T01:00:00Z",
  lastSyncedAt: null,
  lastError: null,
}
const retry: DriveSyncOperationDto = {
  id: "op-1",
  bindingId: binding.id,
  kind: "download",
  relativePath: "",
  status: "retry_wait",
  message: rawError,
  attemptCount: 144,
  nextRetryAt: "2026-10-16T02:00:00Z",
  completedBytes: null,
  totalBytes: null,
  updatedAt: "2026-10-16T01:00:00Z",
}
let root: Root
let host: HTMLDivElement
let snapshot: DriveSyncSnapshotDto
let controller: DriveSyncController
const writeText = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
  writeText.mockResolvedValue(undefined)
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  snapshot = {
    bindings: [binding],
    operations: [retry],
    conflicts: [],
    health: {
      status: "retrying",
      connectivity: "online",
      readOnly: false,
      lastError: null,
      updatedAt: retry.updatedAt,
    },
    summary: {
      activeBindingCount: 1,
      conflictCount: 0,
      errorCount: 0,
      runningOperationCount: 0,
      retryWaitingOperationCount: 1,
    },
  }
  controller = {
    snapshot,
    loading: false,
    error: null,
    readOnly: false,
    offline: false,
    isPending: () => false,
    refresh: vi.fn(async () => snapshot),
    runBindingAction: vi.fn(async () => true),
  } as unknown as DriveSyncController
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
async function render(detail = false) {
  await act(async () => {
    root.render(
      <DriveSyncDialog
        open
        state={{ mode: "center", bindingId: detail ? binding.id : null }}
        controller={controller}
        onOpenChange={vi.fn()}
      />,
    )
  })
}
async function click(label: string) {
  const target = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.getAttribute("aria-label") === label || button.textContent?.trim() === label,
  )
  expect(target, label).toBeTruthy()
  await act(async () => {
    target!.click()
  })
}
async function openMenu(label: string) {
  const target = document.querySelector(`[aria-label="${label}"]`)!
  expect(target).toBeTruthy()
  await act(async () => {
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }))
  })
}

describe("同步管理阅读与恢复", () => {
  it("手动刷新期间提供忙碌状态并阻止重复提交", async () => {
    let finish!: (value: DriveSyncSnapshotDto) => void
    const refresh = vi.fn(
      () =>
        new Promise<DriveSyncSnapshotDto>((resolve) => {
          finish = resolve
        }),
    )
    controller = { ...controller, refresh }
    await render()
    await click("刷新同步状态")
    expect(document.querySelector<HTMLButtonElement>('[aria-label="刷新同步状态"]')?.disabled).toBe(true)
    await click("刷新同步状态")
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(async () => {
      finish(snapshot)
    })
    expect(document.querySelector<HTMLButtonElement>('[aria-label="刷新同步状态"]')?.disabled).toBe(false)
  })
  it("全局限流原因不覆盖多个项目的自动恢复计划", async () => {
    const second = { ...binding, id: "binding-2", driveItemId: "file-2", driveItemName: "设计.md" }
    snapshot = {
      ...snapshot,
      bindings: [binding, second],
      operations: [retry, { ...retry, id: "op-2", bindingId: second.id }],
      health: { ...snapshot.health, status: "retrying", lastError: rawError },
    }
    controller = { ...controller, snapshot }
    await render()
    expect(document.body.textContent).toContain("2 个项目等待自动重试")
    expect(document.querySelector(`time[dateTime="${retry.nextRetryAt}"]`)).toBeTruthy()
    expect(document.body.textContent).not.toContain("同步状态异常")
    expect(document.body.textContent).not.toContain(rawError)
  })
  it("一跳进入详情，自动重试分类与正在执行分开", async () => {
    await render()
    const tabs = [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)
    expect(tabs).toContain("进行中0")
    expect(tabs).toContain("等待重试1")
    await click("同步详情 需求.md")
    expect(document.querySelector('[aria-label="返回同步列表"]')).toBeTruthy()
    expect(document.querySelector('[aria-label="同步简要信息 需求.md"]')).toBeNull()
    expect(document.body.textContent).toContain("最近成功同步")
  })
  it("先显示限流原因和恢复计划，原始错误只按需展开一次且可复制", async () => {
    await render(true)
    expect(document.body.textContent).toContain("云盘请求过于频繁。")
    expect(document.body.textContent).toContain("计划重试")
    expect(document.querySelector(`time[dateTime="${retry.nextRetryAt}"]`)).toBeTruthy()
    expect(document.body.textContent).not.toContain(rawError)
    expect(document.body.textContent).not.toContain("144")
    await click("技术详情")
    expect(document.body.textContent?.split(rawError)).toHaveLength(2)
    expect(document.body.textContent).toContain("144")
    await click("复制技术详情")
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(rawError))
    await click("复制本地路径")
    expect(writeText).toHaveBeenLastCalledWith(binding.localPath)
  })
  it("列表菜单不再展开配置和全量核对，仍保留解除确认入口", async () => {
    await render()
    await openMenu("更多同步操作 需求.md")
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)
    expect(items).toContain("同步详情")
    expect(items).toContain("解除同步…")
    expect(items.some((item) => /更换|重新对齐|重新核对/.test(item ?? ""))).toBe(false)
  })
  it("只读详情允许查看和复制，配置与同步控制不可写", async () => {
    controller = { ...controller, readOnly: true, offline: true }
    await render(true)
    expect(document.querySelector<HTMLButtonElement>('[aria-label="修改同步"]')?.disabled).toBe(true)
    expect(
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent === "暂停同步" && !button.disabled,
      ),
    ).toBe(false)
    await click("复制本地路径")
    expect(writeText).toHaveBeenCalledWith(binding.localPath)
  })
})
