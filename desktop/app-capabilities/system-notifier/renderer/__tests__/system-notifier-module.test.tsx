/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const bridge = vi.hoisted(() => ({
  get: vi.fn(async () => ({ schemaVersion: 1, enabled: true, silent: false })),
  update: vi.fn(async (patch: { enabled?: boolean; silent?: boolean }) => ({
    schemaVersion: 1,
    enabled: patch.enabled ?? true,
    silent: patch.silent ?? false,
  })),
  test: vi.fn(async () => ({ success: true })),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain !== "systemNotifier") throw new Error(`Unexpected bridge domain: ${domain}`)
    return {
      settings: { get: bridge.get, update: bridge.update },
      notification: { test: bridge.test },
    }
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

import { SystemNotifierModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

beforeEach(() => {
  bridge.get.mockClear()
  bridge.update.mockClear()
  bridge.test.mockClear()
  bridge.get.mockResolvedValue({ schemaVersion: 1, enabled: true, silent: false })
  bridge.update.mockImplementation(async (patch) => ({
    schemaVersion: 1,
    enabled: patch.enabled ?? true,
    silent: patch.silent ?? false,
  }))
  bridge.test.mockResolvedValue({ success: true })
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ""
})

describe("SystemNotifierModule", () => {
  it("renders only two settings and the unchanged test button label", async () => {
    await renderModule()
    expect(document.body.textContent).toContain("启用通知")
    expect(document.body.textContent).toContain("静音通知")
    expect(findButton("发送测试通知")).toBeInstanceOf(HTMLButtonElement)
    expect(document.body.textContent).not.toContain("通知历史")
    expect(document.body.textContent).not.toContain("权限状态")
    expect(document.body.textContent).not.toContain("保存")
  })

  it("auto-saves a switch and shows no success feedback", async () => {
    await renderModule()
    const enabled = document.querySelector("#system-notifier-enabled") as HTMLButtonElement
    await act(async () => {
      enabled.click()
      await Promise.resolve()
    })
    expect(bridge.update).toHaveBeenCalledWith({ enabled: false })
    expect(document.body.textContent).not.toContain("保存成功")
  })

  it("rolls back a failed save and shows only the required error", async () => {
    bridge.update.mockRejectedValueOnce(new Error("raw persistence detail"))
    await renderModule()
    const enabled = document.querySelector("#system-notifier-enabled") as HTMLButtonElement
    expect(enabled.getAttribute("data-state")).toBe("checked")

    await act(async () => {
      enabled.click()
      await Promise.resolve()
    })

    expect(enabled.getAttribute("data-state")).toBe("checked")
    expect(document.body.textContent).toContain("保存失败")
    expect(document.body.textContent).not.toContain("raw persistence detail")
  })

  it("disables settings and testing only while a save is pending", async () => {
    const pending = deferred<{ schemaVersion: 1; enabled: boolean; silent: boolean }>()
    bridge.update.mockReturnValueOnce(pending.promise)
    await renderModule()
    const enabled = document.querySelector("#system-notifier-enabled") as HTMLButtonElement
    const silent = document.querySelector("#system-notifier-silent") as HTMLButtonElement
    const testButton = findButton("发送测试通知")

    await act(async () => {
      enabled.click()
      await Promise.resolve()
    })
    expect(enabled.disabled).toBe(true)
    expect(silent.disabled).toBe(true)
    expect(testButton.disabled).toBe(true)

    await act(async () => {
      pending.resolve({ schemaVersion: 1, enabled: false, silent: false })
      await pending.promise
    })
    expect(enabled.disabled).toBe(false)
    expect(silent.disabled).toBe(false)
    expect(testButton.disabled).toBe(false)
  })

  it("shows the load error and retries without exposing the underlying failure", async () => {
    bridge.get.mockRejectedValueOnce(new Error("raw repository detail"))
    await renderModule()
    expect(document.body.textContent).toContain("加载失败")
    expect(document.body.textContent).not.toContain("raw repository detail")

    await act(async () => {
      findButton("重试").click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("启用通知")
    expect(bridge.get).toHaveBeenCalledTimes(2)
  })

  it("keeps the test label fixed and shows no success feedback", async () => {
    await renderModule()
    const button = findButton("发送测试通知")
    await act(async () => {
      button.click()
      expect(button.textContent?.trim()).toBe("发送测试通知")
      await Promise.resolve()
    })
    expect(bridge.test).toHaveBeenCalledOnce()
    expect(document.body.textContent).not.toContain("发送成功")
    expect(document.body.textContent).not.toContain("通知发送失败")
  })

  it("prevents concurrent tests while keeping switches available", async () => {
    const pending = deferred<{ success: true }>()
    bridge.test.mockReturnValueOnce(pending.promise)
    await renderModule()
    const button = findButton("发送测试通知")
    const enabled = document.querySelector("#system-notifier-enabled") as HTMLButtonElement

    await act(async () => {
      button.click()
      await Promise.resolve()
    })
    expect(button.disabled).toBe(true)
    expect(button.getAttribute("aria-busy")).toBe("true")
    expect(enabled.disabled).toBe(false)
    button.click()
    expect(bridge.test).toHaveBeenCalledOnce()

    await act(async () => {
      pending.resolve({ success: true })
      await pending.promise
    })
    expect(button.disabled).toBe(false)
  })

  it("shows only the required IPC-level test error and clears it on retry", async () => {
    bridge.test.mockRejectedValueOnce(new Error("raw native detail"))
    await renderModule()
    await act(async () => {
      findButton("发送测试通知").click()
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("无法发起测试，请重试")
    expect(document.body.textContent).not.toContain("raw native detail")

    await act(async () => {
      findButton("发送测试通知").click()
      await Promise.resolve()
    })
    expect(document.body.textContent).not.toContain("无法发起测试，请重试")
  })
})

async function renderModule(): Promise<void> {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  await act(async () => {
    root.render(<SystemNotifierModule />)
    await Promise.resolve()
  })
}

function findButton(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${text}`)
  return button
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
