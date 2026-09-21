/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseQuickInputItem } from "@/types/quick-input"
import { useQuickInputItems } from "../use-quick-input-items"

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  changedListener: null as ((event: { items: SynapseQuickInputItem[] }) => void) | null,
  unsubscribe: vi.fn(),
  bridgeAvailable: true,
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.logger,
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: () => {
    if (!mocks.bridgeAvailable) throw new Error("quickInput bridge not available")
    return {
      item: {
        list: mocks.list,
        onChanged: (listener: (event: { items: SynapseQuickInputItem[] }) => void) => {
          mocks.changedListener = listener
          return () => {
            mocks.changedListener = null
            mocks.unsubscribe()
          }
        },
      },
    }
  },
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function item(id: number): SynapseQuickInputItem {
  return {
    id: `item-${id}`,
    schemaVersion: 1,
    content: `content ${id}`,
    sortOrder: id,
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  }
}

// 稳定的初始值引用：hook 内部用 [initialItems] 作为 effect 依赖，
// 每次渲染都新建数组会导致 setItems 反复触发。
const INITIAL_ITEMS: readonly SynapseQuickInputItem[] = [item(1)]

let root: Root | null = null
let renders: Array<readonly SynapseQuickInputItem[]> = []

function Harness({ initialItems }: { initialItems?: readonly SynapseQuickInputItem[] }) {
  const items = useQuickInputItems(initialItems)
  renders.push(items)
  return null
}

function mount(initialItems?: readonly SynapseQuickInputItem[]): void {
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(initialItems ? <Harness initialItems={initialItems} /> : <Harness />)
  })
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function lastRendered(): readonly SynapseQuickInputItem[] | undefined {
  return renders.at(-1)
}

beforeEach(() => {
  mocks.bridgeAvailable = true
  mocks.list.mockResolvedValue([])
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = null
  }
  document.body.innerHTML = ""
  renders = []
  mocks.changedListener = null
  vi.clearAllMocks()
})

describe("useQuickInputItems", () => {
  it("reads the item list from the bridge", async () => {
    mocks.list.mockResolvedValue([item(2), item(3)])
    mount()
    await flush()

    expect(mocks.list).toHaveBeenCalledTimes(1)
    expect(lastRendered()).toEqual([item(2), item(3)])
  })

  it("applies updates pushed by onChanged", async () => {
    mocks.list.mockResolvedValue([item(1)])
    mount()
    await flush()

    expect(mocks.changedListener).toBeTypeOf("function")
    await act(async () => {
      mocks.changedListener?.({ items: [item(5), item(6)] })
    })

    expect(lastRendered()).toEqual([item(5), item(6)])
  })

  it("keeps the initial value and does not throw when the bridge is unavailable", async () => {
    mocks.bridgeAvailable = false
    mount(INITIAL_ITEMS)
    await flush()

    expect(lastRendered()).toEqual(INITIAL_ITEMS)
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Quick input bridge unavailable.",
      expect.objectContaining({ boundary: "renderer.quick-input.bridge" }),
    )
  })

  // 卸载后的契约。
  //
  // 「卸载后不再 setState」这一条无法被反证：React 19 对已卸载 fiber 的 setState
  // 静默忽略，也不再有 unmounted update 警告，删掉 hook 里的 disposed 判断这个用例
  // 依然会绿（已实测）。因此这里只断言可观测的部分 —— 卸载时确实 unsubscribe、
  // 迟到的 list 结果不抛错、不产生新的渲染。
  it("unsubscribes on unmount and swallows the late list result", async () => {
    let resolveList: (items: SynapseQuickInputItem[]) => void = () => undefined
    mocks.list.mockReturnValue(new Promise((resolve) => {
      resolveList = resolve
    }))
    mount()
    await flush()

    const rendersBeforeUnmount = renders.length
    act(() => root?.unmount())
    root = null

    await act(async () => {
      resolveList([item(9)])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(renders.length).toBe(rendersBeforeUnmount)
    expect(mocks.logger.warn).not.toHaveBeenCalled()
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
